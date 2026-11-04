import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.ai.comparison import (
    ComparisonDraft,
    DifferenceDraft,
    PositionDraft,
    compare_documents,
    validate,
)
from app.core.errors import ConflictError
from app.db.database import engine
from app.db.models import Document
from app.main import create_app
from app.schemas.comparison import ComparisonRequest
from app.services import comparison as service
from tests.support import requires_database


def draft(**overrides):
    values = dict(
        overview="Both cover pricing.",
        similarities=["Both are annual."],
        differences=[
            DifferenceDraft(
                topic="Price",
                positions=[
                    PositionDraft(document=1, statement="5 per month"),
                    PositionDraft(document=2, statement="9 per month"),
                ],
            )
        ],
    )
    values.update(overrides)
    return ComparisonDraft(**values)


def test_request_needs_two_to_five_distinct_documents_and_cleans_focus():
    one = uuid4()
    for bad in ([one], [one, one], [uuid4() for _ in range(6)]):
        with pytest.raises(ValidationError):
            ComparisonRequest(document_ids=bad)
    request = ComparisonRequest(document_ids=[uuid4(), uuid4()], focus="  payment   terms ")
    assert request.focus == "payment terms"
    assert ComparisonRequest(document_ids=[uuid4(), uuid4()], focus="   ").focus is None


def run(result, status="completed"):
    with patch("app.ai.comparison.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.parse.return_value = SimpleNamespace(
            status=status, output_parsed=result, model="m", usage=None
        )
        out = compare_documents([{"name": "a"}, {"name": "b"}], "price")
    return out, client.responses.parse.call_args.kwargs


def test_documents_are_numbered_and_sent_as_data_with_the_focus():
    (result, model), call = run(draft())
    sent = json.loads(call["input"])
    assert [item["document"] for item in sent["documents"]] == [1, 2]
    assert sent["focus"] == "price"
    assert call["store"] is False and "untrusted" in call["instructions"]
    assert model == "m" and result.overview


@pytest.mark.parametrize(
    "bad",
    [
        draft(overview=" "),
        draft(similarities=[], differences=[]),
        draft(
            differences=[
                DifferenceDraft(topic="x", positions=[PositionDraft(document=1, statement="a")])
            ]
        ),
        draft(
            differences=[
                DifferenceDraft(
                    topic="x",
                    positions=[
                        PositionDraft(document=1, statement="a"),
                        PositionDraft(document=3, statement="b"),
                    ],
                )
            ]
        ),
        draft(
            differences=[
                DifferenceDraft(
                    topic="x",
                    positions=[
                        PositionDraft(document=1, statement="a"),
                        PositionDraft(document=1, statement="b"),
                    ],
                )
            ]
        ),
        draft(similarities=["s"] * 9),
    ],
)
def test_invalid_drafts_are_rejected(bad):
    with pytest.raises(ValueError):
        validate(bad, 2)


def test_unfinished_or_missing_output_is_rejected_and_one_document_is_refused():
    with pytest.raises(ValueError):
        run(draft(), status="incomplete")
    with pytest.raises(ValueError):
        run(None)
    with pytest.raises(ValueError):
        compare_documents([{"name": "a"}], None)


@requires_database
class TestComparisonService:
    def setup_method(self):
        self.ids = []

    def teardown_method(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()

    def add(self, name, **fields):
        identifier = uuid4()
        self.ids.append(identifier)
        values = dict(
            filename=name,
            storage_path=f"storage/{identifier}.pdf",
            content_type="application/pdf",
            size_bytes=1,
            status="embedded",
            summary=f"{name} summary",
            insights=[{"text": "An insight", "evidence_id": 1}],
        )
        values.update(fields)
        with Session(engine) as session:
            session.add(Document(id=identifier, **values))
            session.commit()
        return identifier

    def run_compare(self, ids, **kwargs):
        store = {}
        with (
            patch.object(service, "cache_get", side_effect=lambda key: store.get(key)),
            patch.object(
                service, "cache_set", side_effect=lambda key, value, ttl: store.update({key: value})
            ),
            patch.object(service, "embed_question", return_value=[0.0]),
            patch.object(service, "passages_of_document", return_value=[]),
            patch.object(service, "compare_documents", return_value=(draft(), "m")) as ai,
        ):
            request = ComparisonRequest(document_ids=ids, **kwargs)
            first = service.compare(request)
            second = service.compare(request)
        return first, second, ai

    def test_positions_map_back_to_documents_and_the_second_call_is_cached(self):
        first_id, second_id = self.add("a.pdf"), self.add("b.pdf")
        first, second, ai = self.run_compare([first_id, second_id])
        names = {item.id: item.filename for item in first.documents}
        assert set(names) == {first_id, second_id}
        for position in first.differences[0].positions:
            assert names[position.document_id] == position.filename
        assert first.cached is False and second.cached is True
        assert ai.call_count == 1
        assert second.overview == first.overview

    def test_order_of_the_ids_does_not_change_the_result_key(self):
        first_id, second_id = self.add("a.pdf"), self.add("b.pdf")
        with patch.object(service, "get_answer_model", return_value="m"):
            assert service._key(sorted([first_id, second_id], key=str), None) == service._key(
                sorted([second_id, first_id], key=str), None
            )

    def test_a_document_that_is_still_processing_blocks_the_comparison(self):
        ready, queued = self.add("a.pdf"), self.add("b.pdf", status="queued")
        with pytest.raises(ConflictError):
            service.compare(ComparisonRequest(document_ids=[ready, queued]))

    def test_route(self):
        first_id, second_id = self.add("a.pdf"), self.add("b.pdf")
        client = TestClient(create_app())
        assert (
            client.post("/comparisons", json={"document_ids": [str(first_id)]}).status_code == 422
        )
        with (
            patch.object(service, "cache_get", return_value=None),
            patch.object(service, "cache_set"),
            patch.object(service, "embed_question", return_value=[0.0]),
            patch.object(service, "passages_of_document", return_value=[]),
            patch.object(service, "compare_documents", return_value=(draft(), "m")),
        ):
            response = client.post(
                "/comparisons", json={"document_ids": [str(first_id), str(second_id)]}
            )
        assert response.status_code == 200
        assert response.json()["differences"][0]["topic"] == "Price"
