from uuid import UUID

from fastapi import APIRouter

from app.schemas.chat import (
    AnswerResponse,
    SearchRequest,
)
from app.services import answers as service

router = APIRouter(prefix="/documents", tags=["answers"])


@router.post("/{document_id}/ask", response_model=AnswerResponse)
def ask_document(document_id: UUID, request: SearchRequest) -> AnswerResponse:
    return service.ask_document(document_id, request)
