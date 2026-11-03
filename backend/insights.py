from uuid import UUID

from fastapi import APIRouter, HTTPException
from openai import APIError
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from insight_generation import (InsightInputTooLarge, InsightTextUnavailable,
                                generate_insights, prepare_source)
from models import Document
from schemas import InsightsResponse

router = APIRouter(prefix="/documents", tags=["insights"])


def document_or_404(session: Session, document_id: UUID) -> Document:
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(404, "Document not found")
    return document


@router.get("/{document_id}/insights", response_model=InsightsResponse)
def get_insights(document_id: UUID) -> InsightsResponse:
    try:
        with Session(engine) as session:
            document = document_or_404(session, document_id)
            if document.insights is None:
                raise HTTPException(404, "Insights have not been generated")
            return InsightsResponse(document_id=document_id, insights=document.insights)
    except SQLAlchemyError:
        raise HTTPException(503, "Insights database unavailable") from None


@router.post("/{document_id}/insights", response_model=InsightsResponse)
def create_insights(document_id: UUID) -> InsightsResponse:
    try:
        with Session(engine) as session:
            document = document_or_404(session, document_id)
            if document.insights is not None:
                return InsightsResponse(document_id=document_id, insights=document.insights)
            if document.status not in ("extracted", "embedded", "ready") or not document.extracted_pages:
                raise HTTPException(409, "Document text is not ready for insights")
            pages = document.extracted_pages
        prepare_source(pages)  # Reject unavailable/oversized text before a paid request.
        generated = generate_insights(pages)
        with Session(engine) as session:
            saved = session.scalar(update(Document).where(
                Document.id == document_id, Document.insights.is_(None),
                Document.status.in_(["extracted", "embedded", "ready"]),
            ).values(insights=[insight.model_dump() for insight in generated]).returning(Document.insights))
            if saved is None:
                document = document_or_404(session, document_id)
                if document.insights is None:
                    raise HTTPException(409, "Document changed while generating insights. Check its status before retrying.")
                saved = document.insights
            session.commit()
            return InsightsResponse(document_id=document_id, insights=saved)
    except InsightInputTooLarge:
        raise HTTPException(413, "Document exceeds the current 60000-character insight input limit") from None
    except InsightTextUnavailable:
        raise HTTPException(409, "No document text is available") from None
    except SQLAlchemyError:
        raise HTTPException(503, "Insights database unavailable") from None
    except (APIError, RuntimeError):
        raise HTTPException(503, "Insight generation service unavailable") from None
    except ValueError:
        raise HTTPException(502, "Insight generation returned an incomplete or invalid response") from None
