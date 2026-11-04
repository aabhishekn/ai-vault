from fastapi import APIRouter

from app.schemas.analytics import AIUsageResponse
from app.services import ai_usage as service

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/ai-usage", response_model=AIUsageResponse)
def ai_usage() -> AIUsageResponse:
    return service.ai_usage()
