"""Suggested starter questions for a document.

Generated from the saved summary and insights (not the full text), so the request is
small. Results are cached in Redis under a hash of that source, which means they are
reused until the content changes and a Redis outage only costs a regeneration.
"""

import hashlib
import json
import logging
from uuid import UUID

from openai import APIError
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.question_suggestions import generate_question_suggestions
from app.core.config import get_answer_model
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.db.database import engine
from app.db.queries import get_document_or_raise
from app.schemas.documents import SuggestedQuestionsResponse
from app.tasks.queue import redis_connection

logger = logging.getLogger(__name__)
CACHE_TTL_SECONDS = 7 * 86_400


def _load_source(document_id: UUID) -> tuple[str | None, list[str]]:
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id, load=("summary", "insights"))
            summary = document.summary
            insights = [item["text"] for item in (document.insights or [])]
    except SQLAlchemyError:
        raise DependencyUnavailableError("Suggestion database unavailable") from None
    if not summary and not insights:
        raise ConflictError("Generate a summary or insights before asking for suggestions")
    return summary, insights


def _cache_key(document_id: UUID, summary: str | None, insights: list[str]) -> str:
    digest = hashlib.sha256(
        json.dumps([get_answer_model(), summary, insights], ensure_ascii=False).encode()
    ).hexdigest()
    return f"suggestions:{document_id}:{digest}"


def get_suggested_questions(document_id: UUID, redis=None) -> SuggestedQuestionsResponse:
    summary, insights = _load_source(document_id)
    redis = redis or redis_connection
    key = _cache_key(document_id, summary, insights)
    try:
        raw = redis.get(key)
        if raw is not None:
            questions = json.loads(raw)
            if isinstance(questions, list) and all(isinstance(q, str) for q in questions):
                return SuggestedQuestionsResponse(
                    document_id=document_id, questions=questions, cached=True
                )
    except (RedisError, ValueError):
        logger.warning("suggestion_cache_unavailable", extra={"operation": "read"})
    try:
        questions = generate_question_suggestions(summary, insights)
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Question suggestion service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError("Question suggestion returned an invalid response") from None
    try:
        redis.set(key, json.dumps(questions), ex=CACHE_TTL_SECONDS)
    except RedisError:
        logger.warning("suggestion_cache_unavailable", extra={"operation": "write"})
    return SuggestedQuestionsResponse(document_id=document_id, questions=questions, cached=False)
