from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.db.models import Document


def get_document_or_raise(session: Session, document_id: UUID) -> Document:
    document = session.get(Document, document_id)
    if document is None:
        raise NotFoundError("Document not found")
    return document
