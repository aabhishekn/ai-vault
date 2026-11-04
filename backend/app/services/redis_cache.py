"""Small JSON cache on Redis for derived content that is cheap to regenerate.

Every failure is logged and treated as a miss, so a Redis outage costs a regeneration
and never fails a request.
"""

import json
import logging
from typing import Any

from redis.exceptions import RedisError

from app.tasks.queue import redis_connection

logger = logging.getLogger(__name__)


def cache_get(key: str, redis=None) -> Any | None:
    try:
        raw = (redis or redis_connection).get(key)
        return None if raw is None else json.loads(raw)
    except (RedisError, ValueError):
        logger.warning("cache_unavailable", extra={"operation": "read"})
        return None


def cache_set(key: str, value: Any, ttl_seconds: int, redis=None) -> None:
    try:
        (redis or redis_connection).set(key, json.dumps(value), ex=ttl_seconds)
    except (RedisError, TypeError):
        logger.warning("cache_unavailable", extra={"operation": "write"})
