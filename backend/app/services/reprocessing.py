"""Re-queue documents that never finished: failed, stranded, or abandoned by a dead worker.

A job that is killed mid-run (crash, restart, kill -9) cannot record its own failure, so its
document would stay `processing` forever. A processing attempt older than
PROCESSING_STALE_AFTER_SECONDS (twice the job timeout) is treated as abandoned: it is closed as
failed and the document returns to `queued`.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from redis.exceptions import RedisError
from sqlalchemy import Integer, and_, cast, exists, func, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import PROCESSING_STALE_AFTER_SECONDS
from app.core.errors import ConflictError, DependencyUnavailableError
from app.db.database import engine
from app.db.models import Document, ProcessingAttempt
from app.db.queries import get_document_or_raise
from app.schemas.documents import DocumentResponse
from app.tasks.documents import extract_document
from app.tasks.queue import document_queue

logger = logging.getLogger(__name__)

# `extracted` is allowed so a document processed before embeddings were enabled can be backfilled.
REPROCESSABLE_STATUSES = ("queued", "failed", "extracted")
ABANDONED_MESSAGE = "Processing stopped before it finished. It was queued again."


def _close_abandoned_attempts(session: Session, document_id: UUID | None = None) -> list[UUID]:
    """Fail attempts that have been running too long; returns their document IDs."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=PROCESSING_STALE_AFTER_SECONDS)
    elapsed_ms = cast(
        func.floor(func.extract("epoch", func.now() - ProcessingAttempt.started_at) * 1000),
        Integer,
    )
    statement = (
        update(ProcessingAttempt)
        .where(ProcessingAttempt.status == "processing", ProcessingAttempt.started_at < cutoff)
        .values(
            status="failed",
            finished_at=func.now(),
            duration_ms=func.greatest(0, elapsed_ms),
            error_message=ABANDONED_MESSAGE,
        )
        .returning(ProcessingAttempt.document_id)
    )
    if document_id is not None:
        statement = statement.where(ProcessingAttempt.document_id == document_id)
    return list(session.scalars(statement))


def _requeue(session: Session, *conditions) -> list[UUID]:
    """Atomically move matching documents to `queued`; running attempts block the move."""
    still_running = exists().where(
        ProcessingAttempt.document_id == Document.id, ProcessingAttempt.status == "processing"
    )
    reclaimable = or_(
        Document.status.in_(REPROCESSABLE_STATUSES),
        and_(Document.status == "processing", ~still_running),
    )
    return list(
        session.scalars(
            update(Document)
            .where(reclaimable, *conditions)
            .values(status="queued", error_message=None)
            .returning(Document.id)
        )
    )


def _enqueue(document_id: UUID) -> None:
    document_queue.enqueue(extract_document, str(document_id), result_ttl=3600)


def reprocess_document(document_id: UUID) -> DocumentResponse:
    try:
        with Session(engine) as session:
            get_document_or_raise(session, document_id)
            _close_abandoned_attempts(session, document_id)
            if not _requeue(session, Document.id == document_id):
                session.rollback()
                status = session.scalar(select(Document.status).where(Document.id == document_id))
                raise ConflictError(
                    "Document is still being processed"
                    if status == "processing"
                    else "Document has already been processed"
                )
            session.commit()
            response = DocumentResponse.model_validate(get_document_or_raise(session, document_id))
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to queue document processing") from None
    try:
        _enqueue(document_id)
    except RedisError:
        # The document is `queued`, so calling this endpoint again is safe.
        raise DependencyUnavailableError(
            {
                "message": "Document is queued, but the job queue is unavailable. Try again shortly.",
                "document_id": str(document_id),
            }
        ) from None
    logger.info("document_reprocess_queued", extra={"document_id": str(document_id)})
    return response


def recover_abandoned_documents() -> list[UUID]:
    """Re-queue every document whose worker died mid-job. Called when a worker starts."""
    with Session(engine) as session:
        abandoned = set(_close_abandoned_attempts(session))
        recovered = _requeue(session, Document.id.in_(abandoned)) if abandoned else []
        session.commit()
    for document_id in recovered:
        _enqueue(document_id)
        logger.warning("document_recovered", extra={"document_id": str(document_id)})
    return recovered
