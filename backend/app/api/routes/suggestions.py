from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.documents import SuggestedQuestionsResponse
from app.services import suggestions as service

router = APIRouter(prefix="/documents", tags=["suggestions"])


@router.post(
    "/{document_id}/suggested-questions",
    response_model=SuggestedQuestionsResponse,
    dependencies=[limit("ai")],
)
def suggest_questions(document_id: UUID) -> SuggestedQuestionsResponse:
    return service.get_suggested_questions(document_id)
