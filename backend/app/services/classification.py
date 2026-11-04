"""Category and tags for a document, generated once and saved on it."""

from uuid import UUID

from openai import APIError
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.classification import classify
from app.core.config import TEXT_AVAILABLE_STATUSES
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
    NotFoundError,
)
from app.db.database import engine
from app.db.models import Document
from app.db.queries import get_document_or_raise
from app.schemas.documents import (
    CategoryCount,
    ClassificationResponse,
    TagCount,
    TagsOverviewResponse,
)

EXCERPT_CHARACTERS = 4000


def get_classification(document_id: UUID) -> ClassificationResponse:
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            if document.category is None:
                raise NotFoundError("Document has not been classified")
            return ClassificationResponse(
                document_id=document_id, category=document.category, tags=document.tags or []
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Classification database unavailable") from None


def create_classification(document_id: UUID) -> ClassificationResponse:
    """Classify once; later calls return the saved result without a provider request."""
    try:
        with Session(engine) as session:
            document = get_document_or_raise(
                session, document_id, load=("extracted_pages", "insights")
            )
            if document.category is not None:
                return ClassificationResponse(
                    document_id=document_id, category=document.category, tags=document.tags or []
                )
            if document.status not in TEXT_AVAILABLE_STATUSES:
                raise ConflictError("Document text is not ready for classification")
            summary = document.summary
            insights = [item["text"] for item in (document.insights or [])]
            excerpt = None
            if not summary and not insights:
                text = " ".join(page["text"] for page in (document.extracted_pages or []))
                excerpt = " ".join(text.split())[:EXCERPT_CHARACTERS] or None
        if not (summary or insights or excerpt):
            raise ConflictError("No document text is available")
        try:
            category, tags = classify(summary, insights, excerpt)
        except (APIError, ConfigurationError):
            raise DependencyUnavailableError("Classification service unavailable") from None
        except ValueError:
            raise InvalidAIResponseError("Classification returned an invalid response") from None
        with Session(engine) as session:
            saved = session.execute(
                update(Document)
                .where(Document.id == document_id, Document.category.is_(None))
                .values(category=category, tags=tags)
                .returning(Document.category, Document.tags)
            ).first()
            if saved is None:  # a concurrent request saved first; use its result
                document = get_document_or_raise(session, document_id)
                saved = (document.category, document.tags)
            session.commit()
            return ClassificationResponse(
                document_id=document_id, category=saved[0], tags=saved[1] or []
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Classification database unavailable") from None


def tags_overview() -> TagsOverviewResponse:
    """How many documents carry each category and tag, for building filters."""
    try:
        with Session(engine) as session:
            categories = session.execute(
                select(Document.category, func.count())
                .where(Document.category.is_not(None))
                .group_by(Document.category)
                .order_by(func.count().desc(), Document.category)
            ).all()
            tags = session.execute(
                text(
                    "SELECT tag, count(*) AS n FROM documents, "
                    "jsonb_array_elements_text(tags) AS tag "
                    "GROUP BY tag ORDER BY n DESC, tag LIMIT 100"
                )
            ).all()
            return TagsOverviewResponse(
                categories=[CategoryCount(category=c, count=n) for c, n in categories],
                tags=[TagCount(tag=t, count=n) for t, n in tags],
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Classification database unavailable") from None
