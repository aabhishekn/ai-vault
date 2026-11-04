from uuid import UUID

from fastapi import APIRouter

from app.schemas.documents import (
    InsightsResponse,
)
from app.services import insights as service

router = APIRouter(prefix="/documents", tags=["insights"])


@router.get("/{document_id}/insights", response_model=InsightsResponse)
def get_insights(document_id: UUID) -> InsightsResponse:
    return service.get_insights(document_id)


@router.post("/{document_id}/insights", response_model=InsightsResponse)
def create_insights(document_id: UUID) -> InsightsResponse:
    return service.create_insights(document_id)
