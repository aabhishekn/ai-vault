from uuid import UUID

from fastapi import APIRouter, Query, UploadFile

from app.api.rate_limit import limit
from app.schemas.documents import (
    DocumentListResponse,
    DocumentResponse,
)
from app.services import documents as service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentResponse, status_code=201, dependencies=[limit("upload")])
def upload_document(file: UploadFile) -> DocumentResponse:
    return service.upload_document(file.filename, file.file)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: UUID) -> DocumentResponse:
    return service.get_document(document_id)


@router.get("", response_model=DocumentListResponse)
def list_documents(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None, max_length=40),
    tag: str | None = Query(default=None, max_length=40),
) -> DocumentListResponse:
    return service.list_documents(limit, offset, category, tag)
