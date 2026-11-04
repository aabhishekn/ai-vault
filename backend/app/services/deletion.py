"""Delete documents together with everything derived from them.

Chunks, single-document conversations and processing attempts are removed by the database
(`ON DELETE CASCADE`). Conversations that span several documents quote the deleted one in
their answers, so they are removed too. Stored PDFs are deleted after the transaction commits.
"""

import logging
from uuid import UUID

from sqlalchemy import delete, exists, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import REPOSITORY_ROOT, STORAGE_DIR
from app.core.errors import ConflictError, DependencyUnavailableError
from app.db.database import engine
from app.db.models import Conversation, ConversationDocument, Document, ProcessingAttempt
from app.db.queries import get_document_or_raise
from app.services.reprocessing import close_abandoned_attempts
from app.tasks.events import publish_deleted

logger = logging.getLogger(__name__)


def delete_document(document_id: UUID, *, all_versions: bool = False) -> None:
    """Delete one version of a document, or every version when `all_versions` is set.

    Deleting the newest version makes the one before it the current version again. A
    document that a worker is processing right now cannot be deleted; try again once it
    finishes (a job abandoned by a dead worker does not count as running).
    """
    try:
        with Session(engine) as session:
            document = get_document_or_raise(session, document_id)
            group_id, was_latest = document.group_id, document.is_latest
            if all_versions:
                rows = session.execute(
                    select(Document.id, Document.storage_path).where(Document.group_id == group_id)
                ).all()
            else:
                rows = [(document.id, document.storage_path)]
            ids = [row[0] for row in rows]

            for identifier in ids:
                close_abandoned_attempts(session, identifier)
            running = session.scalar(
                select(
                    exists().where(
                        ProcessingAttempt.document_id.in_(ids),
                        ProcessingAttempt.status == "processing",
                    )
                )
            )
            if running:
                raise ConflictError(
                    "Document is still being processed. Try again once it finishes."
                )

            session.execute(
                delete(Conversation).where(
                    Conversation.id.in_(
                        select(ConversationDocument.conversation_id).where(
                            ConversationDocument.document_id.in_(ids)
                        )
                    )
                )
            )
            session.execute(delete(Document).where(Document.id.in_(ids)))
            if was_latest and not all_versions:
                newest = session.scalar(
                    select(Document.id)
                    .where(Document.group_id == group_id)
                    .order_by(Document.version_number.desc())
                    .limit(1)
                )
                if newest is not None:
                    session.execute(
                        update(Document).where(Document.id == newest).values(is_latest=True)
                    )
            session.commit()
    except SQLAlchemyError:
        raise DependencyUnavailableError("Unable to delete the document") from None

    for identifier, storage_path in rows:
        _remove_stored_file(identifier, storage_path)
        publish_deleted(identifier)
    logger.info(
        "document_deleted",
        extra={
            "document_ids": [str(identifier) for identifier in ids],
            "all_versions": all_versions,
        },
    )


def _remove_stored_file(document_id: UUID, storage_path: str) -> None:
    """Best effort: the record is already gone, so a leftover file is only wasted disk."""
    path = (REPOSITORY_ROOT / storage_path).resolve()
    if not path.is_relative_to(STORAGE_DIR.resolve()):
        logger.warning("document_file_outside_storage", extra={"document_id": str(document_id)})
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("document_file_delete_failed", extra={"document_id": str(document_id)})
