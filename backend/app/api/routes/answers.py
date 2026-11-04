from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.chat import (
    AnswerResponse,
    SearchRequest,
)
from app.services import answers as service

router = APIRouter(prefix="/documents", tags=["answers"])


@router.post("/{document_id}/ask", response_model=AnswerResponse, dependencies=[limit("ai")])
def ask_document(document_id: UUID, request: SearchRequest) -> AnswerResponse:
    return service.ask_document(document_id, request)
