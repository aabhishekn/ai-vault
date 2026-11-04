from collections.abc import Iterator
from dataclasses import dataclass
from uuid import UUID

from openai import APIError
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.answer_generation import generate_answer, stream_answer
from app.core.errors import (
    AppError,
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
    NotFoundError,
)
from app.db.database import engine
from app.db.models import Conversation, ConversationDocument, ConversationTurn
from app.db.queries import get_document_or_raise
from app.schemas.chat import (
    AnswerResponse,
    ConversationHistoryResponse,
    ConversationListResponse,
    ConversationResponse,
    ConversationSummary,
    ConversationTurnResponse,
    SearchRequest,
    SearchResponse,
)
from app.services.search import require_searchable, search_document, search_documents

MAX_CONTEXT_TURNS = 3


def create_conversation(document_id: UUID) -> ConversationResponse:
    try:
        with Session(engine) as session:
            require_searchable(session, document_id)
            conversation = Conversation(document_id=document_id)
            session.add(conversation)
            session.flush()
            response = ConversationResponse.model_validate(conversation)
            session.commit()
            return response
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None


def create_multi_conversation(document_ids: list[UUID]) -> ConversationResponse:
    """A conversation that answers from several documents at once."""
    try:
        with Session(engine) as session:
            for document_id in document_ids:
                require_searchable(session, document_id)
            conversation = Conversation(document_id=None)
            session.add(conversation)
            session.flush()
            session.add_all(
                ConversationDocument(conversation_id=conversation.id, document_id=item)
                for item in document_ids
            )
            session.flush()
            response = ConversationResponse.model_validate(conversation)
            session.commit()
            return response
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None


