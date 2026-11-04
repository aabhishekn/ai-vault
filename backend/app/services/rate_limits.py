"""Fixed-window request limits backed by Redis.

Each rule counts requests per client in the current window. Limits protect the
endpoints that spend provider money; a Redis outage must not take the API down, so
the limiter fails open and logs a warning.
"""

import logging
import time
from collections.abc import Callable
from math import ceil

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import RateLimitRule, rate_limit_rules, rate_limiting_enabled
from app.core.errors import RateLimitExceededError
from app.tasks.queue import redis_connection

logger = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self, redis: Redis, clock: Callable[[], float] = time.time):
        self._redis = redis
        self._clock = clock

    def check(self, scope: str, client: str, rules: list[RateLimitRule]) -> None:
        now = self._clock()
        for rule in rules:
            window = int(now // rule.window_seconds)
            key = f"ratelimit:{scope}:{rule.name}:{client}:{window}"
            # Create the counter with its expiry first so a crash can never leave it immortal.
            self._redis.set(key, 0, ex=rule.window_seconds, nx=True)
            if self._redis.incr(key) > rule.limit:
                retry_after = max(1, ceil((window + 1) * rule.window_seconds - now))
                logger.warning(
                    "rate_limit_exceeded",
                    extra={"scope": scope, "rule": rule.name, "client": client},
                )
                raise RateLimitExceededError(
                    f"Rate limit exceeded: {rule.limit} {rule.label}. "
                    f"Try again in {retry_after} seconds.",
                    retry_after,
                )


def check_rate_limit(scope: str, client: str) -> None:
    if not rate_limiting_enabled():
        return
    try:
        RateLimiter(redis_connection).check(scope, client, rate_limit_rules(scope))
    except RedisError:
        logger.warning("rate_limiter_unavailable", extra={"scope": scope})
