import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError
from redis.exceptions import ConnectionError as RedisConnectionError

from app.ai.question_suggestions import SuggestionsDraft, generate_question_suggestions
from app.core.errors import AppError, ConflictError
from app.main import create_app
from app.schemas.documents import SuggestedQuestionsResponse
from app.services import suggestions as service


class FakeRedis:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, ex=None):
        self.values[key] = value


class BrokenRedis:
    def get(self, *args, **kwargs):
        raise RedisConnectionError("private details")

    set = get


def parsed(questions, status="completed"):
    return SimpleNamespace(status=status, output_parsed=SuggestionsDraft(questions=questions))


def run_generator(questions, **kwargs):
    with patch("app.ai.question_suggestions.create_client") as sdk:
        client = sdk.return_value.__enter__.return_value
        client.responses.parse.return_value = parsed(questions, **kwargs)
        result = generate_question_suggestions("A summary.", ["An insight."])
    return result, client.responses.parse.call_args.kwargs


def test_questions_are_cleaned_deduplicated_and_capped():
    result, call = run_generator(["  What   is X? ", "What is X?", "", "Q3?", "Q4?", "Q5?"])
    assert result == ["What is X?", "Q3?", "Q4?", "Q5?"][:4]
    assert call["store"] is False


@pytest.mark.parametrize(
    "questions,status",
    [([], "completed"), (["x" * 201], "completed"), (["Fine?"], "incomplete")],
)
def test_invalid_model_output_is_rejected(questions, status):
    with pytest.raises(ValueError):
        run_generator(questions, status=status)


def test_empty_source_makes_no_provider_call():
    with patch("app.ai.question_suggestions.create_client") as sdk:
        with pytest.raises(ValueError):
            generate_question_suggestions(None, [])
    sdk.assert_not_called()


@pytest.fixture
def source():
    with patch.object(service, "_load_source", return_value=("Summary.", ["Insight."])):
        yield


def test_second_request_is_served_from_cache(source):
    redis, document_id = FakeRedis(), uuid4()
    with patch.object(service, "generate_question_suggestions", return_value=["Q1?"]) as gen:
        first = service.get_suggested_questions(document_id, redis)
        second = service.get_suggested_questions(document_id, redis)
    assert (first.cached, second.cached) == (False, True)
    assert second.questions == ["Q1?"]
    assert gen.call_count == 1


def test_changed_content_misses_the_cache():
    redis, document_id = FakeRedis(), uuid4()
    with patch.object(service, "generate_question_suggestions", return_value=["Q?"]) as gen:
        for summary in ["Old summary.", "New summary."]:
            with patch.object(service, "_load_source", return_value=(summary, [])):
                service.get_suggested_questions(document_id, redis)
    assert gen.call_count == 2


def test_redis_outage_still_returns_suggestions(source):
    with patch.object(service, "generate_question_suggestions", return_value=["Q?"]):
        result = service.get_suggested_questions(uuid4(), BrokenRedis())
    assert result.questions == ["Q?"]


def test_corrupt_cache_entry_is_regenerated(source):
    redis, document_id = FakeRedis(), uuid4()
    redis.set(service._cache_key(document_id, "Summary.", ["Insight."]), json.dumps({"a": 1}))
    with patch.object(service, "generate_question_suggestions", return_value=["Q?"]) as gen:
        result = service.get_suggested_questions(document_id, redis)
    assert result.questions == ["Q?"] and gen.call_count == 1


def test_provider_failures_map_to_service_errors(source):
    for error, status in [
        (APIConnectionError(request=SimpleNamespace()), 503),
        (ValueError("bad"), 502),
    ]:
        with patch.object(service, "generate_question_suggestions", side_effect=error):
            with pytest.raises(AppError) as raised:
                service.get_suggested_questions(uuid4(), FakeRedis())
        assert raised.value.status_code == status


def test_document_without_content_is_a_conflict():
    with patch.object(service, "_load_source", side_effect=ConflictError("none yet")):
        with pytest.raises(ConflictError):
            service.get_suggested_questions(uuid4(), FakeRedis())


def test_endpoint_returns_questions():
    document_id = uuid4()
    response = SuggestedQuestionsResponse(document_id=document_id, questions=["Q?"], cached=False)
    with patch.object(service, "get_suggested_questions", return_value=response):
        reply = TestClient(create_app()).post(f"/documents/{document_id}/suggested-questions")
    assert reply.status_code == 200
    assert reply.json()["questions"] == ["Q?"]
