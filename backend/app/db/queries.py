from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, defer
from sqlalchemy.sql.base import ExecutableOption

from app.core.errors import NotFoundError
from app.db.models import Document

# Whole-document JSON that can be megabytes; load it only where it is actually used.
LARGE_COLUMNS = {"extracted_pages": Document.extracted_pages, "insights": Document.insights}


def lightweight(*load: str) -> list[ExecutableOption]:
    """Loader options that defer the large columns except those named in `load`."""
    return [defer(column) for name, column in LARGE_COLUMNS.items() if name not in load]


def get_document_or_raise(
    session: Session, document_id: UUID, *, load: Sequence[str] = ()
) -> Document:
    document = session.get(Document, document_id, options=lightweight(*load))
    if document is None:
        raise NotFoundError("Document not found")
    return document


def list_documents_query():
    return select(Document).options(*lightweight())
