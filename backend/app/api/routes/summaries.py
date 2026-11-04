from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.documents import (
    CustomSummaryResponse,
    SummaryOptions,
    SummaryResponse,
)
from app.services import summaries as service

router = APIRouter(prefix="/documents", tags=["summaries"])


@router.get("/{document_id}/summary", response_model=SummaryResponse)
def get_summary(document_id: UUID) -> SummaryResponse:
    return service.get_summary(document_id)


@router.post("/{document_id}/summary", response_model=SummaryResponse, dependencies=[limit("ai")])
def create_summary(document_id: UUID) -> SummaryResponse:
    return service.create_summary(document_id)


@router.post(
    "/{document_id}/summary/custom",
    response_model=CustomSummaryResponse,
    dependencies=[limit("ai")],
)
def create_custom_summary(document_id: UUID, options: SummaryOptions) -> CustomSummaryResponse:
    return service.create_custom_summary(document_id, options)
