from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from models import Document, DocumentChunk
from schemas import DocumentStatisticsResponse, DocumentStatusCounts

router = APIRouter(prefix="/stats", tags=["statistics"])
STATUSES = ("queued", "processing", "extracted", "embedded", "ready", "failed")


@router.get("/documents", response_model=DocumentStatisticsResponse)
def document_statistics() -> DocumentStatisticsResponse:
    # Separate chunk subqueries avoid multiplying document totals through a join.
    # One SQL statement gives every total the same PostgreSQL snapshot.
    query = select(
        func.count(Document.id).label("total_documents"),
        func.coalesce(func.sum(Document.size_bytes), 0).label("total_storage_bytes"),
        func.count(Document.id).filter(Document.summary.is_not(None)).label("documents_with_summary"),
        func.coalesce(func.sum(func.jsonb_array_length(Document.extracted_pages)), 0).label("total_extracted_pages"),
        select(func.count(DocumentChunk.id)).scalar_subquery().label("total_chunks"),
        select(func.count(DocumentChunk.id)).where(
            DocumentChunk.embedding.is_not(None)
        ).scalar_subquery().label("chunks_with_embeddings"),
        *[func.count(Document.id).filter(Document.status == status).label(status) for status in STATUSES],
    )
    try:
        with Session(engine) as session:
            row = session.execute(query).mappings().one()
            return DocumentStatisticsResponse(
                **{name: row[name] for name in (
                    "total_documents", "total_storage_bytes", "documents_with_summary",
                    "total_extracted_pages", "total_chunks", "chunks_with_embeddings",
                )},
                by_status=DocumentStatusCounts(**{status: row[status] for status in STATUSES}),
            )
    except SQLAlchemyError:
        raise HTTPException(503, "Document statistics database unavailable") from None
