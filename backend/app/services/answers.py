from uuid import UUID

from openai import APIError

from app.ai.answer_generation import generate_answer
from app.core.errors import ConfigurationError, DependencyUnavailableError, InvalidAIResponseError
from app.schemas.chat import AnswerResponse, SearchRequest
from app.services.search import search_document


def ask_document(document_id: UUID, request: SearchRequest) -> AnswerResponse:
    retrieval = search_document(document_id, request)
    try:
        return generate_answer(retrieval)
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Answer generation service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError(
            "Answer generation returned an incomplete or invalid answer"
        ) from None
