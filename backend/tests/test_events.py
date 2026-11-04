import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import RedisError

from app.core.errors import DependencyUnavailableError
from app.main import create_app
from app.services import event_stream
from app.tasks import events


def test_status_events_are_published_as_json_on_the_shared_channel():
    document_id = uuid4()
    with patch.object(events, "redis_connection") as redis:
        events.publish_status(document_id, "embedded")
        events.publish_content_ready(document_id)
    first, second = (json.loads(call.args[1]) for call in redis.publish.call_args_list)
    assert redis.publish.call_args_list[0].args[0] == events.EVENTS_CHANNEL
    assert first == {
        "type": "document.status",
        "document_id": str(document_id),
        "status": "embedded",
    }
    assert second == {"type": "document.content", "document_id": str(document_id)}


def test_a_redis_outage_never_fails_the_work_being_reported():
    with patch.object(events, "redis_connection") as redis:
        redis.publish.side_effect = RedisError("down")
        events.publish_status(uuid4(), "failed")  # must not raise


class FakePubSub:
    def __init__(self, messages, fail=False):
        self.messages = messages
        self.fail = fail
        self.closed = False
        self.subscribed = None

    async def subscribe(self, channel):
        if self.fail:
            raise RedisError("down")
        self.subscribed = channel

    async def listen(self):
        for message in self.messages:
            yield message

    async def aclose(self):
        self.closed = True


class FakeClient:
    def __init__(self, pubsub):
        self._pubsub = pubsub
        self.closed = False

    def pubsub(self):
        return self._pubsub

    async def aclose(self):
        self.closed = True


async def collect(pubsub):
    client = FakeClient(pubsub)
    with patch.object(event_stream.AsyncRedis, "from_url", return_value=client):
        return [item async for item in event_stream.event_messages()], client


@pytest.mark.anyio
async def test_stream_starts_with_ready_then_skips_noise_and_bad_payloads():
    pubsub = FakePubSub(
        [
            {"type": "subscribe", "data": 1},
            {"type": "message", "data": "not json"},
            {"type": "message", "data": json.dumps({"type": "document.status", "status": "ready"})},
        ]
    )
    items, client = await collect(pubsub)
    assert items == [{"type": "ready"}, {"type": "document.status", "status": "ready"}]
    assert pubsub.subscribed == events.EVENTS_CHANNEL
    assert pubsub.closed and client.closed


@pytest.mark.anyio
async def test_unreachable_redis_is_reported_and_connections_are_closed():
    pubsub = FakePubSub([], fail=True)
    with pytest.raises(DependencyUnavailableError):
        await collect(pubsub)
    assert pubsub.closed


def test_websocket_pushes_events_and_closes_cleanly_on_disconnect():
    async def fake_messages():
        yield {"type": "ready"}
        yield {"type": "document.status", "document_id": "d", "status": "embedded"}
        import asyncio

        await asyncio.sleep(30)  # stays open until the client leaves

    with patch.object(event_stream, "event_messages", fake_messages):
        client = TestClient(create_app())
        with client.websocket_connect("/ws/events") as socket:
            assert socket.receive_json() == {"type": "ready"}
            assert socket.receive_json()["status"] == "embedded"


def test_websocket_closes_when_live_updates_are_unavailable():
    async def broken():
        raise DependencyUnavailableError("down")
        yield  # pragma: no cover

    with patch.object(event_stream, "event_messages", broken):
        client = TestClient(create_app())
        with client.websocket_connect("/ws/events") as socket:
            with pytest.raises(Exception) as closed:
                socket.receive_json()
        assert getattr(closed.value, "code", None) == 1013


def test_every_status_change_is_announced():
    """The worker and upload paths publish; guard against a transition being forgotten."""
    from pathlib import Path

    source = Path("app/tasks/documents.py").read_text()
    for status in ("processing", "extracted", "embedded", "failed"):
        assert f'publish_status(context.document_id, "{status}")' in source
    assert "publish_content_ready(" in source
    assert MagicMock  # imported for patch targets above
