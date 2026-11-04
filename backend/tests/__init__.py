import os

# Keep test output quiet and never let shared Redis counters throttle test requests.
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("AUTO_GENERATE_CONTENT", "false")
os.environ.setdefault("EMBEDDING_CACHE_TTL_SECONDS", "0")
