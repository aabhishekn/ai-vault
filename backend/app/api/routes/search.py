from uuid import UUID

from fastapi import APIRouter

from app.schemas.chat import (
    SearchRequest,
    SearchResponse,
)
from app.services import search as service

router = APIRouter(prefix="/documents", tags=["search"])


@router.post("/{document_id}/search", response_model=SearchResponse)
def search_document(document_id: UUID, request: SearchRequest) -> SearchResponse:
    return service.search_document(document_id, request)
