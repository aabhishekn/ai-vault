import logging
from typing import BinaryIO
from uuid import UUID, uuid4

from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import MAX_UPLOAD_BYTES, STORAGE_DIR
from app.core.errors import (
    ContentTooLargeError,
    DependencyUnavailableError,
    InvalidInputError,
    StorageError,
    UnsupportedDocumentError,
)
from app.db.database import engine
from app.db.models import Document
from app.db.queries import get_document_or_raise
from app.schemas.documents import DocumentListResponse, DocumentResponse
from app.tasks.documents import extract_document
from app.tasks.queue import document_queue


def upload_document(filename: str | None, stream: BinaryIO) -> DocumentResponse:
    filename = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename or len(filename) > 255:
        raise InvalidInputError("A filename of at most 255 characters is required")
    if not filename.lower().endswith(".pdf"):
        raise UnsupportedDocumentError("Only PDF files are supported")
    document_id = uuid4()
    destination = STORAGE_DIR / f"{document_id}.pdf"
    size = 0
    created = False
    committed = False
    try:
        header = stream.read(5)
        if not header:
            raise InvalidInputError("The uploaded file is empty")
        if header != b"%PDF-":
            raise UnsupportedDocumentError("The file must have a PDF header")
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            created = True
            output.write(header)
            size = len(header)
            while chunk := stream.read(64 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ContentTooLargeError("PDF must be 10 MiB or smaller")
                output.write(chunk)
        with Session(engine) as session:
            document = Document(
                id=document_id,
                filename=filename,
                storage_path=str(destination.relative_to(STORAGE_DIR.parent.parent)),
                content_type="application/pdf",
                size_bytes=size,
            )
            session.add(document)
            session.flush()
            response = DocumentResponse.model_validate(document)
            session.commit()
            committed = True
        try:
            document_queue.enqueue(extract_document, str(document_id), result_ttl=3600)
        except RedisError:
            raise DependencyUnavailableError(
                {
                    "message": "Document saved, but queue confirmation failed. Check this document before retrying processing.",
                    "document_id": str(document_id),
                }
            ) from None
        return response
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to save document metadata") from None
    except OSError:
        raise StorageError("Unable to save uploaded file") from None
    finally:
        if created and (not committed):
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                logging.getLogger(__name__).warning(
                    "Unable to clean up uncommitted upload %s", document_id
                )


def get_document(document_id: UUID) -> DocumentResponse:
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            return DocumentResponse.model_validate(document)
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to retrieve document metadata") from None


def list_documents(limit: int = 20, offset: int = 0) -> DocumentListResponse:
    try:
        with Session(engine) as session:
            total = session.scalar(select(func.count()).select_from(Document))
            documents = session.scalars(
                select(Document)
                .order_by(Document.created_at.desc(), Document.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
            return DocumentListResponse(
                items=[DocumentResponse.model_validate(doc) for doc in documents],
                total=total,
                limit=limit,
                offset=offset,
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to list documents") from None
