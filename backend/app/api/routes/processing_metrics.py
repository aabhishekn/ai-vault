from fastapi import APIRouter

from app.schemas.analytics import ApiMetricsResponse, ProcessingMetricsResponse
from app.services import processing_metrics as service
from app.services.api_metrics import api_metrics

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/processing", response_model=ProcessingMetricsResponse)
def processing_metrics() -> ProcessingMetricsResponse:
    return service.processing_metrics()


@router.get("/api", response_model=ApiMetricsResponse)
def api_latency_metrics() -> ApiMetricsResponse:
    """Request counts and latency per route for this API process since it started."""
    return api_metrics.snapshot()
