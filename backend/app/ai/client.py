"""One place for provider credentials, timeouts and retry policy."""

import os

from openai import OpenAI

from app.core.errors import ConfigurationError


def create_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ConfigurationError("Set OPENAI_API_KEY in the repository root .env file")
    return OpenAI(api_key=api_key, timeout=30.0, max_retries=2)
