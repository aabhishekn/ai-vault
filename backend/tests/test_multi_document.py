import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from llama_index.core.vector_stores.types import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
    VectorStoreQuery,
)
from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.ai.answer_generation import AnswerDraft, _request_input, generate_answer
from app.db.database import engine
from app.db.models import Conversation, ConversationDocument, Document
from app.db.vector_store import DOCUMENT_ID, _document_ids
from app.main import create_app
from app.schemas.chat import (
    AnswerCitation,
    AnswerResponse,
    MultiConversationRequest,
    SearchMatch,
    SearchRequest,
    SearchResponse,
)
from app.services import conversations as service
from app.services import search
from tests.support import requires_database


def query_with(*filters):
    return VectorStoreQuery(filters=MetadataFilters(filters=list(filters)), similarity_top_k=3)


def test_store_accepts_one_document_or_a_list_but_never_an_unscoped_search():
    first, second = uuid4(), uuid4()
    assert _document_ids(query_with(MetadataFilter(key=DOCUMENT_ID, value=str(first)))) == [first]
    many = MetadataFilter(
        key=DOCUMENT_ID, value=[str(first), str(second)], operator=FilterOperator.IN
    )
    assert _document_ids(query_with(many)) == [first, second]
    for bad in (
        VectorStoreQuery(similarity_top_k=3),
        query_with(MetadataFilter(key="other", value="x")),
        query_with(MetadataFilter(key=DOCUMENT_ID, value=[], operator=FilterOperator.IN)),
    ):
        with pytest.raises(ValueError):
            _document_ids(bad)


def test_request_needs_two_different_documents():
    one = uuid4()
    with pytest.raises(ValidationError):
        MultiConversationRequest(document_ids=[one])
    with pytest.raises(ValidationError):
        MultiConversationRequest(document_ids=[one, one])
    with pytest.raises(ValidationError):
        MultiConversationRequest(document_ids=[uuid4() for _ in range(11)])
    ids = [uuid4(), uuid4()]
    assert MultiConversationRequest(document_ids=ids).document_ids == ids


def retrieval():
    first, second = uuid4(), uuid4()
    return SearchResponse(
        document_id=None,
        question="Which is cheaper?",
        matches=[
            SearchMatch(
                document_id=first,
                filename="a.pdf",
                chunk_id=uuid4(),
                chunk_index=0,
                page_number=1,
                text="A costs 5.",
                cosine_distance=0.1,
            ),
            SearchMatch(
                document_id=second,
                filename="b.pdf",
                chunk_id=uuid4(),
                chunk_index=3,
                page_number=2,
                text="B costs 9.",
                cosine_distance=0.2,
            ),
        ],
    )


def test_sources_name_their_document_and_citations_keep_it():
    found = retrieval()
    documents = json.loads(_request_input(found, None))["documents"]
    assert [item["document"] for item in documents] == ["a.pdf", "b.pdf"]
    draft = AnswerDraft(
        answer="A costs 5 [1]. B costs 9 [2].", source_numbers=[1, 2], insufficient_evidence=False
    )
    response = SimpleNamespace(
        status="completed",
        output_parsed=draft,
        model="m",
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
    )
    with patch("app.ai.answer_generation.create_client") as sdk:
        sdk.return_value.__enter__.return_value.responses.parse.return_value = response
        answer = generate_answer(found)
    assert answer.document_id is None
    assert [(c.filename, c.document_id) for c in answer.citations] == [
        ("a.pdf", found.matches[0].document_id),
        ("b.pdf", found.matches[1].document_id),
    ]


def test_single_document_sources_carry_no_document_field():
    found = retrieval()
    for match in found.matches:
        match.filename = None
    sent = json.loads(_request_input(found, None))
    assert "documents" not in sent
    assert all("document" not in item for item in sent["sources"])


def test_passages_of_one_document_are_grouped_so_each_document_is_one_entry():
    found = retrieval()
    first = found.matches[0]
    extra = first.model_copy(update={"chunk_id": uuid4(), "text": "A also has a warranty."})
    found.matches = [first, extra, found.matches[1]]  # grouped, as the search returns them
    documents = json.loads(_request_input(found, None))["documents"]
    assert [
        (item["document"], [s["source_number"] for s in item["sources"]]) for item in documents
    ] == [
        ("a.pdf", [1, 2]),
        ("b.pdf", [3]),
    ]


def test_sources_use_a_document_title_when_it_has_one():
    found = retrieval()
    found.matches[0].title = "Lease Agreement"
    documents = json.loads(_request_input(found, None))["documents"]
    # The title is what the document is called to people; the file name is the fallback.
    assert [item["document"] for item in documents] == ["Lease Agreement", "b.pdf"]
    draft = AnswerDraft(
        answer="A costs 5 [1]. B costs 9 [2].", source_numbers=[1, 2], insufficient_evidence=False
    )
    response = SimpleNamespace(
        status="completed",
        output_parsed=draft,
        model="m",
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
    )
    with patch("app.ai.answer_generation.create_client") as sdk:
        sdk.return_value.__enter__.return_value.responses.parse.return_value = response
        answer = generate_answer(found)
    assert [(c.filename, c.title) for c in answer.citations] == [
        ("a.pdf", "Lease Agreement"),
        ("b.pdf", None),
    ]