def list_multi_conversations(
    limit: int = 20, offset: int = 0, has_turns: bool = False
) -> ConversationListResponse:
    """Conversations that span several documents, newest first."""
    try:
        with Session(engine) as session:
            filters = [Conversation.document_id.is_(None)]
            if has_turns:
                filters.append(Conversation.turn_count > 0)
            total = session.scalar(select(func.count()).select_from(Conversation).where(*filters))
            conversations = session.scalars(
                select(Conversation)
                .where(*filters)
                .order_by(Conversation.created_at.desc(), Conversation.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
            return ConversationListResponse(
                items=[ConversationSummary.model_validate(item) for item in conversations],
                total=total,
                limit=limit,
                offset=offset,
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None


def list_conversations(
    document_id: UUID, limit: int = 20, offset: int = 0, has_turns: bool = False
) -> ConversationListResponse:
    """A document's conversations, newest first; `has_turns` skips ones never answered."""
    try:
        with Session(engine) as session:
            get_document_or_raise(session, document_id)
            filters = [Conversation.document_id == document_id]
            if has_turns:
                filters.append(Conversation.turn_count > 0)
            total = session.scalar(select(func.count()).select_from(Conversation).where(*filters))
            conversations = session.scalars(
                select(Conversation)
                .where(*filters)
                .order_by(Conversation.created_at.desc(), Conversation.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
            return ConversationListResponse(
                items=[ConversationSummary.model_validate(item) for item in conversations],
                total=total,
                limit=limit,
                offset=offset,
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None


def get_conversation(
    conversation_id: UUID, limit: int = 20, offset: int = 0
) -> ConversationHistoryResponse:
    try:
        with Session(engine) as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise NotFoundError("Conversation not found")
            turns = session.scalars(
                select(ConversationTurn)
                .where(ConversationTurn.conversation_id == conversation_id)
                .order_by(ConversationTurn.turn_number)
                .limit(limit)
                .offset(offset)
            ).all()
            return ConversationHistoryResponse(
                **ConversationResponse.model_validate(conversation).model_dump(),
                turns=[ConversationTurnResponse.model_validate(turn) for turn in turns],
                total=conversation.turn_count,
                limit=limit,
                offset=offset,
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None


@dataclass(frozen=True)
class _Prepared:
    version: int
    history: list[dict[str, str]]
    retrieval: SearchResponse


def _prepare_message(conversation_id: UUID, request: SearchRequest) -> _Prepared:
    """Load context and retrieve sources; shared by the normal and streaming paths."""
    with Session(engine) as session:
        conversation = session.get(Conversation, conversation_id)
        if conversation is None:
            raise NotFoundError("Conversation not found")
        document_ids = conversation.document_ids
        version = conversation.turn_count
        recent = session.scalars(
            select(ConversationTurn)
            .where(ConversationTurn.conversation_id == conversation_id)
            .order_by(ConversationTurn.turn_number.desc())
            .limit(MAX_CONTEXT_TURNS)
        ).all()
        history = [
            {
                "question": turn.response["question"][:1000],
                "answer": turn.response["answer"][:2000],
            }
            for turn in reversed(recent)
        ]
    search_question = request.question
    if history:
        previous = history[-1]
        context = f"\nPrevious question: {previous['question'][:800]}\nPrevious answer: {previous['answer'][:500]}"
        search_question = (search_question + context)[:2000]
    scoped = SearchRequest(question=search_question, top_k=request.top_k)
    if len(document_ids) == 1:
        retrieval = search_document(document_ids[0], scoped)
    else:
        retrieval = search_documents(document_ids, scoped)
    retrieval.question = request.question
    return _Prepared(version, history, retrieval)


def _save_turn(
    conversation_id: UUID, version: int, answer: AnswerResponse
) -> ConversationTurnResponse:
    with Session(engine) as session:
        claimed = session.scalar(
            update(Conversation)
            .where(Conversation.id == conversation_id, Conversation.turn_count == version)
            .values(turn_count=version + 1)
            .returning(Conversation.id)
        )
        if claimed is None:
            raise ConflictError(
                "Conversation changed while answering. Reload history before retrying."
            )
        turn = ConversationTurn(
            conversation_id=conversation_id,
            turn_number=version + 1,
            response=answer.model_dump(mode="json"),
        )
        session.add(turn)
        session.flush()
        response = ConversationTurnResponse.model_validate(turn)
        session.commit()
        return response


def _translate_errors(error: Exception) -> AppError:
    if isinstance(error, SQLAlchemyError):
        return DependencyUnavailableError("Conversation database unavailable")
    if isinstance(error, APIError | ConfigurationError):
        return DependencyUnavailableError("Answer generation service unavailable")
    return InvalidAIResponseError("Answer generation returned an incomplete or invalid answer")


def send_message(conversation_id: UUID, request: SearchRequest) -> ConversationTurnResponse:
    try:
        prepared = _prepare_message(conversation_id, request)
        answer = generate_answer(prepared.retrieval, history=prepared.history)
        return _save_turn(conversation_id, prepared.version, answer)
    except (SQLAlchemyError, APIError, ConfigurationError, ValueError) as error:
        raise _translate_errors(error) from None


@dataclass(frozen=True)
class StreamEvent:
    """One server-sent event: ``delta`` text, the saved ``turn``, or an ``error``."""

    name: str
    data: dict


def stream_message(conversation_id: UUID, request: SearchRequest) -> Iterator[StreamEvent]:
    """Like :func:`send_message`, but yields the answer text as it is written.

    Problems found before generation starts (unknown conversation, document not
    searchable, retrieval failures) raise as usual so the HTTP status is accurate.
    Once streaming has begun the status is already sent, so later failures arrive as
    an ``error`` event. The turn is saved only after the full answer is validated.
    """
    try:
        prepared = _prepare_message(conversation_id, request)
    except (SQLAlchemyError, APIError, ConfigurationError, ValueError) as error:
        raise _translate_errors(error) from None

    def events() -> Iterator[StreamEvent]:
        try:
            for kind, value in stream_answer(prepared.retrieval, history=prepared.history):
                if kind == "delta":
                    yield StreamEvent("delta", {"text": value})
                else:
                    turn = _save_turn(conversation_id, prepared.version, value)
                    yield StreamEvent("turn", turn.model_dump(mode="json"))
        except AppError as error:
            yield StreamEvent("error", {"detail": error.detail, "status": error.status_code})
        except (SQLAlchemyError, APIError, ConfigurationError, ValueError) as error:
            translated = _translate_errors(error)
            yield StreamEvent(
                "error", {"detail": translated.detail, "status": translated.status_code}
            )

    return events()
