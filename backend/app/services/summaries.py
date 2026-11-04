from uuid import UUID

from openai import APIError

from app.ai.summary_generation import MAX_SUMMARY_CHARACTERS, generate_summary
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    ContentTooLargeError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.schemas.documents import SummaryResponse
from app.services.document_content import generate_cached_content, get_cached_content


def get_summary(document_id: UUID) -> SummaryResponse:
    return SummaryResponse(
        document_id=document_id, summary=get_cached_content(document_id, "summary")
    )


def _summarize_pages(pages: list[dict]) -> str:
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
        return generate_summary(source)
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
