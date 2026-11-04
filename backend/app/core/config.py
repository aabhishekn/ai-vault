"""Local configuration and paths shared by API, workers, CLI and migrations."""

import os
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
    value = os.getenv("ENABLE_EMBEDDINGS", "false").strip().lower()
    if value not in ("true", "false"):
        raise ConfigurationError("ENABLE_EMBEDDINGS must be true or false")
    return value == "true"


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
