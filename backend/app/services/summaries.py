import hashlib
import json
from uuid import UUID

from openai import APIError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.summary_generation import MAX_SUMMARY_CHARACTERS, generate_summary
from app.core.config import TEXT_AVAILABLE_STATUSES, get_answer_model
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    ContentTooLargeError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.db.database import engine
from app.db.queries import get_document_or_raise
from app.schemas.documents import CustomSummaryResponse, SummaryOptions, SummaryResponse
from app.services.document_content import generate_cached_content, get_cached_content
from app.services.redis_cache import cache_get, cache_set


def get_summary(document_id: UUID) -> SummaryResponse:
    return SummaryResponse(
        document_id=document_id, summary=get_cached_content(document_id, "summary")
    )


def _summarize_pages(pages: list[dict], options: SummaryOptions | None = None) -> str:
    if not any(page["text"].strip() for page in pages):
        raise ConflictError("No document text is available")
    source = "\n\n".join(
        f"Page {page['page_number']}: {' '.join(page['text'].split())}" for page in pages
    )
    if len(source) > MAX_SUMMARY_CHARACTERS:
        raise ContentTooLargeError(
            "Document text exceeds the current 60000-character summary limit"
        )
    try:
        return generate_summary(source) if options is None else generate_summary(source, options)
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Summary generation service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError(
            "Summary generation returned an incomplete or invalid response"
        ) from None


def create_summary(document_id: UUID) -> SummaryResponse:
    return SummaryResponse(
        document_id=document_id,
        summary=generate_cached_content(document_id, "summary", _summarize_pages),
    )


CUSTOM_SUMMARY_TTL_SECONDS = 7 * 86_400


def _custom_summary_key(document_id: UUID, options: SummaryOptions) -> str:
    digest = hashlib.sha256(
        json.dumps([get_answer_model(), options.model_dump()], sort_keys=True).encode()
    ).hexdigest()
    return f"summary:{document_id}:{digest}"


def create_custom_summary(document_id: UUID, options: SummaryOptions) -> CustomSummaryResponse:
    """A summary written to the requested length, tone and focus.

    Not saved on the document: the default summary stays the document's one saved
    summary. Variants are cached in Redis so asking for the same style again is free.
    """
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id, load=("extracted_pages",))
            if document.status not in TEXT_AVAILABLE_STATUSES or not document.extracted_pages:
                raise ConflictError("Document text is not ready for a summary")
            pages = document.extracted_pages
    except SQLAlchemyError:
        raise DependencyUnavailableError("Summary database unavailable") from None
    key = _custom_summary_key(document_id, options)
    cached = cache_get(key)
    if isinstance(cached, str) and cached:
        return CustomSummaryResponse(
            document_id=document_id, summary=cached, options=options, cached=True
        )
    summary = _summarize_pages(pages, options)
    cache_set(key, summary, CUSTOM_SUMMARY_TTL_SECONDS)
    return CustomSummaryResponse(
        document_id=document_id, summary=summary, options=options, cached=False
    )
