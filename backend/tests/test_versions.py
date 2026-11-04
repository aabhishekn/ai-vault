import io
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document
from app.main import create_app
from app.schemas.documents import DocumentVersion, DocumentVersionsResponse
from app.services import documents
from tests.support import requires_database


def pdf(body: str) -> io.BytesIO:
    return io.BytesIO(b"%PDF-1.4\n" + body.encode())


@requires_database
class TestVersions:
    def setup_method(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = Path(self.directory.name) / "storage" / "documents"
        self.ids = []
        self.patches = [
            patch.object(documents, "STORAGE_DIR", self.storage),
            patch.object(documents.document_queue, "enqueue", side_effect=self.track),
        ]
        for item in self.patches:
            item.start()

    def teardown_method(self):
        for item in self.patches:
            item.stop()
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()
        self.directory.cleanup()

    def track(self, function, identifier, **kwargs):
        from uuid import UUID

        self.ids.append(UUID(identifier))

    def test_a_first_upload_is_version_one_of_its_own_group(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        assert (first.version_number, first.is_latest, first.group_id) == (1, True, first.id)

    def test_new_versions_number_up_and_retire_the_previous_latest(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        second = documents.upload_new_version(first.id, "a-v2.pdf", pdf("two"))
        third = documents.upload_new_version(second.id, "a-v3.pdf", pdf("three"))
        assert [d.version_number for d in (second, third)] == [2, 3]
        assert second.group_id == third.group_id == first.id
        listing = documents.list_versions(first.id)
        assert [(v.version_number, v.is_latest) for v in listing.versions] == [
            (3, True),
            (2, False),
            (1, False),
        ]
        # Any version's id finds the same group.
        assert documents.list_versions(third.id).group_id == first.id

    def test_the_list_shows_only_latest_versions_unless_asked(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        second = documents.upload_new_version(first.id, "a2.pdf", pdf("two"))
        latest = {d.id for d in documents.list_documents(100, 0).items}
        assert second.id in latest and first.id not in latest
        everything = {
            d.id for d in documents.list_documents(100, 0, include_old_versions=True).items
        }
        assert {first.id, second.id} <= everything

    def test_an_identical_file_is_rejected_and_leaves_nothing_behind(self):
        first = documents.upload_document("a.pdf", pdf("same"))
        files = sorted(p.name for p in self.storage.iterdir())
        with pytest.raises(AppError) as error:
            documents.upload_new_version(first.id, "copy.pdf", pdf("same"))
        assert error.value.status_code == 409 and "identical" in error.value.detail
        assert sorted(p.name for p in self.storage.iterdir()) == files
        with Session(engine) as session:
            assert session.scalar(select(Document.is_latest).where(Document.id == first.id))

    def test_an_unknown_parent_is_not_found_and_stores_no_file(self):
        with pytest.raises(AppError) as error:
            documents.upload_new_version(uuid4(), "a.pdf", pdf("x"))
        assert error.value.status_code == 404
        assert list(self.storage.iterdir()) == []

    def test_a_simultaneous_upload_of_the_same_number_is_a_conflict(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        files = sorted(p.name for p in self.storage.iterdir())
        # Simulate losing the race: another request already took version 2.
        with patch.object(documents, "_next_version", return_value=(first.id, 1)):
            with pytest.raises(AppError) as error:
                documents.upload_new_version(first.id, "a2.pdf", pdf("two"))
        assert error.value.status_code == 409 and "same time" in error.value.detail
        assert sorted(p.name for p in self.storage.iterdir()) == files

    def test_invalid_files_are_still_rejected_as_versions(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        with pytest.raises(AppError) as error:
            documents.upload_new_version(first.id, "notes.txt", io.BytesIO(b"x"))
        assert error.value.status_code == 415


def test_endpoints_are_wired():
    document_id = uuid4()
    listing = DocumentVersionsResponse(
        group_id=document_id,
        versions=[
            DocumentVersion(
                id=document_id,
                version_number=1,
                filename="a.pdf",
                size_bytes=9,
                status="queued",
                is_latest=True,
                created_at="2026-11-04T00:00:00Z",
            )
        ],
    )
    with patch.object(documents, "list_versions", return_value=listing):
        reply = TestClient(create_app()).get(f"/documents/{document_id}/versions")
    assert reply.status_code == 200 and reply.json()["versions"][0]["version_number"] == 1
