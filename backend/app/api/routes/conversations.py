import json
from collections.abc import Iterator
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.api.rate_limit import limit
from app.schemas.chat import (
    ConversationHistoryResponse,
    ConversationListResponse,
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


@router.get("/documents/{document_id}/conversations", response_model=ConversationListResponse)
def list_conversations(
    document_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    has_turns: bool = False,
) -> ConversationListResponse:
    return service.list_conversations(document_id, limit, offset, has_turns)


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


def _server_sent_events(events: Iterator[service.StreamEvent]) -> Iterator[str]:
    for event in events:
        yield f"event: {event.name}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


@router.post("/conversations/{conversation_id}/messages/stream", dependencies=[limit("ai")])
def stream_message(conversation_id: UUID, request: SearchRequest) -> StreamingResponse:
    events = service.stream_message(conversation_id, request)
    return StreamingResponse(
        _server_sent_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
