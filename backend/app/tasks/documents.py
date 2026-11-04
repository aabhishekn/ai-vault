"""RQ entry point and explicit database boundaries for document processing."""

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import UUID, uuid4

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.ai.embeddings import EMBEDDING_MODEL, MAX_BATCH_SIZE, generate_embeddings
from app.core.config import REPOSITORY_ROOT, auto_generate_content_enabled, embeddings_enabled
from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document, DocumentChunk, ProcessingAttempt
from app.db.queries import lightweight
from app.processing.chunking import TextChunk, chunk_pages
from app.processing.pdf_extraction import ExtractedPage, PDFExtractionError, extract_pdf
from app.services.insights import create_insights
from app.services.summaries import create_summary

logger = logging.getLogger(__name__)


@dataclass
class ProcessingContext:
    document_id: UUID
    attempt_id: UUID = field(default_factory=uuid4)
    started: float = field(default_factory=perf_counter)
    input_tokens: int = 0


@dataclass(frozen=True)
class ChunkEmbedding:
    chunk_index: int
    vector: list[float]
    model: str


def greet(name: str) -> str:
    """Small queue demo used by the learning CLI."""
    return f"Hello, {name}! Your background worker is running."


def _claim_document(context: ProcessingContext) -> tuple[str | None, str]:
    """Atomically claim one document and start its attempt; duplicates are skipped."""
    with Session(engine) as session:
        storage_path = session.scalar(
            update(Document)
            .where(Document.id == context.document_id, Document.status.in_(("queued", "failed")))
            .values(status="processing", error_message=None)
            .returning(Document.storage_path)
        )
        if storage_path is None:
            document = session.get(Document, context.document_id, options=lightweight())
            if document is None:
                raise ValueError("Document not found")
            return None, document.status
        session.add(ProcessingAttempt(id=context.attempt_id, document_id=context.document_id))
        session.commit()
        return storage_path, "processing"


def _finish_attempt(
    session: Session,
    context: ProcessingContext,
    status: str,
    error_message: str | None = None,
) -> None:
    session.execute(
        update(ProcessingAttempt)
        .where(ProcessingAttempt.id == context.attempt_id)
        .values(
            status=status,
            finished_at=datetime.now(timezone.utc),
            duration_ms=max(0, round((perf_counter() - context.started) * 1000)),
            embedding_input_tokens=context.input_tokens,
            error_message=error_message,
        )
    )


def _stored_pdf_path(storage_path: str) -> Path:
    path = (REPOSITORY_ROOT / storage_path).resolve()
    if not path.is_relative_to((REPOSITORY_ROOT / "storage" / "documents").resolve()):
        raise PDFExtractionError("Invalid document storage path.")
    return path


def _save_extracted_content(
    context: ProcessingContext,
    pages: list[ExtractedPage],
    chunks: list[TextChunk],
    *,
    continue_with_embeddings: bool,
) -> None:
    """Replace pages/chunks atomically; keep text if a later provider request fails."""
    with Session(engine) as session:
        session.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == context.document_id)
        )
        session.add_all(
            [DocumentChunk(document_id=context.document_id, **asdict(chunk)) for chunk in chunks]
        )
        session.execute(
            update(Document)
            .where(Document.id == context.document_id)
            .values(
                extracted_pages=[asdict(page) for page in pages],
                status="processing" if continue_with_embeddings else "extracted",
                error_message=None,
            )
        )
        if not continue_with_embeddings:
            _finish_attempt(session, context, "succeeded")
        session.commit()


def _embed_chunks(context: ProcessingContext, chunks: list[TextChunk]) -> list[ChunkEmbedding]:
    """Call the provider without an open transaction; retain usage on later failures."""
    embeddings = []
    for start in range(0, len(chunks), MAX_BATCH_SIZE):
        chunk_batch = chunks[start : start + MAX_BATCH_SIZE]
        batch = generate_embeddings([chunk.text for chunk in chunk_batch])
        context.input_tokens += batch.input_tokens
        if len(batch.vectors) != len(chunk_batch) or batch.model != EMBEDDING_MODEL:
            raise ValueError("Embeddings do not match the document chunks or model")
        embeddings.extend(
            ChunkEmbedding(chunk.chunk_index, vector, batch.model)
            for chunk, vector in zip(chunk_batch, batch.vectors, strict=True)
        )
    return embeddings


