from uuid import UUID

from fastapi import APIRouter, HTTPException
from openai import APIError
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from models import Document
from schemas import SummaryResponse
from summary_generation import MAX_SUMMARY_CHARACTERS, generate_summary

router = APIRouter(prefix="/documents", tags=["summaries"])


def document_or_404(session: Session, document_id: UUID) -> Document:
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(404, "Document not found")
    return document


@router.get("/{document_id}/summary", response_model=SummaryResponse)
def get_summary(document_id: UUID) -> SummaryResponse:
    try:
        with Session(engine) as session:
            document = document_or_404(session, document_id)
            if document.summary is None:
                raise HTTPException(404, "Summary has not been generated")
            return SummaryResponse(document_id=document_id, summary=document.summary)
    except SQLAlchemyError:
        raise HTTPException(503, "Summary database unavailable") from None


@router.post("/{document_id}/summary", response_model=SummaryResponse)
def create_summary(document_id: UUID) -> SummaryResponse:
    try:
        with Session(engine) as session:
            document = document_or_404(session, document_id)
            if document.summary is not None:
                return SummaryResponse(document_id=document_id, summary=document.summary)
            if document.status not in ("extracted", "embedded", "ready") or not document.extracted_pages:
                raise HTTPException(409, "Document text is not ready for summarization")
            pages = document.extracted_pages

        # Include every page; reject long inputs rather than silently summarize a prefix.
        source = "\n\n".join(
            f"Page {page['page_number']}: {' '.join(page['text'].split())}" for page in pages
        )
        if not any(page["text"].strip() for page in pages):
            raise HTTPException(409, "No document text is available")
        if len(source) > MAX_SUMMARY_CHARACTERS:
            raise HTTPException(413, "Document text exceeds the current 60000-character summary limit")
        summary = generate_summary(source)
        with Session(engine) as session:
            # If another request saved a summary first, preserve and return that value.
            saved = session.scalar(update(Document).where(
                Document.id == document_id, Document.summary.is_(None),
                Document.status.in_(["extracted", "embedded", "ready"]),
            ).values(summary=summary).returning(Document.summary))
            if saved is None:
                document = document_or_404(session, document_id)
                if document.summary is None:
                    raise HTTPException(409, "Document changed while summarizing. Check its status before retrying.")
                saved = document.summary
            session.commit()
            return SummaryResponse(document_id=document_id, summary=saved)
    except SQLAlchemyError:
        raise HTTPException(503, "Summary database unavailable") from None
    except (APIError, RuntimeError):
        raise HTTPException(503, "Summary generation service unavailable") from None
    except ValueError:
        raise HTTPException(502, "Summary generation returned an incomplete or invalid response") from None
