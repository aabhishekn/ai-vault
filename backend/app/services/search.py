from uuid import UUID

from openai import APIError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.embeddings import EMBEDDING_MODEL, generate_embeddings
from app.core.config import SEARCHABLE_STATUSES
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.db.database import engine
from app.db.models import DocumentChunk
from app.db.queries import get_document_or_raise
from app.schemas.chat import SearchMatch, SearchRequest, SearchResponse
from app.services.embedding_cache import cached_query_embedding


def require_searchable(session: Session, document_id: UUID) -> None:
    document = get_document_or_raise(session, document_id)
    if document.status not in SEARCHABLE_STATUSES:
        raise ConflictError("Document embeddings are not ready")
    chunk = session.scalar(
        select(DocumentChunk.id)
        .where(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_not(None),
            DocumentChunk.embedding_model == EMBEDDING_MODEL,
        )
        .limit(1)
    )
    if chunk is None:
        raise ConflictError("No compatible document embeddings found")


def _embed_query(question: str) -> list[float]:
    def compute() -> list[float]:
        batch = generate_embeddings([question])
        if batch.model != EMBEDDING_MODEL:
            raise ValueError("Unexpected query embedding model")
        return batch.vectors[0]

    return cached_query_embedding(question, compute)


def search_document(document_id: UUID, request: SearchRequest) -> SearchResponse:
    try:
        with Session(engine) as session:
            require_searchable(session, document_id)
        query_vector = _embed_query(request.question)
        with Session(engine) as session:
            require_searchable(session, document_id)
            distance = DocumentChunk.embedding.cosine_distance(query_vector)
            rows = session.execute(
                select(DocumentChunk, distance.label("cosine_distance"))
                .where(
                    DocumentChunk.document_id == document_id,
                    DocumentChunk.embedding.is_not(None),
                    DocumentChunk.embedding_model == EMBEDDING_MODEL,
                )
                .order_by(distance, DocumentChunk.chunk_index)
                .limit(request.top_k)
            ).all()
            return SearchResponse(
                document_id=document_id,
                question=request.question,
                matches=[
                    SearchMatch(
                        chunk_id=chunk.id,
                        chunk_index=chunk.chunk_index,
                        page_number=chunk.page_number,
                        text=chunk.text,
                        cosine_distance=float(value),
                    )
                    for (chunk, value) in rows
                ],
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Document search database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Embedding service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError("Invalid response from embedding service") from None
