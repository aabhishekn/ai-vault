import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import RateLimitRule
from app.core.errors import ConfigurationError, RateLimitExceededError
from app.main import create_app
from app.services import rate_limits
from app.services.rate_limits import RateLimiter


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.expiries = {}

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.values:
            return None
        self.values[key] = value
        self.expiries[key] = ex
        return True

    def incr(self, key):
        self.values[key] += 1
        return self.values[key]


class BrokenRedis:
    def set(self, *args, **kwargs):
        raise RedisConnectionError("private connection details")


MINUTE = RateLimitRule("minute", 60, 2, "requests per minute")
DAY = RateLimitRule("day", 86_400, 3, "requests per day")


class RateLimiterTests(unittest.TestCase):
    def setUp(self):
        self.redis = FakeRedis()
        self.now = 1_000_000.0
        self.limiter = RateLimiter(self.redis, clock=lambda: self.now)

    def test_requests_within_the_limit_pass_and_the_next_is_rejected(self):
        for _ in range(2):
            self.limiter.check("ai", "client-a", [MINUTE])
        with self.assertRaises(RateLimitExceededError) as error:
            self.limiter.check("ai", "client-a", [MINUTE])
        self.assertEqual(error.exception.status_code, 429)
        self.assertIn("2 requests per minute", error.exception.detail)
        self.assertTrue(error.exception.headers["Retry-After"].isdigit())

    def test_retry_after_is_the_time_left_in_the_window(self):
        self.now = 1_000_020.0  # 1_000_020 % 60 == 0, so a full window remains
        for _ in range(2):
            self.limiter.check("ai", "client-a", [MINUTE])
        with self.assertRaises(RateLimitExceededError) as error:
            self.limiter.check("ai", "client-a", [MINUTE])
        self.assertEqual(error.exception.headers["Retry-After"], "60")

    def test_clients_and_scopes_have_independent_counters(self):
        for _ in range(2):
            self.limiter.check("ai", "client-a", [MINUTE])
        self.limiter.check("ai", "client-b", [MINUTE])
        self.limiter.check("upload", "client-a", [MINUTE])

    def test_a_new_window_resets_the_counter(self):
        for _ in range(2):
            self.limiter.check("ai", "client-a", [MINUTE])
        self.now += 60
        self.limiter.check("ai", "client-a", [MINUTE])

    def test_the_stricter_of_several_rules_applies(self):
        rules = [DAY, MINUTE]
        for _ in range(2):
            self.limiter.check("ai", "client-a", rules)
        with self.assertRaisesRegex(RateLimitExceededError, "per minute"):
            self.limiter.check("ai", "client-a", rules)

    def test_counters_always_expire(self):
        self.limiter.check("ai", "client-a", [MINUTE, DAY])
        self.assertEqual(sorted(self.redis.expiries.values()), [60, 86_400])


class RateLimitIntegrationTests(unittest.TestCase):
    def test_disabled_limiting_never_touches_redis(self):
        with patch.object(rate_limits, "RateLimiter", side_effect=AssertionError("used")):
            rate_limits.check_rate_limit("ai", "client")

    def test_redis_outage_fails_open(self):
        with (
            patch.dict("os.environ", {"RATE_LIMIT_ENABLED": "true"}),
            patch.object(rate_limits, "redis_connection", BrokenRedis()),
            self.assertLogs("app.services.rate_limits", "WARNING") as logs,
        ):
            rate_limits.check_rate_limit("ai", "client")
        self.assertNotIn("private connection details", "".join(logs.output))

    def test_invalid_limit_setting_is_reported(self):
        with (
            patch.dict("os.environ", {"RATE_LIMIT_ENABLED": "true", "AI_DAILY_QUOTA": "lots"}),
            patch.object(rate_limits, "redis_connection", FakeRedis()),
            self.assertRaises(ConfigurationError),
        ):
            rate_limits.check_rate_limit("ai", "client")

    def test_zero_disables_a_single_rule(self):
        with patch.dict("os.environ", {"AI_RATE_LIMIT_PER_MINUTE": "0", "AI_DAILY_QUOTA": "7"}):
            from app.core.config import rate_limit_rules

            self.assertEqual([rule.name for rule in rate_limit_rules("ai")], ["day"])

    def test_http_route_returns_429_with_retry_after(self):
        fake = FakeRedis()
        env = {
            "RATE_LIMIT_ENABLED": "true",
            "UPLOAD_RATE_LIMIT_PER_MINUTE": "1",
        }
        with (
            patch.dict("os.environ", env),
            patch.object(rate_limits, "redis_connection", fake),
            TestClient(create_app()) as client,
        ):
            first = client.post("/documents", files={"file": ("a.txt", b"x", "text/plain")})
            second = client.post("/documents", files={"file": ("a.txt", b"x", "text/plain")})
        self.assertEqual(first.status_code, 415)  # passed the limiter, rejected by validation
        self.assertEqual(second.status_code, 429)
        self.assertIn("Retry-After", second.headers)
        self.assertIn("Rate limit exceeded", second.json()["detail"])
