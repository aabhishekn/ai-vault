from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.comparison import ComparisonRequest, ComparisonResponse
from app.services import comparison as service

router = APIRouter(tags=["comparison"])


@router.post("/comparisons", response_model=ComparisonResponse, dependencies=[limit("ai")])
def compare_documents(request: ComparisonRequest) -> ComparisonResponse:
    return service.compare(request)
