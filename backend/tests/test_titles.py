import io
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document
from app.services import documents
from tests.support import requires_database


def pdf(body: str) -> io.BytesIO:
    return io.BytesIO(b"%PDF-1.4\n" + body.encode())


@requires_database
class TestRename:
    def setup_method(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = Path(self.directory.name) / "storage" / "documents"
        self.ids = []
        self.published = []
        self.patches = [
            patch.object(documents, "STORAGE_DIR", self.storage),
            patch.object(documents.document_queue, "enqueue", side_effect=self.track),
            patch.object(documents, "publish_status"),
            patch.object(documents, "publish_updated", side_effect=self.published.append),
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

    def stored(self, identifier):
        with Session(engine) as session:
            document = session.get(Document, identifier)
            return document.title, document.title_source

    def test_a_new_upload_shows_its_file_name_until_it_is_named(self):
        created = documents.upload_document("a.pdf", pdf("one"))
        assert (created.title, created.title_source) == (None, None)

    def test_renaming_saves_a_person_s_title_and_announces_it(self):
        created = documents.upload_document("a.pdf", pdf("one"))
        renamed = documents.rename_document(created.id, "Q3 Plan")
        assert (renamed.title, renamed.title_source) == ("Q3 Plan", "user")
        assert self.stored(created.id) == ("Q3 Plan", "user")
        assert documents.get_document(created.id).title == "Q3 Plan"
        assert self.published == [created.id]

    def test_a_blank_title_goes_back_to_the_file_name(self):
        created = documents.upload_document("a.pdf", pdf("one"))
        documents.rename_document(created.id, "Q3 Plan")
        cleared = documents.rename_document(created.id, None)
        assert (cleared.title, cleared.title_source) == (None, None)
        assert self.stored(created.id) == (None, None)

    def test_renaming_names_every_version_of_the_document(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        second = documents.upload_new_version(first.id, "a2.pdf", pdf("two"))
        documents.rename_document(first.id, "Q3 Plan")
        assert self.stored(first.id) == self.stored(second.id) == ("Q3 Plan", "user")
        listing = documents.list_versions(second.id)
        assert {version.title for version in listing.versions} == {"Q3 Plan"}

    def test_a_new_version_keeps_a_person_s_title(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        documents.rename_document(first.id, "Q3 Plan")
        second = documents.upload_new_version(first.id, "a2.pdf", pdf("two"))
        assert (second.title, second.title_source) == ("Q3 Plan", "user")

    def test_a_new_version_does_not_inherit_an_ai_title(self):
        first = documents.upload_document("a.pdf", pdf("one"))
        with Session(engine) as session:
            session.get(Document, first.id).title = "Written By AI"
            session.get(Document, first.id).title_source = "ai"
            session.commit()
        second = documents.upload_new_version(first.id, "a2.pdf", pdf("two"))
        assert (second.title, second.title_source) == (None, None)

    def test_an_unknown_document_is_not_found_and_nothing_is_announced(self):
        with pytest.raises(AppError) as error:
            documents.rename_document(uuid4(), "Name")
        assert error.value.status_code == 404
        assert self.published == []
