"""RQ entry point and explicit database boundaries for document processing."""

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import UUID, uuid4

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.ai.embed_model import VaultEmbedding
from app.ai.embeddings import EMBEDDING_MODEL
from app.ai.ocr import ocr_pages
from app.core.config import (
    IMAGE_SUFFIXES,
    REPOSITORY_ROOT,
    auto_generate_content_enabled,
    embeddings_enabled,
    ocr_max_pages,
)
from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document, DocumentChunk, ProcessingAttempt
from app.db.queries import lightweight
from app.processing.chunking import TextChunk, chunk_pages
from app.processing.page_images import load_image, render_pdf_pages
from app.processing.pdf_extraction import (
    ExtractedPage,
    NoTextError,
    PDFExtractionError,
    extract_pdf,
)
from app.services.classification import create_classification
from app.services.insights import create_insights
from app.services.summaries import create_summary
from app.tasks.events import publish_content_ready, publish_status

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
            # Deleted while the job waited in the queue: nothing left to process.
            return None, "deleted" if document is None else document.status
        session.add(ProcessingAttempt(id=context.attempt_id, document_id=context.document_id))
        session.commit()
    publish_status(context.document_id, "processing")
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


def _stored_file_path(storage_path: str) -> Path:
    path = (REPOSITORY_ROOT / storage_path).resolve()
    if not path.is_relative_to((REPOSITORY_ROOT / "storage" / "documents").resolve()):
        raise PDFExtractionError("Invalid document storage path.")
    return path


def _extract_pages(path: Path) -> list[ExtractedPage]:
    """Page text from the stored file: read directly when it has a text layer, else as images.

    Pictures and PDFs without text (scans, "print to PDF") go to the vision model, which is a
    paid request per page; a PDF that already has text never does.
    """
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return ocr_pages([load_image(path)])
    try:
        return extract_pdf(path)
    except NoTextError:
        logger.info("document_read_as_images", extra={"file": path.name})
        return ocr_pages(render_pdf_pages(path, ocr_max_pages()))


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
    if not continue_with_embeddings:
        publish_status(context.document_id, "extracted")


def _embed_chunks(context: ProcessingContext, chunks: list[TextChunk]) -> list[ChunkEmbedding]:
    """Call the provider without an open transaction; retain usage on later failures."""
    embed_model = VaultEmbedding()
    try:
        vectors = embed_model.get_text_embedding_batch([chunk.text for chunk in chunks])
    finally:
        # Tokens already spent are recorded even when a later batch fails.
        context.input_tokens += embed_model.input_tokens
    if len(vectors) != len(chunks):
        raise ValueError("Embeddings do not match the document chunks")
    return [
        ChunkEmbedding(chunk.chunk_index, vector, EMBEDDING_MODEL)
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]


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
    publish_status(context.document_id, "embedded")


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
    publish_status(context.document_id, "failed")


def _generate_content(document_id: UUID) -> dict[str, str]:
    """Best effort: a summary, insights and a category are conveniences, never a reason to fail a document.

    The document is already searchable when this runs, and anything that fails here can still be
    generated on demand from the API. Results that already exist are reused, not regenerated.
    """
    outcomes = {}
    for name, create in (
        ("summary", create_summary),
        ("insights", create_insights),
        ("classification", create_classification),
    ):
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
        pages = _extract_pages(_stored_file_path(storage_path))
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
        publish_content_ready(document_id)
        logger.info(
            "auto_generation_finished",
            extra={"document_id": document_id, **result["generated"]},
        )
    return result
