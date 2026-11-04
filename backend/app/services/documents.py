import hashlib
import logging
from typing import BinaryIO
from uuid import UUID, uuid4

from redis.exceptions import RedisError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import MAX_UPLOAD_BYTES, STORAGE_DIR
from app.core.errors import (
    ConflictError,
    ContentTooLargeError,
    DependencyUnavailableError,
    InvalidInputError,
    StorageError,
    UnsupportedDocumentError,
)
from app.db.database import engine
from app.db.models import Document
from app.db.queries import get_document_or_raise, lightweight, list_documents_query
from app.schemas.documents import (
    DocumentListResponse,
    DocumentResponse,
    DocumentVersion,
    DocumentVersionsResponse,
)
from app.tasks.documents import extract_document
from app.tasks.events import publish_status
from app.tasks.queue import document_queue


def upload_document(filename: str | None, stream: BinaryIO) -> DocumentResponse:
    return _save_upload(filename, stream, None)


def upload_new_version(
    document_id: UUID, filename: str | None, stream: BinaryIO
) -> DocumentResponse:
    """Add a file as the next version of an existing document and queue its processing.

    Each version is processed, searched and chatted with on its own. The previous
    versions stay available; only the newest one is listed by default.
    """
    return _save_upload(filename, stream, document_id)


def _next_version(session: Session, parent_id: UUID, content_hash: str) -> tuple[UUID, int]:
    """Group and number for a new version, retiring the current latest one."""
    group_id = get_document_or_raise(session, parent_id).group_id
    latest = session.execute(
        select(Document.version_number, Document.content_hash).where(
            Document.group_id == group_id, Document.is_latest
        )
    ).first()
    if latest is not None and latest.content_hash == content_hash:
        raise ConflictError(f"This file is identical to the current version (v{latest[0]})")
    session.execute(
        update(Document)
        .where(Document.group_id == group_id, Document.is_latest)
        .values(is_latest=False)
    )
    highest = session.scalar(
        select(func.max(Document.version_number)).where(Document.group_id == group_id)
    )
    return group_id, (highest or 0) + 1


def _save_upload(
    filename: str | None, stream: BinaryIO, parent_id: UUID | None
) -> DocumentResponse:
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
    digest = hashlib.sha256()
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
            digest.update(header)
            size = len(header)
            while chunk := stream.read(64 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ContentTooLargeError("PDF must be 10 MiB or smaller")
                output.write(chunk)
                digest.update(chunk)
        with Session(engine) as session:
            group_id, version_number = document_id, 1
            if parent_id is not None:
                group_id, version_number = _next_version(session, parent_id, digest.hexdigest())
            document = Document(
                id=document_id,
                group_id=group_id,
                version_number=version_number,
                content_hash=digest.hexdigest(),
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
            publish_status(document_id, "queued")
        except RedisError:
            raise DependencyUnavailableError(
                {
                    "message": "Document saved, but queue confirmation failed. Check this document before retrying processing.",
                    "document_id": str(document_id),
                }
            ) from None
        return response
    except IntegrityError:
        raise ConflictError("Another version was uploaded at the same time. Try again.") from None
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


def list_versions(document_id: UUID) -> DocumentVersionsResponse:
    """Every version of a document, newest first. Any version's id works."""
    try:
        with Session(engine) as session:
            group_id = get_document_or_raise(session, document_id).group_id
            versions = session.scalars(
                select(Document)
                .options(*lightweight())
                .where(Document.group_id == group_id)
                .order_by(Document.version_number.desc())
            ).all()
            return DocumentVersionsResponse(
                group_id=group_id,
                versions=[DocumentVersion.model_validate(item) for item in versions],
            )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to list document versions") from None


def get_document(document_id: UUID) -> DocumentResponse:
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            return DocumentResponse.model_validate(document)
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to retrieve document metadata") from None


def list_documents(
    limit: int = 20,
    offset: int = 0,
    category: str | None = None,
    tag: str | None = None,
    include_old_versions: bool = False,
) -> DocumentListResponse:
    """Newest first; `category` and `tag` narrow the list (and its total).

    Only the latest version of each document is listed unless `include_old_versions`.
    """
    filters = [] if include_old_versions else [Document.is_latest]
    if category:
        filters.append(Document.category == category)
    if tag:
        filters.append(Document.tags.contains([" ".join(tag.lower().split())]))
    try:
        with Session(engine) as session:
            total = session.scalar(select(func.count()).select_from(Document).where(*filters))
            documents = session.scalars(
                list_documents_query()
                .where(*filters)
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
