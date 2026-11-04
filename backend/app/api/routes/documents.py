from uuid import UUID

from fastapi import APIRouter, Query, UploadFile

from app.api.rate_limit import limit
from app.schemas.documents import (
    DocumentListResponse,
    DocumentResponse,
    DocumentVersionsResponse,
)
from app.services import deletion
from app.services import documents as service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentResponse, status_code=201, dependencies=[limit("upload")])
def upload_document(file: UploadFile) -> DocumentResponse:
    return service.upload_document(file.filename, file.file)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: UUID) -> DocumentResponse:
    return service.get_document(document_id)


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: UUID, all_versions: bool = False) -> None:
    """Delete a document version, or every version with `all_versions=true`."""
    deletion.delete_document(document_id, all_versions=all_versions)


@router.get("", response_model=DocumentListResponse)
def list_documents(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None, max_length=40),
    tag: str | None = Query(default=None, max_length=40),
    include_old_versions: bool = False,
) -> DocumentListResponse:
    return service.list_documents(limit, offset, category, tag, include_old_versions)


@router.post(
    "/{document_id}/versions",
    response_model=DocumentResponse,
    status_code=201,
    dependencies=[limit("upload")],
)
def upload_new_version(document_id: UUID, file: UploadFile) -> DocumentResponse:
    return service.upload_new_version(document_id, file.filename, file.file)


@router.get("/{document_id}/versions", response_model=DocumentVersionsResponse)
def list_versions(document_id: UUID) -> DocumentVersionsResponse:
    return service.list_versions(document_id)
