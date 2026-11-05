import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.ai.answer_generation import (
    INSUFFICIENT_ANSWER,
    AnswerDraft,
    AnswerTextStream,
    stream_answer,
)
from app.core.errors import ConflictError, NotFoundError
from app.main import create_app
from app.schemas.chat import SearchMatch, SearchResponse
from app.services import conversations as service
from app.services.conversations import StreamEvent


def decode(raw: str, size: int) -> str:
    stream, out = AnswerTextStream(), ""
    for index in range(0, len(raw), size):
        out += stream.feed(raw[index : index + size])
    return out


@pytest.mark.parametrize("size", [1, 2, 5, 1000])
def test_answer_text_is_decoded_however_the_json_is_split(size):
    raw = json.dumps(
        {
            "answer": 'Line one\n"quoted" café 😀 and \\ slash [1].',
            "source_numbers": [1],
            "insufficient_evidence": False,
        }
    )
    assert decode(raw, size) == 'Line one\n"quoted" café 😀 and \\ slash [1].'


def test_nothing_is_emitted_for_an_empty_or_missing_answer():
    assert decode('{"answer":"","source_numbers":[]}', 3) == ""
    assert decode('{"other":"x"}', 3) == ""


def retrieval():
    return SearchResponse(
        document_id=uuid4(),
        question="What is recommended?",
        matches=[
            SearchMatch(
                chunk_id=uuid4(),
                chunk_index=0,
                page_number=7,
                text="Use FastAPI.",
                cosine_distance=0.1,
            )
        ],
    )


def fake_stream(draft, deltas):
    manager = MagicMock()
    events = [SimpleNamespace(type="response.output_text.delta", delta=d) for d in deltas]
    events.insert(0, SimpleNamespace(type="response.created"))
    stream = manager.__enter__.return_value
    stream.__iter__.return_value = iter(events)
    stream.get_final_response.return_value = SimpleNamespace(
        output_parsed=draft,
        status="completed",
        model="gpt-4.1-mini",
        usage=SimpleNamespace(input_tokens=50, output_tokens=10),
    )
    return manager


