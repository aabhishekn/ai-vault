from uuid import UUID

from openai import APIError
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.answer_generation import generate_answer
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
    NotFoundError,
)
from app.db.database import engine
from app.db.models import Conversation, ConversationTurn
from app.db.queries import get_document_or_raise
from app.schemas.chat import (
    ConversationHistoryResponse,
    ConversationListResponse,
    ConversationResponse,
    ConversationSummary,
    ConversationTurnResponse,
    SearchRequest,
)
from app.services.search import require_searchable, search_document

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


def send_message(conversation_id: UUID, request: SearchRequest) -> ConversationTurnResponse:
    try:
        with Session(engine) as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise NotFoundError("Conversation not found")
            document_id = conversation.document_id
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
        retrieval = search_document(
            document_id, SearchRequest(question=search_question, top_k=request.top_k)
        )
        retrieval.question = request.question
        answer = generate_answer(retrieval, history=history)
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
    except SQLAlchemyError:
        raise DependencyUnavailableError("Conversation database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Answer generation service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError(
            "Answer generation returned an incomplete or invalid answer"
        ) from None
