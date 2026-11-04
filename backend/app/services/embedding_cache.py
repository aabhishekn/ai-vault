"""Redis cache for query embeddings.

Embedding the same question twice returns the same vector, so repeated searches,
retries and follow-ups can skip the paid provider call. The cache is an optimisation
only: any Redis problem is logged and the caller falls back to the provider.
"""

import hashlib
import json
import logging
import math
from collections.abc import Callable

from redis.exceptions import RedisError

from app.core.config import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    embedding_cache_ttl_seconds,
)
from app.tasks.queue import redis_connection

logger = logging.getLogger(__name__)


def cache_key(text: str) -> str:
    # Model and size are part of the key so changing either never serves old vectors.
    normalised = " ".join(text.split()).casefold()
    digest = hashlib.sha256(normalised.encode()).hexdigest()
    return f"embedding:{EMBEDDING_MODEL}:{EMBEDDING_DIMENSIONS}:{digest}"


def _valid(vector: object) -> bool:
    return (
        isinstance(vector, list)
        and len(vector) == EMBEDDING_DIMENSIONS
        and all(isinstance(value, int | float) and math.isfinite(value) for value in vector)
    )


def cached_query_embedding(
    text: str, compute: Callable[[], list[float]], redis=None
) -> list[float]:
    """Return the cached vector for ``text``, or ``compute()`` it and cache the result."""
    ttl = embedding_cache_ttl_seconds()
    if ttl == 0:
        return compute()
    redis = redis or redis_connection
    key = cache_key(text)
    try:
        raw = redis.get(key)
        if raw is not None:
            vector = json.loads(raw)
            if _valid(vector):
                logger.info("embedding_cache", extra={"result": "hit"})
                return vector
            redis.delete(key)  # a corrupt entry must not poison later requests
    except (RedisError, ValueError):
        logger.warning("embedding_cache_unavailable", extra={"operation": "read"})
    vector = compute()
    try:
        redis.set(key, json.dumps(vector), ex=ttl)
    except RedisError:
        logger.warning("embedding_cache_unavailable", extra={"operation": "write"})
    logger.info("embedding_cache", extra={"result": "miss"})
    return vector
