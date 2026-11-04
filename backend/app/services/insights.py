from uuid import UUID

from openai import APIError

from app.ai.insight_generation import (
    InsightInputTooLarge,
    InsightTextUnavailable,
    generate_insights,
    prepare_source,
)
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    ContentTooLargeError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.schemas.documents import InsightsResponse
from app.services.document_content import generate_cached_content, get_cached_content


def get_insights(document_id: UUID) -> InsightsResponse:
    return InsightsResponse(
        document_id=document_id, insights=get_cached_content(document_id, "insights")
    )


def _extract_insights(pages: list[dict]) -> list[dict]:
    try:
        prepare_source(pages)
        return [insight.model_dump() for insight in generate_insights(pages)]
    except InsightInputTooLarge:
        raise ContentTooLargeError(
            "Document exceeds the current 60000-character insight input limit"
        ) from None
    except InsightTextUnavailable:
        raise ConflictError("No document text is available") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Insight generation service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError(
            "Insight generation returned an incomplete or invalid response"
        ) from None


def create_insights(document_id: UUID) -> InsightsResponse:
    return InsightsResponse(
        document_id=document_id,
        insights=generate_cached_content(document_id, "insights", _extract_insights),
    )
