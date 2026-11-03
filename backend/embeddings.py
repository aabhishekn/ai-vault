import math
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
MAX_BATCH_SIZE = 64


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: list[list[float]]
    model: str
    input_tokens: int


def generate_embeddings(texts: list[str]) -> EmbeddingBatch:
    """Embed one batch in input order. Calling this with text makes a paid API request."""
    if not texts:
        return EmbeddingBatch([], EMBEDDING_MODEL, 0)
    if len(texts) > MAX_BATCH_SIZE:
        raise ValueError(f"Send at most {MAX_BATCH_SIZE} texts per batch")
    if any(not text.strip() for text in texts):
        raise ValueError("Embedding input must not contain blank text")

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY in the repository root .env file")

    with OpenAI(api_key=api_key, timeout=30.0, max_retries=2) as client:
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            dimensions=EMBEDDING_DIMENSIONS,
            encoding_format="float",
        )

    # Use the response index to keep each vector paired with its source text.
    items = sorted(response.data, key=lambda item: item.index)
    if [item.index for item in items] != list(range(len(texts))):
        raise ValueError("Embedding response does not match the input texts")
    vectors = [item.embedding for item in items]
    if any(len(vector) != EMBEDDING_DIMENSIONS or
           any(not math.isfinite(value) for value in vector) for vector in vectors):
        raise ValueError("Embedding response contains an invalid vector")
    return EmbeddingBatch(vectors, response.model, response.usage.prompt_tokens)
