from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.database import engine
from app.db.models import Document
from app.main import create_app
from app.schemas.documents import DocumentListResponse
from app.services import documents
from tests.support import requires_database


def test_the_list_route_passes_the_search_words_on():
    empty = DocumentListResponse(items=[], total=0, limit=20, offset=0)
    client = TestClient(create_app())
    with patch.object(documents, "list_documents", return_value=empty) as service:
        assert client.get("/documents", params={"q": "lease terms"}).status_code == 200
    service.assert_called_once_with(20, 0, "lease terms", False)


def test_an_overlong_search_is_rejected():
    assert TestClient(create_app()).get("/documents", params={"q": "x" * 101}).status_code == 422


@requires_database
class TestDocumentSearch:
    def setup_method(self):
        self.ids = []

    def teardown_method(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()

    def add(self, filename, title=None, category=None):
        identifier = uuid4()
        self.ids.append(identifier)
        with Session(engine) as session:
            session.add(
                Document(
                    id=identifier,
                    filename=filename,
                    title=title,
                    category=category,
                    storage_path=f"storage/documents/{identifier}.pdf",
                    content_type="application/pdf",
                    size_bytes=10,
                    status="embedded",
                )
            )
            session.commit()
        return identifier

    def found(self, query):
        return {d.id for d in documents.list_documents(100, 0, query).items}

    def test_it_matches_the_title_the_file_name_and_the_category_in_any_case(self):
        by_title = self.add("zq-1.pdf", title="Quarterly Budget Review")
        by_file = self.add("zq-Lease_Draft.pdf")
        by_category = self.add("zq-3.pdf", category="Interview Guide")
        assert by_title in self.found("budget")
        assert by_title in self.found("QUARTERLY")
        assert by_file in self.found("lease_draft")
        assert by_category in self.found("interview")
        assert not {by_file, by_category} & self.found("budget")

    def test_every_word_has_to_match_but_not_in_the_same_field(self):
        a = self.add("zq-a.pdf", title="Backend Resume", category="Resume")
        b = self.add("zq-b.pdf", title="Backend Design", category="Technical")
        both = self.found("resume zq-a")
        assert a in both and b not in both
        assert {a, b} <= self.found("backend")
        assert a not in self.found("backend design")

    def test_percent_and_underscore_are_plain_characters(self):
        plain = self.add("zqplain.pdf")
        under = self.add("zq_under.pdf")
        assert under in self.found("zq_under") and plain not in self.found("zq_under")
        assert self.found("zq%") == set()
        assert plain not in self.found("_")

    def test_a_blank_search_lists_everything_and_totals_match_the_matches(self):
        first = self.add("zq-x.pdf", title="Zq Needle One")
        second = self.add("zq-y.pdf", title="Zq Needle Two")
        everything = documents.list_documents(100, 0, "   ")
        assert {first, second} <= {d.id for d in everything.items}
        narrowed = documents.list_documents(1, 0, "zq needle")
        assert narrowed.total == 2 and len(narrowed.items) == 1
        assert documents.list_documents(100, 0, "zq needle nomatch").total == 0
