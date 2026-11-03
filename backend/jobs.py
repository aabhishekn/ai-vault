from dataclasses import asdict
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from chunking import chunk_pages
from database import engine
from models import Document, DocumentChunk
from pdf_extraction import PDFExtractionError, extract_pdf

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


def greet(name: str) -> str:
    """A small demo job to verify the queue before adding PDF processing."""
    return f"Hello, {name}! Your background worker is running."


def extract_document(document_id: str) -> dict:
    """Claim a waiting document, extract its pages, and persist pages and chunks."""
    identifier = UUID(document_id)
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
        session.commit()

    try:
        path = (REPOSITORY_ROOT / storage_path).resolve()
        if not path.is_relative_to((REPOSITORY_ROOT / "storage" / "documents").resolve()):
            raise PDFExtractionError("Invalid document storage path.")
        pages = extract_pdf(path)
        chunks = chunk_pages(pages)
        with Session(engine) as session:
            # Replace old chunks on retries; pages, chunks and status commit together.
            session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == identifier))
            session.add_all([
                DocumentChunk(document_id=identifier, **asdict(chunk)) for chunk in chunks
            ])
            session.execute(
                update(Document).where(Document.id == identifier).values(
                    extracted_pages=[asdict(page) for page in pages],
                    status="extracted", error_message=None,
                )
            )
            session.commit()
        return {"document_id": document_id, "status": "extracted",
                "page_count": len(pages), "chunk_count": len(chunks)}
    except Exception as error:
        message = str(error) if isinstance(error, PDFExtractionError) else "Document text extraction failed."
        with Session(engine) as session:
            session.execute(
                update(Document).where(Document.id == identifier).values(
                    status="failed", error_message=message,
                )
            )
            session.commit()
        raise
