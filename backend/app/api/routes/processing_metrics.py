from fastapi import APIRouter

from app.schemas.analytics import ProcessingMetricsResponse
from app.services import processing_metrics as service

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/processing", response_model=ProcessingMetricsResponse)
def processing_metrics() -> ProcessingMetricsResponse:
    return service.processing_metrics()
