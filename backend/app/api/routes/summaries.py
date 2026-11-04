from uuid import UUID

from fastapi import APIRouter

from app.schemas.documents import (
    SummaryResponse,
)
from app.services import summaries as service

router = APIRouter(prefix="/documents", tags=["summaries"])


@router.get("/{document_id}/summary", response_model=SummaryResponse)
def get_summary(document_id: UUID) -> SummaryResponse:
    return service.get_summary(document_id)


@router.post("/{document_id}/summary", response_model=SummaryResponse)
def create_summary(document_id: UUID) -> SummaryResponse:
    return service.create_summary(document_id)
