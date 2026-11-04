import json
import os
from unittest.mock import patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import EMBEDDING_DIMENSIONS
from app.services import embedding_cache
from app.services.embedding_cache import cache_key, cached_query_embedding

VECTOR = [0.5] * EMBEDDING_DIMENSIONS


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.ttls = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, ex=None):
        self.values[key] = value
        self.ttls[key] = ex

    def delete(self, key):
        self.values.pop(key, None)


class BrokenRedis:
    def get(self, *args, **kwargs):
        raise RedisConnectionError("private details")

    set = delete = get


@pytest.fixture(autouse=True)
def cache_enabled():
    with patch.dict(os.environ, {"EMBEDDING_CACHE_TTL_SECONDS": "60"}):
        yield


def counting_compute():
    calls = []

    def compute():
        calls.append(1)
        return VECTOR

    return compute, calls


def test_second_lookup_is_served_from_the_cache():
    redis = FakeRedis()
    compute, calls = counting_compute()
    assert cached_query_embedding("Leave policy?", compute, redis) == VECTOR
    assert cached_query_embedding("Leave policy?", compute, redis) == VECTOR
    assert len(calls) == 1
    assert list(redis.ttls.values()) == [60]


def test_keys_ignore_case_and_whitespace_but_not_meaning():
    assert cache_key("  Leave   POLICY? ") == cache_key("leave policy?")
    assert cache_key("leave policy?") != cache_key("travel policy?")


def test_ttl_zero_disables_the_cache():
    redis = FakeRedis()
    compute, calls = counting_compute()
    with patch.dict(os.environ, {"EMBEDDING_CACHE_TTL_SECONDS": "0"}):
        cached_query_embedding("Q", compute, redis)
        cached_query_embedding("Q", compute, redis)
    assert len(calls) == 2
    assert redis.values == {}


def test_redis_outage_falls_back_to_the_provider():
    compute, calls = counting_compute()
    assert cached_query_embedding("Q", compute, BrokenRedis()) == VECTOR
    assert len(calls) == 1


@pytest.mark.parametrize("stored", ["not json", json.dumps([1.0, 2.0]), json.dumps({"a": 1})])
def test_corrupt_entries_are_replaced(stored):
    redis = FakeRedis()
    redis.values[cache_key("Q")] = stored
    compute, calls = counting_compute()
    assert cached_query_embedding("Q", compute, redis) == VECTOR
    assert len(calls) == 1
    assert json.loads(redis.values[cache_key("Q")]) == VECTOR


def test_module_exposes_the_shared_connection():
    assert embedding_cache.redis_connection is not None
