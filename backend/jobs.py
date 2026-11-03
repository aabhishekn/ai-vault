import os
from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path
from time import perf_counter
from uuid import UUID, uuid4

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from chunking import chunk_pages
from database import engine
from embeddings import MAX_BATCH_SIZE, generate_embeddings
from models import Document, DocumentChunk, ProcessingAttempt
from pdf_extraction import PDFExtractionError, extract_pdf

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


def greet(name: str) -> str:
    """A small demo job to verify the queue before adding PDF processing."""
    return f"Hello, {name}! Your background worker is running."


def extract_document(document_id: str) -> dict:
    """Extract a waiting document and optionally generate and store its embeddings."""
    identifier = UUID(document_id)
    started = perf_counter()
    attempt_id = uuid4()
    input_tokens = 0

    def finish_attempt(session, status, error_message=None):
        session.execute(update(ProcessingAttempt).where(ProcessingAttempt.id == attempt_id).values(
            status=status, finished_at=datetime.now(timezone.utc),
            duration_ms=max(0, round((perf_counter() - started) * 1000)),
            embedding_input_tokens=input_tokens, error_message=error_message,
        ))

    with Session(engine) as session:
        # Only one worker can claim this document, even if it is queued twice.
        storage_path = session.scalar(
            update(Document)
            .where(Document.id == identifier, Document.status.in_(["queued", "failed"]))
            .values(status="processing", error_message=None)
            .returning(Document.storage_path)
        )
        if storage_path is None:
            document = session.get(Document, identifier)
            if document is None:
                raise ValueError("Document not found")
            return {"document_id": document_id, "status": document.status, "skipped": True}
        session.add(ProcessingAttempt(id=attempt_id, document_id=identifier))
        session.commit()

    try:
        path = (REPOSITORY_ROOT / storage_path).resolve()
        if not path.is_relative_to((REPOSITORY_ROOT / "storage" / "documents").resolve()):
            raise PDFExtractionError("Invalid document storage path.")
        pages = extract_pdf(path)
        chunks = chunk_pages(pages)
        embeddings_enabled = os.getenv("ENABLE_EMBEDDINGS", "false").lower() == "true"
        with Session(engine) as session:
            # Replace old chunks on retries; pages, chunks and status commit together.
            session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == identifier))
            session.add_all([
                DocumentChunk(document_id=identifier, **asdict(chunk)) for chunk in chunks
            ])
            session.execute(
                update(Document).where(Document.id == identifier).values(
                    extracted_pages=[asdict(page) for page in pages],
                    status="processing" if embeddings_enabled else "extracted", error_message=None,
                )
            )
            if not embeddings_enabled:
                finish_attempt(session, "succeeded")
            session.commit()
        status = "extracted"
        if embeddings_enabled:
            # Provider requests happen outside database transactions. Save all vectors
            # together only after every batch succeeds; extracted text survives failure.
            vectors = []
            models = []
            for start in range(0, len(chunks), MAX_BATCH_SIZE):
                batch = generate_embeddings([
                    chunk.text for chunk in chunks[start:start + MAX_BATCH_SIZE]
                ])
                vectors.extend(batch.vectors)
                models.extend([batch.model] * len(batch.vectors))
                input_tokens += batch.input_tokens
            if len(vectors) != len(chunks):
                raise ValueError("Embedding count does not match document chunks")
            with Session(engine) as session:
                for chunk, vector, model in zip(chunks, vectors, models, strict=True):
                    session.execute(
                        update(DocumentChunk).where(
                            DocumentChunk.document_id == identifier,
                            DocumentChunk.chunk_index == chunk.chunk_index,
                        ).values(embedding=vector, embedding_model=model)
                    )
                session.execute(update(Document).where(Document.id == identifier).values(
                    status="embedded", error_message=None,
                ))
                finish_attempt(session, "succeeded")
                session.commit()
            status = "embedded"
        return {"document_id": document_id, "status": status,
                "page_count": len(pages), "chunk_count": len(chunks),
                "embedding_input_tokens": input_tokens, "processing_attempt_id": str(attempt_id)}
    except Exception as error:
        message = str(error) if isinstance(error, PDFExtractionError) else "Document processing failed."
        with Session(engine) as session:
            session.execute(
                update(Document).where(Document.id == identifier).values(
                    status="failed", error_message=message,
                )
            )
            finish_attempt(session, "failed", message)
            session.commit()
        raise
