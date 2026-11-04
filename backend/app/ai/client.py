"""One place for provider timeouts and retry policy."""

from openai import OpenAI

from app.core.config import get_api_key


def create_client() -> OpenAI:
    return OpenAI(api_key=get_api_key(), timeout=30.0, max_retries=2)
