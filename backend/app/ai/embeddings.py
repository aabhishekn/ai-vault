import math
from dataclasses import dataclass

from app.ai.client import create_client
from app.core.config import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL
from app.core.config import MAX_EMBEDDING_BATCH_SIZE as MAX_BATCH_SIZE


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
    if any((not text.strip() for text in texts)):
        raise ValueError("Embedding input must not contain blank text")
    with create_client() as client:
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            dimensions=EMBEDDING_DIMENSIONS,
            encoding_format="float",
        )
    items = sorted(response.data, key=lambda item: item.index)
    if [item.index for item in items] != list(range(len(texts))):
        raise ValueError("Embedding response does not match the input texts")
    if response.model != EMBEDDING_MODEL:
        raise ValueError("Embedding response uses an unexpected model")
    vectors = [item.embedding for item in items]
    if any(
        (
            len(vector) != EMBEDDING_DIMENSIONS
            or not any(vector)
            or any((not math.isfinite(value) for value in vector))
            for vector in vectors
        )
    ):
        raise ValueError("Embedding response contains an invalid vector")
    return EmbeddingBatch(vectors, response.model, response.usage.prompt_tokens)
