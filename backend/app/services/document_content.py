"""Shared lifecycle for generated document content (summary and insights)."""

from collections.abc import Callable
from typing import Literal
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import TEXT_AVAILABLE_STATUSES
from app.core.errors import ConflictError, DependencyUnavailableError, NotFoundError
from app.db.database import engine
from app.db.models import Document
from app.db.queries import get_document_or_raise

ContentField = Literal["summary", "insights"]
ContentValue = str | list[dict]


def get_cached_content(document_id: UUID, field: ContentField) -> ContentValue:
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            value = getattr(document, field)
            if value is None:
                message = (
                    "Summary has not been generated"
                    if field == "summary"
                    else "Insights have not been generated"
                )
                raise NotFoundError(message)
            return value
    except SQLAlchemyError:
        raise DependencyUnavailableError(f"{field.capitalize()} database unavailable") from None


def generate_cached_content(
    document_id: UUID,
    field: ContentField,
    generate: Callable[[list[dict]], ContentValue],
) -> ContentValue:
    """Generate outside a transaction, then save only if no earlier result exists."""
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            existing = getattr(document, field)
            if existing is not None:
                return existing
            if document.status not in TEXT_AVAILABLE_STATUSES or not document.extracted_pages:
                raise ConflictError(f"Document text is not ready for {field}")
            pages = document.extracted_pages

        generated = generate(pages)

        with Session(engine) as session:
            column = getattr(Document, field)
            saved = session.scalar(
                update(Document)
                .where(
                    Document.id == document_id,
                    column.is_(None),
                    Document.status.in_(TEXT_AVAILABLE_STATUSES),
                )
                .values({field: generated})
                .returning(column)
            )
            if saved is None:
                document = get_document_or_raise(session, document_id)
                saved = getattr(document, field)
                if saved is None:
                    raise ConflictError(
                        "Document changed while generating content. Check its status before retrying."
                    )
            session.commit()
            return saved
    except SQLAlchemyError:
        raise DependencyUnavailableError(f"{field.capitalize()} database unavailable") from None
