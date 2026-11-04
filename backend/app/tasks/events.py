"""Document events, published on Redis so the API can push them to browsers.

The worker and the API are separate processes, so a status change made by the worker
reaches connected clients through a Redis channel. Publishing is best effort: a Redis
problem is logged and never fails the work being reported (clients also refetch on
reconnect, so a missed event is corrected).
"""

import json
import logging
from uuid import UUID

from redis.exceptions import RedisError

from app.tasks.queue import redis_connection

logger = logging.getLogger(__name__)

EVENTS_CHANNEL = "vault:events"


def publish_event(event_type: str, document_id: UUID | str, **fields: str | None) -> None:
    message = {"type": event_type, "document_id": str(document_id), **fields}
    try:
        redis_connection.publish(EVENTS_CHANNEL, json.dumps(message))
    except (RedisError, TypeError):
        logger.warning("event_publish_failed", extra={"event_type": event_type})


def publish_status(document_id: UUID | str, status: str) -> None:
    """A document moved to a new processing status."""
    publish_event("document.status", document_id, status=status)


def publish_content_ready(document_id: UUID | str) -> None:
    """Summary, insights and tags finished generating (or were skipped)."""
    publish_event("document.content", document_id)
