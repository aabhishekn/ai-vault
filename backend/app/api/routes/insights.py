from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.documents import (
    InsightsResponse,
)
from app.services import insights as service

router = APIRouter(prefix="/documents", tags=["insights"])


@router.get("/{document_id}/insights", response_model=InsightsResponse)
def get_insights(document_id: UUID) -> InsightsResponse:
    return service.get_insights(document_id)


@router.post("/{document_id}/insights", response_model=InsightsResponse, dependencies=[limit("ai")])
def create_insights(document_id: UUID) -> InsightsResponse:
    return service.create_insights(document_id)
