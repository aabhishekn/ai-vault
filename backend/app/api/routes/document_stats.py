from fastapi import APIRouter

from app.schemas.analytics import DocumentStatisticsResponse
from app.services import document_stats as service

router = APIRouter(prefix="/stats", tags=["statistics"])


@router.get("/documents", response_model=DocumentStatisticsResponse)
def document_statistics() -> DocumentStatisticsResponse:
    return service.document_statistics()
