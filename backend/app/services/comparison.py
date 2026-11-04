import hashlib
import json
from uuid import UUID

from openai import APIError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.comparison import compare_documents
from app.core.config import SEARCHABLE_STATUSES, get_answer_model
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.db.database import engine
from app.db.queries import get_document_or_raise
from app.schemas.comparison import (
    ComparedDocument,
    ComparisonDifference,
    ComparisonPosition,
    ComparisonRequest,
    ComparisonResponse,
)
from app.services.redis_cache import cache_get, cache_set
from app.services.search import embed_question, passages_of_document

COMPARISON_TTL_SECONDS = 7 * 86_400
PASSAGES_PER_DOCUMENT = 4
PASSAGE_CHARACTERS = 1200
DEFAULT_QUESTION = "main purpose, requirements, terms, obligations, and key figures"


def _key(ids: list[UUID], focus: str | None) -> str:
    digest = hashlib.sha256(
        json.dumps([get_answer_model(), [str(item) for item in ids], focus]).encode()
    ).hexdigest()
    return f"comparison:{digest}"


def _load(ids: list[UUID]) -> list[dict]:
    """Name, summary and insights of each document, rejecting any that cannot be searched."""
    loaded = []
    with Session(engine) as session:
        for document_id in ids:
            document = get_document_or_raise(session, document_id)
            if document.status not in SEARCHABLE_STATUSES:
                raise ConflictError(f"{document.filename} is not ready to be compared")
            loaded.append(
                {
                    "id": document.id,
                    "filename": document.filename,
                    "version_number": document.version_number,
                    "summary": document.summary,
                    "insights": [item["text"] for item in (document.insights or [])],
                }
            )
    return loaded


def _material(document: dict, vector: list[float], question: str) -> dict:
    """What the model sees for one document: its saved overview plus the passages
    most relevant to the comparison, retrieved per document so none is crowded out."""
    found = passages_of_document(document["id"], question, vector, PASSAGES_PER_DOCUMENT)
    return {
        "name": document["filename"],
        "summary": document["summary"],
        "insights": document["insights"],
        "passages": [
            {
                "page": item.node.metadata["page_number"],
                "text": item.node.get_content()[:PASSAGE_CHARACTERS],
            }
            for item in found
        ],
    }


def compare(request: ComparisonRequest) -> ComparisonResponse:
    # A canonical order makes the cache key (and document numbering) independent of the
    # order the caller listed the documents in.
    ids = sorted(request.document_ids, key=str)
    try:
        documents = _load(ids)
        key = _key(ids, request.focus)
        cached = cache_get(key)
        if isinstance(cached, dict):
            try:
                return ComparisonResponse.model_validate({**cached, "cached": True})
            except ValueError:
                pass
        question = request.focus or DEFAULT_QUESTION
        vector = embed_question(question)
        sources = [_material(document, vector, question) for document in documents]
        draft, model = compare_documents(sources, request.focus)
    except SQLAlchemyError:
        raise DependencyUnavailableError("Comparison database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Comparison service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError(
            "Comparison returned an incomplete or invalid result"
        ) from None
    names = {number: document for number, document in enumerate(documents, 1)}
    response = ComparisonResponse(
        documents=[
            ComparedDocument(
                id=document["id"],
                filename=document["filename"],
                version_number=document["version_number"],
            )
            for document in documents
        ],
        focus=request.focus,
        overview=draft.overview.strip(),
        similarities=[point.strip() for point in draft.similarities if point.strip()],
        differences=[
            ComparisonDifference(
                topic=difference.topic.strip(),
                positions=[
                    ComparisonPosition(
                        document_id=names[position.document]["id"],
                        filename=names[position.document]["filename"],
                        statement=position.statement.strip(),
                    )
                    for position in sorted(difference.positions, key=lambda item: item.document)
                ],
            )
            for difference in draft.differences
        ],
        model=model,
    )
    cache_set(key, response.model_dump(mode="json", exclude={"cached"}), COMPARISON_TTL_SECONDS)
    return response
