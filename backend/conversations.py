from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from openai import APIError
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from answer_generation import generate_answer
from database import engine
from models import Conversation, ConversationTurn
from schemas import (ConversationHistoryResponse, ConversationResponse,
                     ConversationTurnResponse, SearchRequest)
from search import require_searchable, search_document

router = APIRouter(tags=["conversations"])
MAX_CONTEXT_TURNS = 3


@router.post("/documents/{document_id}/conversations", response_model=ConversationResponse, status_code=201)
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
        raise HTTPException(503, "Conversation database unavailable") from None


@router.get("/conversations/{conversation_id}", response_model=ConversationHistoryResponse)
def get_conversation(
    conversation_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ConversationHistoryResponse:
    try:
        with Session(engine) as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise HTTPException(404, "Conversation not found")
            turns = session.scalars(select(ConversationTurn).where(
                ConversationTurn.conversation_id == conversation_id
            ).order_by(ConversationTurn.turn_number).limit(limit).offset(offset)).all()
            return ConversationHistoryResponse(
                **ConversationResponse.model_validate(conversation).model_dump(),
                turns=[ConversationTurnResponse.model_validate(turn) for turn in turns],
                total=conversation.turn_count, limit=limit, offset=offset,
            )
    except SQLAlchemyError:
        raise HTTPException(503, "Conversation database unavailable") from None


@router.post("/conversations/{conversation_id}/messages", response_model=ConversationTurnResponse, status_code=201)
def send_message(conversation_id: UUID, request: SearchRequest) -> ConversationTurnResponse:
    try:
        with Session(engine) as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise HTTPException(404, "Conversation not found")
            document_id = conversation.document_id
            version = conversation.turn_count
            recent = session.scalars(select(ConversationTurn).where(
                ConversationTurn.conversation_id == conversation_id
            ).order_by(ConversationTurn.turn_number.desc()).limit(MAX_CONTEXT_TURNS)).all()
            history = [{"question": turn.response["question"][:1000],
                        "answer": turn.response["answer"][:2000]} for turn in reversed(recent)]

        # Keep the current question first. Add bounded recent context to help resolve
        # follow-ups during retrieval without an additional rewrite-model request.
        search_question = request.question
        if history:
            previous = history[-1]
            context = f"\nPrevious question: {previous['question'][:800]}\nPrevious answer: {previous['answer'][:500]}"
            search_question = (search_question + context)[:2000]
        retrieval = search_document(document_id, SearchRequest(
            question=search_question, top_k=request.top_k,
        ))
        retrieval.question = request.question
        answer = generate_answer(retrieval, history=history)

        with Session(engine) as session:
            # A compare-and-swap prevents two concurrent requests appending answers
            # based on the same history. Never hold a row lock during AI calls.
            claimed = session.scalar(update(Conversation).where(
                Conversation.id == conversation_id, Conversation.turn_count == version,
            ).values(turn_count=version + 1).returning(Conversation.id))
            if claimed is None:
                raise HTTPException(409, "Conversation changed while answering. Reload history before retrying.")
            turn = ConversationTurn(conversation_id=conversation_id,
                                    turn_number=version + 1, response=answer.model_dump(mode="json"))
            session.add(turn)
            session.flush()
            response = ConversationTurnResponse.model_validate(turn)
            session.commit()
            return response
    except SQLAlchemyError:
        raise HTTPException(503, "Conversation database unavailable") from None
    except (APIError, RuntimeError):
        raise HTTPException(503, "Answer generation service unavailable") from None
    except ValueError:
        raise HTTPException(502, "Answer generation returned an incomplete or invalid answer") from None