def run_stream(draft, deltas):
    with patch("app.ai.answer_generation.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.stream.return_value = fake_stream(draft, deltas)
        return list(stream_answer(retrieval())), client.responses.stream.call_args.kwargs


def test_deltas_arrive_before_the_validated_final_answer():
    draft = AnswerDraft(answer="Use FastAPI [1].", source_numbers=[1], insufficient_evidence=False)
    raw = draft.model_dump_json()
    events, call = run_stream(draft, [raw[:20], raw[20:30], raw[30:]])
    assert [kind for kind, _ in events] == ["delta", "delta", "final"][: len(events)]
    assert "".join(value for kind, value in events if kind == "delta") == "Use FastAPI [1]."
    kind, final = events[-1]
    assert kind == "final" and final.citations[0].page_number == 7
    assert (final.input_tokens, final.output_tokens) == (50, 10)
    assert call["store"] is False


def test_invalid_citations_fail_after_streaming_instead_of_being_saved():
    draft = AnswerDraft(answer="Made up [9].", source_numbers=[9], insufficient_evidence=False)
    with patch("app.ai.answer_generation.generate_answer", side_effect=ValueError("bad")):
        with pytest.raises(ValueError):
            run_stream(draft, [draft.model_dump_json()])


def test_insufficient_evidence_final_replaces_any_preview():
    draft = AnswerDraft(answer="", source_numbers=[], insufficient_evidence=True)
    events, _ = run_stream(draft, [draft.model_dump_json()])
    assert [kind for kind, _ in events] == ["final"]
    assert events[0][1].answer == INSUFFICIENT_ANSWER


def test_no_matches_makes_no_provider_call():
    empty = SearchResponse(document_id=uuid4(), question="Q", matches=[])
    with patch("app.ai.answer_generation.create_client") as sdk:
        events = list(stream_answer(empty))
    sdk.assert_not_called()
    assert events[0][1].insufficient_evidence is True


def sse(response) -> list[tuple[str, dict]]:
    parsed = []
    for block in response.text.strip().split("\n\n"):
        name, data = block.split("\n")
        parsed.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return parsed


def test_route_writes_server_sent_events():
    events = [
        StreamEvent("delta", {"text": "Use "}),
        StreamEvent("delta", {"text": "café"}),
        StreamEvent("turn", {"id": "t1"}),
    ]
    with patch.object(service, "stream_message", return_value=iter(events)):
        reply = TestClient(create_app()).post(
            f"/conversations/{uuid4()}/messages/stream", json={"question": "Q"}
        )
    assert reply.status_code == 200
    assert reply.headers["content-type"].startswith("text/event-stream")
    assert reply.headers["cache-control"] == "no-cache"
    assert sse(reply) == [
        ("delta", {"text": "Use "}),
        ("delta", {"text": "café"}),
        ("turn", {"id": "t1"}),
    ]


@pytest.mark.parametrize("error,status", [(NotFoundError("gone"), 404), (ConflictError("no"), 409)])
def test_problems_before_streaming_keep_their_http_status(error, status):
    with patch.object(service, "stream_message", side_effect=error):
        reply = TestClient(create_app()).post(
            f"/conversations/{uuid4()}/messages/stream", json={"question": "Q"}
        )
    assert reply.status_code == status


def test_failure_after_streaming_starts_becomes_an_error_event():
    cid = uuid4()
    prepared = service._Prepared(0, 0, [], retrieval())

    def broken(*args, **kwargs):
        yield "delta", "partial"
        raise ValueError("bad output")

    with patch.object(service, "_prepare_message", return_value=prepared):
        with patch.object(service, "stream_answer", side_effect=broken):
            with patch.object(service, "_save_turn") as save:
                events = list(service.stream_message(cid, SimpleNamespace(question="Q", top_k=3)))
    assert [e.name for e in events] == ["delta", "error"]
    assert events[1].data["status"] == 502
    save.assert_not_called()


def test_turn_is_saved_only_with_the_final_answer():
    cid = uuid4()
    prepared = service._Prepared(2, 2, [], retrieval())
    final = SimpleNamespace()
    saved = SimpleNamespace(model_dump=lambda mode: {"id": "turn-3"})
    with patch.object(service, "_prepare_message", return_value=prepared):
        with patch.object(
            service, "stream_answer", return_value=iter([("delta", "Hi"), ("final", final)])
        ):
            with patch.object(service, "_save_turn", return_value=saved) as save:
                events = list(service.stream_message(cid, SimpleNamespace(question="Q", top_k=3)))
    assert [e.name for e in events] == ["delta", "turn"]
    save.assert_called_once_with(cid, 2, final, 2)


def test_an_edited_question_is_saved_in_place_of_the_turns_it_replaces():
    cid = uuid4()
    # Turn 2 of 4 is edited: the new answer is turn 2, and the save checks for 4 turns.
    prepared = service._Prepared(1, 4, [], retrieval())
    final = SimpleNamespace()
    saved = SimpleNamespace(model_dump=lambda mode: {"id": "turn-2"})
    with patch.object(service, "_prepare_message", return_value=prepared):
        with patch.object(service, "stream_answer", return_value=iter([("final", final)])):
            with patch.object(service, "_save_turn", return_value=saved) as save:
                list(service.stream_message(cid, SimpleNamespace(question="Q", top_k=3)))
    save.assert_called_once_with(cid, 1, final, 4)


def test_streamed_answer_without_labels_uses_its_declared_sources():
    draft = AnswerDraft(answer="Use FastAPI.", source_numbers=[1], insufficient_evidence=False)
    with patch("app.ai.answer_generation.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.stream.return_value = fake_stream(draft, [draft.model_dump_json()])
        events = list(stream_answer(retrieval()))
        client.responses.parse.assert_not_called()
    assert events[-1][1].answer == "Use FastAPI. [1]"
    assert [c.source_number for c in events[-1][1].citations] == [1]


def test_streamed_answer_with_invalid_citations_falls_back_to_a_regular_request():
    bad = AnswerDraft(answer="Made up [9].", source_numbers=[9], insufficient_evidence=False)
    good = AnswerDraft(answer="Use FastAPI [1].", source_numbers=[1], insufficient_evidence=False)
    with patch("app.ai.answer_generation.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.stream.return_value = fake_stream(bad, [bad.model_dump_json()])
        client.responses.parse.return_value = SimpleNamespace(
            output_parsed=good,
            status="completed",
            model="gpt-4.1-mini",
            usage=SimpleNamespace(input_tokens=5, output_tokens=5),
        )
        events = list(stream_answer(retrieval()))
    assert events[-1][0] == "final"
    assert events[-1][1].answer == "Use FastAPI [1]."