def _save_embeddings(context: ProcessingContext, embeddings: list[ChunkEmbedding]) -> None:
    """Commit all vectors, final document status and successful attempt together."""
    with Session(engine) as session:
        for embedding in embeddings:
            session.execute(
                update(DocumentChunk)
                .where(
                    DocumentChunk.document_id == context.document_id,
                    DocumentChunk.chunk_index == embedding.chunk_index,
                )
                .values(embedding=embedding.vector, embedding_model=embedding.model)
            )
        session.execute(
            update(Document)
            .where(Document.id == context.document_id)
            .values(status="embedded", error_message=None)
        )
        _finish_attempt(session, context, "succeeded")
        session.commit()


def _record_failure(context: ProcessingContext, error: Exception) -> None:
    message = str(error) if isinstance(error, PDFExtractionError) else "Document processing failed."
    with Session(engine) as session:
        session.execute(
            update(Document)
            .where(Document.id == context.document_id)
            .values(status="failed", error_message=message)
        )
        _finish_attempt(session, context, "failed", message)
        session.commit()


def _generate_content(document_id: UUID) -> dict[str, str]:
    """Best effort: a summary and insights are conveniences, never a reason to fail a document.

    The document is already searchable when this runs, and anything that fails here can still be
    generated on demand from the API. Results that already exist are reused, not regenerated.
    """
    outcomes = {}
    for name, create in (("summary", create_summary), ("insights", create_insights)):
        started = perf_counter()
        try:
            create(document_id)
            outcomes[name] = "saved"
        except Exception as error:
            outcomes[name] = "failed"
            logger.warning(
                "auto_generation_failed",
                extra={
                    "document_id": str(document_id),
                    "content": name,
                    "reason": error.detail if isinstance(error, AppError) else type(error).__name__,
                    "duration_ms": round((perf_counter() - started) * 1000),
                },
            )
    return outcomes


def extract_document(document_id: str) -> dict:
    """Process one queued document; configuration controls whether embeddings run."""
    context = ProcessingContext(document_id=UUID(document_id))
    storage_path, current_status = _claim_document(context)
    if storage_path is None:
        logger.info(
            "document_processing_skipped",
            extra={"document_id": document_id, "status": current_status},
        )
        return {"document_id": document_id, "status": current_status, "skipped": True}
    logger.info(
        "document_processing_started",
        extra={"document_id": document_id, "attempt_id": str(context.attempt_id)},
    )
    try:
        pages = extract_pdf(_stored_pdf_path(storage_path))
        chunks = chunk_pages(pages)
        should_embed = embeddings_enabled()
        _save_extracted_content(context, pages, chunks, continue_with_embeddings=should_embed)
        if should_embed:
            _save_embeddings(context, _embed_chunks(context, chunks))
        logger.info(
            "document_processing_finished",
            extra={
                "document_id": document_id,
                "attempt_id": str(context.attempt_id),
                "pages": len(pages),
                "chunks": len(chunks),
                "embedding_input_tokens": context.input_tokens,
                "duration_ms": round((perf_counter() - context.started) * 1000),
            },
        )
        result = {
            "document_id": document_id,
            "status": "embedded" if should_embed else "extracted",
            "page_count": len(pages),
            "chunk_count": len(chunks),
            "embedding_input_tokens": context.input_tokens,
            "processing_attempt_id": str(context.attempt_id),
        }
    except Exception as error:
        logger.exception(
            "document_processing_failed",
            extra={
                "document_id": document_id,
                "attempt_id": str(context.attempt_id),
                "duration_ms": round((perf_counter() - context.started) * 1000),
            },
        )
        _record_failure(context, error)
        raise
    # Reached only on success: the attempt is already recorded, so nothing below can fail it.
    if should_embed and auto_generate_content_enabled():
        result["generated"] = _generate_content(UUID(document_id))
        logger.info(
            "auto_generation_finished",
            extra={"document_id": document_id, **result["generated"]},
        )
    return result
