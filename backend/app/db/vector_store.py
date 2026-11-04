"""LlamaIndex vector store over the ``document_chunks`` table.

LlamaIndex orchestrates retrieval, but the chunks stay in our own table so migrations,
the delete cascade from documents, statistics and per-document filtering keep working.
Ingestion writes chunks and vectors itself in staged transactions (see app.tasks), so
this store is read-only.
"""

from typing import Any
from uuid import UUID

from llama_index.core.schema import BaseNode, TextNode
from llama_index.core.vector_stores.types import (
    BasePydanticVectorStore,
    FilterOperator,
    VectorStoreQuery,
    VectorStoreQueryResult,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import EMBEDDING_MODEL
from app.db.database import engine
from app.db.models import DocumentChunk

DOCUMENT_ID = "document_id"


def _document_id(query: VectorStoreQuery) -> UUID:
    """Every search is scoped to one document; refuse anything else."""
    filters = query.filters.filters if query.filters else []
    if (
        len(filters) != 1
        or filters[0].key != DOCUMENT_ID
        or filters[0].operator != FilterOperator.EQ
    ):
        raise ValueError("Searches must filter on exactly one document_id")
    return UUID(str(filters[0].value))


class ChunkVectorStore(BasePydanticVectorStore):
    stores_text: bool = True
    is_embedding_query: bool = True

    @property
    def client(self) -> Any:
        return engine

    def add(self, nodes: list[BaseNode], **add_kwargs: Any) -> list[str]:
        raise NotImplementedError("Chunks are written by the document processing job")

    def delete(self, ref_doc_id: str, **delete_kwargs: Any) -> None:
        raise NotImplementedError("Chunks are removed with their document")

    def query(self, query: VectorStoreQuery, **kwargs: Any) -> VectorStoreQueryResult:
        if query.query_embedding is None:
            raise ValueError("A query embedding is required")
        document_id = _document_id(query)
        with Session(engine) as session:
            distance = DocumentChunk.embedding.cosine_distance(query.query_embedding)
            rows = session.execute(
                select(DocumentChunk, distance.label("cosine_distance"))
                .where(
                    DocumentChunk.document_id == document_id,
                    DocumentChunk.embedding.is_not(None),
                    DocumentChunk.embedding_model == EMBEDDING_MODEL,
                )
                .order_by(distance, DocumentChunk.chunk_index)
                .limit(query.similarity_top_k)
            ).all()
            nodes, similarities = [], []
            for chunk, value in rows:
                nodes.append(
                    TextNode(
                        id_=str(chunk.id),
                        text=chunk.text,
                        metadata={
                            DOCUMENT_ID: str(chunk.document_id),
                            "chunk_index": chunk.chunk_index,
                            "page_number": chunk.page_number,
                            # Kept exact so callers need not reconstruct it from the score.
                            "cosine_distance": float(value),
                        },
                    )
                )
                similarities.append(1.0 - float(value))
            return VectorStoreQueryResult(
                nodes=nodes, similarities=similarities, ids=[node.node_id for node in nodes]
            )
