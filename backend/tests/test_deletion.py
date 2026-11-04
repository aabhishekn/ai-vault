import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import PROCESSING_STALE_AFTER_SECONDS
from app.core.errors import ConflictError, NotFoundError
from app.db.database import engine
from app.db.models import (
    Conversation,
    ConversationDocument,
    ConversationTurn,
    Document,
    DocumentChunk,
    ProcessingAttempt,
)
from app.services import deletion
from app.tasks.documents import extract_document
from tests.support import requires_database


@requires_database
class TestDeletion:
    def setup_method(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.storage = self.root / "storage" / "documents"
        self.storage.mkdir(parents=True)
        self.ids = []
        self.conversations = []
        self.published = []
        self.patches = [
            patch.object(deletion, "REPOSITORY_ROOT", self.root),
            patch.object(deletion, "STORAGE_DIR", self.storage),
            patch.object(deletion, "publish_deleted", side_effect=self.published.append),
        ]
        for item in self.patches:
            item.start()

    def teardown_method(self):
        for item in self.patches:
            item.stop()
        with Session(engine) as session:
            session.execute(delete(Conversation).where(Conversation.id.in_(self.conversations)))
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()
        self.directory.cleanup()

    def document(self, *, group=None, version=1, latest=True, status="embedded"):
        identifier = uuid4()
        self.ids.append(identifier)
        path = self.storage / f"{identifier}.pdf"
        path.write_bytes(b"%PDF-1.4")
        with Session(engine) as session:
            session.add(
                Document(
                    id=identifier,
                    group_id=group or identifier,
                    version_number=version,
                    is_latest=latest,
                    filename="a.pdf",
                    storage_path=f"storage/documents/{identifier}.pdf",
                    content_type="application/pdf",
                    size_bytes=8,
                    status=status,
                )
            )
            session.flush()
            session.add(
                DocumentChunk(document_id=identifier, chunk_index=0, page_number=1, text="text")
            )
            session.commit()
        return identifier

    def attempt(self, identifier, age_seconds=0):
        started = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        with Session(engine) as session:
            session.add(
                ProcessingAttempt(document_id=identifier, status="processing", started_at=started)
            )
            session.commit()

    def conversation(self, *document_ids, single=False):
        identifier = uuid4()
        self.conversations.append(identifier)
        with Session(engine) as session:
            session.add(
                Conversation(id=identifier, document_id=document_ids[0] if single else None)
            )
            session.flush()
            if not single:
                session.add_all(
                    ConversationDocument(conversation_id=identifier, document_id=item)
                    for item in document_ids
                )
            session.add(ConversationTurn(conversation_id=identifier, turn_number=1, response={}))
            session.commit()
        return identifier

    def count(self, model, **where):
        with Session(engine) as session:
            statement = select(func.count()).select_from(model)
            for column, value in where.items():
                statement = statement.where(getattr(model, column) == value)
            return session.scalar(statement)

    def state(self, identifier):
        with Session(engine) as session:
            return session.get(Document, identifier)

    def test_removes_the_document_its_chunks_attempts_conversations_and_file(self):
        identifier = self.document()
        single = self.conversation(identifier, single=True)
        with Session(engine) as session:
            session.add(
                ProcessingAttempt(
                    document_id=identifier,
                    status="succeeded",
                    finished_at=datetime.now(timezone.utc),
                    duration_ms=5,
                )
            )
            session.commit()

        deletion.delete_document(identifier)

        assert self.state(identifier) is None
        assert self.count(DocumentChunk, document_id=identifier) == 0
        assert self.count(ProcessingAttempt, document_id=identifier) == 0
        assert self.count(Conversation, id=single) == 0
        assert self.count(ConversationTurn, conversation_id=single) == 0
        assert not (self.storage / f"{identifier}.pdf").exists()
        assert self.published == [identifier]

    def test_a_conversation_across_documents_is_removed_but_the_others_stay(self):
        kept, removed = self.document(), self.document()
        shared = self.conversation(kept, removed)
        own = self.conversation(kept, single=True)

        deletion.delete_document(removed)

        assert self.count(Conversation, id=shared) == 0
        assert self.count(ConversationDocument, conversation_id=shared) == 0
        assert self.count(Conversation, id=own) == 1
        assert self.state(kept) is not None
        assert (self.storage / f"{kept}.pdf").exists()

    def test_deleting_the_newest_version_makes_the_previous_one_current(self):
        first = self.document(latest=False)
        second = self.document(group=first, version=2, latest=False)
        third = self.document(group=first, version=3, latest=True)

        deletion.delete_document(third)

        assert self.state(third) is None
        assert self.state(second).is_latest is True
        assert self.state(first).is_latest is False

    def test_deleting_an_old_version_leaves_the_current_one_alone(self):
        first = self.document(latest=False)
        second = self.document(group=first, version=2, latest=True)

        deletion.delete_document(first)

        assert self.state(first) is None
        assert self.state(second).is_latest is True
        assert (self.storage / f"{second}.pdf").exists()

    def test_all_versions_removes_the_whole_group_and_their_files(self):
        first = self.document()
        second = self.document(group=first, version=2, latest=True)
        other = self.document()

        deletion.delete_document(second, all_versions=True)

        assert self.state(first) is None and self.state(second) is None
        assert not (self.storage / f"{first}.pdf").exists()
        assert not (self.storage / f"{second}.pdf").exists()
        assert self.state(other) is not None
        assert sorted(self.published) == sorted([first, second])

    def test_a_document_being_processed_is_refused_and_left_intact(self):
        identifier = self.document(status="processing")
        self.attempt(identifier, age_seconds=1)

        with pytest.raises(ConflictError, match="still being processed"):
            deletion.delete_document(identifier)

        assert self.state(identifier) is not None
        assert self.count(DocumentChunk, document_id=identifier) == 1
        assert (self.storage / f"{identifier}.pdf").exists()
        assert self.published == []

    def test_a_job_abandoned_by_a_dead_worker_does_not_block_deletion(self):
        identifier = self.document(status="processing")
        self.attempt(identifier, age_seconds=PROCESSING_STALE_AFTER_SECONDS + 60)

        deletion.delete_document(identifier)

        assert self.state(identifier) is None

    def test_unknown_document_is_not_found(self):
        with pytest.raises(NotFoundError):
            deletion.delete_document(uuid4())
        assert self.published == []

    def test_a_missing_file_does_not_fail_the_deletion(self):
        identifier = self.document()
        (self.storage / f"{identifier}.pdf").unlink()

        deletion.delete_document(identifier)

        assert self.state(identifier) is None

    def test_a_path_outside_storage_is_never_deleted(self):
        identifier = self.document()
        outside = self.root / "outside.pdf"
        outside.write_bytes(b"keep")
        with Session(engine) as session:
            session.get(Document, identifier).storage_path = "outside.pdf"
            session.commit()

        deletion.delete_document(identifier)

        assert self.state(identifier) is None
        assert outside.exists()

    def test_a_queued_job_for_a_deleted_document_is_skipped_not_failed(self):
        identifier = self.document(status="queued")
        deletion.delete_document(identifier)

        result = extract_document(str(identifier))

        assert result == {"document_id": str(identifier), "status": "deleted", "skipped": True}
