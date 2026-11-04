from uuid import UUID

from llama_index.core import VectorStoreIndex
from llama_index.core.schema import QueryBundle
from llama_index.core.vector_stores.types import MetadataFilter, MetadataFilters
from openai import APIError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.embed_model import VaultEmbedding
from app.ai.embeddings import EMBEDDING_MODEL
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
from app.db.vector_store import DOCUMENT_ID, ChunkVectorStore
from app.schemas.chat import SearchMatch, SearchRequest, SearchResponse
from app.services.embedding_cache import cached_query_embedding

_EMBED_MODEL = VaultEmbedding()


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
    return cached_query_embedding(question, lambda: _EMBED_MODEL.get_query_embedding(question))


def _retrieve(document_id: UUID, question: str, vector: list[float], top_k: int) -> list:
    """Nearest chunks of one document, found by LlamaIndex over our chunk table."""
    index = VectorStoreIndex.from_vector_store(ChunkVectorStore(), embed_model=_EMBED_MODEL)
    retriever = index.as_retriever(
        similarity_top_k=top_k,
        filters=MetadataFilters(filters=[MetadataFilter(key=DOCUMENT_ID, value=str(document_id))]),
    )
    return retriever.retrieve(QueryBundle(query_str=question, embedding=vector))


def search_document(document_id: UUID, request: SearchRequest) -> SearchResponse:
    try:
        with Session(engine) as session:
            require_searchable(session, document_id)
        query_vector = _embed_query(request.question)
        with Session(engine) as session:
            require_searchable(session, document_id)
        found = _retrieve(document_id, request.question, query_vector, request.top_k)
        return SearchResponse(
            document_id=document_id,
            question=request.question,
            matches=[
                SearchMatch(
                    chunk_id=UUID(item.node.node_id),
                    chunk_index=item.node.metadata["chunk_index"],
                    page_number=item.node.metadata["page_number"],
                    text=item.node.get_content(),
                    cosine_distance=item.node.metadata["cosine_distance"],
                )
                for item in found
            ],
        )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Document search database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Embedding service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError("Invalid response from embedding service") from None
