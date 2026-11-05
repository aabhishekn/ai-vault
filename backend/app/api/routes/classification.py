from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.documents import ClassificationResponse
from app.services import classification as service

router = APIRouter(tags=["classification"])


@router.get("/documents/{document_id}/classification", response_model=ClassificationResponse)
def get_classification(document_id: UUID) -> ClassificationResponse:
    return service.get_classification(document_id)


@router.post(
    "/documents/{document_id}/classification",
    response_model=ClassificationResponse,
    dependencies=[limit("ai")],
)
def create_classification(document_id: UUID) -> ClassificationResponse:
    return service.create_classification(document_id)