def test_a_title_alone_still_labels_a_source():
    found = retrieval()
    found.matches[0].filename = None
    found.matches[0].title = "Lease Agreement"
    documents = json.loads(_request_input(found, None))["documents"]
    assert documents[0]["document"] == "Lease Agreement"


def test_top_k_grows_to_let_every_document_contribute_but_stays_bounded():
    ids = [uuid4() for _ in range(4)]
    with (
        patch.object(search, "require_searchable"),
        patch.object(search, "_embed_query", return_value=[0.0]),
        patch.object(search, "_retrieve", return_value=[]) as retrieve,
        patch.object(search, "Session"),
    ):
        search.search_documents(ids, SearchRequest(question="q", top_k=3))
        assert retrieve.call_args.args[3] == 8
        search.search_documents([uuid4() for _ in range(9)], SearchRequest(question="q", top_k=3))
        assert retrieve.call_args.args[3] == 12


@requires_database
class TestMultiConversations:
    def setup_method(self):
        self.ids = []

    def teardown_method(self):
        with Session(engine) as session:
            # Multi-document conversations are not tied to one document, so they outlive
            # their documents; remove the ones these tests created.
            session.execute(
                delete(Conversation).where(
                    Conversation.id.in_(
                        select(ConversationDocument.conversation_id).where(
                            ConversationDocument.document_id.in_(self.ids)
                        )
                    )
                )
            )
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()

    def add(self, name):
        identifier = uuid4()
        self.ids.append(identifier)
        with Session(engine) as session:
            session.add(
                Document(
                    id=identifier,
                    filename=name,
                    storage_path=f"storage/{identifier}.pdf",
                    content_type="application/pdf",
                    size_bytes=1,
                    status="embedded",
                )
            )
            session.commit()
        return identifier

    def test_conversation_spans_its_documents_and_is_listed_apart(self):
        first, second = self.add("a.pdf"), self.add("b.pdf")
        with patch.object(service, "require_searchable"):
            created = service.create_multi_conversation([first, second])
        assert created.document_id is None
        assert set(created.document_ids) == {first, second}
        history = service.get_conversation(created.id)
        assert set(history.document_ids) == {first, second}
        listed = service.list_multi_conversations(limit=100)
        assert created.id in [item.id for item in listed.items]
        assert service.list_conversations(first).total == 0

    def test_messages_retrieve_across_all_documents(self):
        first, second = self.add("a.pdf"), self.add("b.pdf")
        with patch.object(service, "require_searchable"):
            created = service.create_multi_conversation([first, second])
        with patch.object(service, "search_documents", return_value=retrieval()) as multi:
            prepared = service._prepare_message(created.id, SearchRequest(question="Compare?"))
        assert set(multi.call_args.args[0]) == {first, second}
        assert prepared.retrieval.question == "Compare?"

    def test_history_names_each_source_document_as_it_is_called_now(self):
        first, second = self.add("a.pdf"), self.add("b.pdf")
        with patch.object(service, "require_searchable"):
            created = service.create_multi_conversation([first, second])
        found = retrieval()
        found.matches[0].document_id = first
        found.matches[1].document_id = second
        answer = AnswerResponse(
            document_id=None,
            question="Which is cheaper?",
            answer="A costs 5 [1]. B costs 9 [2].",
            insufficient_evidence=False,
            citations=[
                # Saved when the documents had no title, and under a file name since changed.
                AnswerCitation(
                    document_id=match.document_id,
                    filename="old-name.pdf",
                    source_number=number,
                    chunk_id=match.chunk_id,
                    page_number=match.page_number,
                    text=match.text,
                )
                for number, match in enumerate(found.matches, start=1)
            ],
            model="m",
            input_tokens=1,
            output_tokens=1,
        )
        service._save_turn(created.id, 0, answer)
        with Session(engine) as session:
            session.execute(
                update(Document).where(Document.id == first).values(title="Lease Agreement")
            )
            session.commit()
        saved = service.get_conversation(created.id).turns[0].response.citations
        assert [(c.filename, c.title) for c in saved] == [
            ("a.pdf", "Lease Agreement"),
            ("b.pdf", None),
        ]

    def test_deleting_a_document_removes_it_from_the_scope(self):
        first, second, third = self.add("a.pdf"), self.add("b.pdf"), self.add("c.pdf")
        with patch.object(service, "require_searchable"):
            created = service.create_multi_conversation([first, second, third])
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == third))
            session.commit()
        assert set(service.get_conversation(created.id).document_ids) == {first, second}

    def test_route_validates_and_creates(self):
        first, second = self.add("a.pdf"), self.add("b.pdf")
        client = TestClient(create_app())
        assert (
            client.post("/multi-conversations", json={"document_ids": [str(first)]}).status_code
            == 422
        )
        with patch.object(service, "require_searchable"):
            response = client.post(
                "/multi-conversations", json={"document_ids": [str(first), str(second)]}
            )
        assert response.status_code == 201
        assert response.json()["document_id"] is None
