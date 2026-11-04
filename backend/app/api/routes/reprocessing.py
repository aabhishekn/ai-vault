from uuid import UUID

from fastapi import APIRouter

from app.api.rate_limit import limit
from app.schemas.documents import DocumentResponse
from app.services import reprocessing as service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post(
    "/{document_id}/reprocess",
    response_model=DocumentResponse,
    status_code=202,
    dependencies=[limit("upload")],
)
def reprocess_document(document_id: UUID) -> DocumentResponse:
    """Queue processing again for a failed, stranded, or abandoned document."""
    return service.reprocess_document(document_id)
