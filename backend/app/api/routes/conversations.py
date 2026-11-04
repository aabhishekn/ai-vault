from uuid import UUID

from fastapi import APIRouter, Query

from app.api.rate_limit import limit
from app.schemas.chat import (
    ConversationHistoryResponse,
    ConversationResponse,
    ConversationTurnResponse,
    SearchRequest,
)
from app.services import conversations as service

router = APIRouter(tags=["conversations"])


@router.post(
    "/documents/{document_id}/conversations", response_model=ConversationResponse, status_code=201
)
def create_conversation(document_id: UUID) -> ConversationResponse:
    return service.create_conversation(document_id)


@router.get("/conversations/{conversation_id}", response_model=ConversationHistoryResponse)
def get_conversation(
    conversation_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ConversationHistoryResponse:
    return service.get_conversation(conversation_id, limit, offset)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationTurnResponse,
    status_code=201,
    dependencies=[limit("ai")],
)
def send_message(conversation_id: UUID, request: SearchRequest) -> ConversationTurnResponse:
    return service.send_message(conversation_id, request)
