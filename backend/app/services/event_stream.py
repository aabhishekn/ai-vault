"""Subscribe to document events for a WebSocket connection."""

import json
from collections.abc import AsyncIterator

from redis.asyncio import Redis as AsyncRedis
from redis.exceptions import RedisError

from app.core.config import redis_url
from app.core.errors import DependencyUnavailableError
from app.tasks.events import EVENTS_CHANNEL


async def event_messages() -> AsyncIterator[dict]:
    """Yield ``ready`` once subscribed, then each published event, until the caller stops.

    Every connection gets its own subscription, so a slow or closed client never holds
    up another. Raises DependencyUnavailableError if Redis cannot be reached.
    """
    client = AsyncRedis.from_url(redis_url(), socket_connect_timeout=3)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(EVENTS_CHANNEL)
        yield {"type": "ready"}  # the subscription is active; later events will arrive
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                yield json.loads(message["data"])
            except ValueError:
                continue
    except RedisError:
        raise DependencyUnavailableError("Live updates unavailable") from None
    finally:
        try:
            await pubsub.aclose()
            await client.aclose()
        except RedisError:
            pass
