import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.ai.classification import (
    Classification,
    ClassificationDraft,
    classify,
    clean_category,
    clean_title,
)
from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document
from app.main import create_app
from app.services import classification as service
from tests.support import requires_database


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("  Lease   Agreement.  ", "Lease Agreement"),
        ('"Resume"', "Resume"),
        ("#Interview Guide", "Interview Guide"),
        ("   ", None),
        ('""', None),
        ("x" * 41, None),
        ("x" * 40, "x" * 40),
    ],
)
def test_categories_are_tidied_and_unusable_ones_dropped(raw, expected):
    assert clean_category(raw) == expected


def run_classify(draft, status="completed"):
    with patch("app.ai.classification.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.parse.return_value = SimpleNamespace(status=status, output_parsed=draft)
        result = classify("A summary.", ["An insight."], None)
    return result, client.responses.parse.call_args.kwargs


def test_category_and_title_come_back_with_untrusted_input_as_data():
    result, call = run_classify(
        ClassificationDraft(category=" Technical Design. ", title=' "Vault Design." ')
    )
    assert result == ("Technical Design", "Vault Design")
    assert json.loads(call["input"])["summary"] == "A summary."
    assert call["store"] is False
    assert "untrusted" in call["instructions"]


def test_the_category_is_free_form_not_picked_from_a_fixed_list():
    result, call = run_classify(ClassificationDraft(category="Resume", title="T"))
    assert result.category == "Resume"
    assert "from this list" not in call["instructions"]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("  Q3   Budget  Review.  ", "Q3 Budget Review"),
        ("“Residential Lease Agreement”", "Residential Lease Agreement"),
        ("   ", None),
        ('""', None),
        ("x" * 101, None),
        ("x" * 100, "x" * 100),
    ],
)
def test_titles_are_tidied_and_unusable_ones_dropped(raw, expected):
    assert clean_title(raw) == expected


def test_a_missing_title_does_not_fail_classification():
    result, _ = run_classify(ClassificationDraft(category="Legal", title="  "))
    assert result == ("Legal", None)


def test_the_instructions_ask_for_a_title_without_a_file_extension():
    _, call = run_classify(ClassificationDraft(category="Legal", title="T"))
    assert "title" in call["instructions"] and "file extension" in call["instructions"]


@pytest.mark.parametrize(
    "draft,status",
    [
        (ClassificationDraft(category=" # ", title="T"), "completed"),
        (ClassificationDraft(category="x" * 41, title="T"), "completed"),
        (ClassificationDraft(category="Other", title="T"), "incomplete"),
        (None, "completed"),
    ],
)
def test_unusable_output_is_rejected(draft, status):
    with pytest.raises(ValueError):
        run_classify(draft, status)


def test_empty_input_makes_no_provider_call():
    with patch("app.ai.classification.create_client") as sdk:
        with pytest.raises(ValueError):
            classify(None, [], None)
    sdk.assert_not_called()


@requires_database
class TestClassificationStorage:
    def setup_method(self):
        self.ids = []

    def teardown_method(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()

    def add(self, **fields):
        identifier = uuid4()
        self.ids.append(identifier)
        values = dict(
            filename="class-test.pdf",
            storage_path=f"storage/documents/{identifier}.pdf",
            content_type="application/pdf",
            size_bytes=10,
            status="embedded",
            summary="A summary.",
        )
        values.update(fields)
        with Session(engine) as session:
            session.add(Document(id=identifier, **values))
            session.commit()
        return identifier

    def test_classification_is_saved_once_and_reused(self):
        identifier = self.add()
        with patch.object(
            service, "classify", return_value=Classification("Finance", "Q3 Budget Review")
        ) as ai:
            first = service.create_classification(identifier)
            second = service.create_classification(identifier)
        assert first.category == "Finance"
        assert second == first and ai.call_count == 1
        assert service.get_classification(identifier) == first
        assert first.title == "Q3 Budget Review"

    def test_the_title_is_saved_as_ai_written(self):
        identifier = self.add()
        with patch.object(service, "classify", return_value=Classification("Legal", "Lease")):
            service.create_classification(identifier)
        with Session(engine) as session:
            saved = session.get(Document, identifier)
            assert (saved.title, saved.title_source) == ("Lease", "ai")

    def test_a_person_s_title_is_never_replaced_by_the_ai(self):
        identifier = self.add(title="My Name", title_source="user")
        with patch.object(service, "classify", return_value=Classification("Legal", "AI Name")):
            result = service.create_classification(identifier)
        assert (result.category, result.title) == ("Legal", "My Name")
        with Session(engine) as session:
            assert session.get(Document, identifier).title_source == "user"

    def test_a_document_classified_before_titles_existed_gets_only_a_title(self):
        identifier = self.add(category="Finance")
        with patch.object(
            service, "classify", return_value=Classification("Legal", "Fresh Title")
        ) as ai:
            result = service.create_classification(identifier)
            again = service.create_classification(identifier)
        assert (result.category, result.title) == ("Finance", "Fresh Title")
        assert again == result and ai.call_count == 1

    def test_no_usable_title_leaves_the_file_name_in_charge(self):
        identifier = self.add()
        with patch.object(service, "classify", return_value=Classification("Legal", None)):
            result = service.create_classification(identifier)
        assert result.title is None
        with Session(engine) as session:
            assert session.get(Document, identifier).title_source is None

    def test_a_document_without_text_or_summary_is_a_conflict(self):
        identifier = self.add(summary=None, extracted_pages=[{"page_number": 1, "text": " "}])
        with patch.object(service, "classify") as ai:
            with pytest.raises(AppError) as error:
                service.create_classification(identifier)
        assert error.value.status_code == 409
        ai.assert_not_called()

    def test_text_excerpt_is_the_fallback_source(self):
        identifier = self.add(
            summary=None, extracted_pages=[{"page_number": 1, "text": "Lease terms"}]
        )
        with patch.object(service, "classify", return_value=Classification("Legal", None)) as ai:
            service.create_classification(identifier)
        assert ai.call_args.args == (None, [], "Lease terms")

    def test_unknown_documents_and_unclassified_reads(self):
        with pytest.raises(AppError) as missing:
            service.create_classification(uuid4())
        assert missing.value.status_code == 404
        with pytest.raises(AppError) as unread:
            service.get_classification(self.add())
        assert unread.value.status_code == 404


def test_endpoints_are_wired_and_the_tags_ones_are_gone():
    from app.schemas.documents import ClassificationResponse

    document_id = uuid4()
    result = ClassificationResponse(document_id=document_id, category="Legal")
    client = TestClient(create_app())
    with patch.object(service, "create_classification", return_value=result):
        response = client.post(f"/documents/{document_id}/classification").json()
    assert response["category"] == "Legal" and "tags" not in response
    assert client.get("/tags").status_code == 404
