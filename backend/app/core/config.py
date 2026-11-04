"""Local configuration and paths shared by API, workers, CLI and migrations."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL

from app.core.errors import ConfigurationError

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = BACKEND_DIR.parent
ENV_FILE = REPOSITORY_ROOT / ".env"
STORAGE_DIR = REPOSITORY_ROOT / "storage" / "documents"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
MAX_EMBEDDING_BATCH_SIZE = 64
JOB_TIMEOUT_SECONDS = 300
# Twice the job timeout, so a job that is merely slow is never mistaken for a dead one.
PROCESSING_STALE_AFTER_SECONDS = 2 * JOB_TIMEOUT_SECONDS
TEXT_AVAILABLE_STATUSES = ("extracted", "embedded", "ready")
SEARCHABLE_STATUSES = ("embedded", "ready")
DOCUMENT_STATUSES = ("queued", "processing", "extracted", "embedded", "ready", "failed")

# Environment variables take precedence; restart processes after editing .env.
load_dotenv(ENV_FILE)


def get_answer_model() -> str:
    model = os.getenv("ANSWER_MODEL", "gpt-4.1-mini").strip()
    if not model:
        raise ConfigurationError("ANSWER_MODEL must not be blank")
    return model


def embeddings_enabled() -> bool:
    """Explicit ENABLE_EMBEDDINGS wins; when unset, embeddings run only if an API key exists."""
    if not os.getenv("ENABLE_EMBEDDINGS", "").strip():
        return bool(os.getenv("OPENAI_API_KEY", "").strip())
    return _bool_setting("ENABLE_EMBEDDINGS", "false")


def database_url() -> URL:
    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        raise ConfigurationError("Set POSTGRES_PASSWORD in the repository root .env file")
    return URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "ai_vault"),
        password=password,
        host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.getenv("POSTGRES_PORT", "5433")),
        database=os.getenv("POSTGRES_DB", "ai_vault"),
    )


def redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")


def get_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ConfigurationError("Set OPENAI_API_KEY in the repository root .env file")
    return api_key


def _bool_setting(name: str, default: str) -> bool:
    value = os.getenv(name, default).strip().lower()
    if value not in ("true", "false"):
        raise ConfigurationError(f"{name} must be true or false")
    return value == "true"


def _count_setting(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError:
        raise ConfigurationError(f"{name} must be a whole number") from None
    if value < 0:
        raise ConfigurationError(f"{name} must not be negative")
    return value


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    window_seconds: int
    limit: int
    label: str


# scope -> (rule name, window seconds, environment variable, default limit, wording)
_RATE_LIMITS = {
    # Endpoints that call the paid AI provider: burst limit plus a daily quota.
    "ai": (
        ("minute", 60, "AI_RATE_LIMIT_PER_MINUTE", 20, "requests per minute"),
        ("day", 86_400, "AI_DAILY_QUOTA", 500, "requests per day"),
    ),
    # Uploads queue embedding work, which also costs money.
    "upload": (("minute", 60, "UPLOAD_RATE_LIMIT_PER_MINUTE", 10, "uploads per minute"),),
}


def rate_limiting_enabled() -> bool:
    return _bool_setting("RATE_LIMIT_ENABLED", "true")


def rate_limit_rules(scope: str) -> list[RateLimitRule]:
    """Active rules for a scope; a limit of 0 disables that rule."""
    rules = [
        RateLimitRule(name, window, _count_setting(variable, default), label)
        for name, window, variable, default, label in _RATE_LIMITS[scope]
    ]
    return [rule for rule in rules if rule.limit > 0]


def log_level() -> str:
    level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    if level not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        raise ConfigurationError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
    return level
