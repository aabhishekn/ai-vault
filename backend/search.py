from uuid import UUID

from fastapi import APIRouter, HTTPException
from openai import APIError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from embeddings import EMBEDDING_MODEL, generate_embeddings
from models import Document, DocumentChunk
from schemas import SearchMatch, SearchRequest, SearchResponse

router = APIRouter(prefix="/documents", tags=["search"])


def require_searchable(session: Session, document_id: UUID) -> None:
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(404, "Document not found")
    if document.status not in ("embedded", "ready"):
        raise HTTPException(409, "Document embeddings are not ready")
    chunk = session.scalar(select(DocumentChunk.id).where(
        DocumentChunk.document_id == document_id,
        DocumentChunk.embedding.is_not(None),
        DocumentChunk.embedding_model == EMBEDDING_MODEL,
    ).limit(1))
    if chunk is None:
        raise HTTPException(409, "No compatible document embeddings found")


@router.post("/{document_id}/search", response_model=SearchResponse)
def search_document(document_id: UUID, request: SearchRequest) -> SearchResponse:
    try:
        # Reject missing/unprocessed documents before making a paid API request.
        with Session(engine) as session:
            require_searchable(session, document_id)

        # Keep network calls outside database transactions.
        batch = generate_embeddings([request.question])
        if batch.model != EMBEDDING_MODEL:
            raise ValueError("Unexpected query embedding model")
        query_vector = batch.vectors[0]
        with Session(engine) as session:
            # Recheck in case the document changed while the provider was running.
            require_searchable(session, document_id)
            distance = DocumentChunk.embedding.cosine_distance(query_vector)
            rows = session.execute(
                select(DocumentChunk, distance.label("cosine_distance"))
                .where(
                    DocumentChunk.document_id == document_id,
                    DocumentChunk.embedding.is_not(None),
                    DocumentChunk.embedding_model == batch.model,
                )
                .order_by(distance, DocumentChunk.chunk_index)
                .limit(request.top_k)
            ).all()
            return SearchResponse(
                document_id=document_id, question=request.question,
                matches=[SearchMatch(
                    chunk_id=chunk.id, chunk_index=chunk.chunk_index,
                    page_number=chunk.page_number, text=chunk.text,
                    cosine_distance=float(value),
                ) for chunk, value in rows],
            )
    except SQLAlchemyError:
        raise HTTPException(503, "Document search database unavailable") from None
    except (APIError, RuntimeError):
        raise HTTPException(503, "Embedding service unavailable") from None
    except ValueError:
        raise HTTPException(502, "Invalid response from embedding service") from None
