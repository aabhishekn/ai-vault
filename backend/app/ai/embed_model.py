"""LlamaIndex embedding model backed by our OpenAI embeddings helper.

LlamaIndex's own OpenAI embedding class discards the provider's token usage and
cannot reuse our validation, logging and retry policy. Plugging ``generate_embeddings``
in as the embed model keeps all of that while letting LlamaIndex drive batching.
"""

import asyncio

from llama_index.core.base.embeddings.base import BaseEmbedding
from pydantic import PrivateAttr

from app.ai.embeddings import EMBEDDING_MODEL, MAX_BATCH_SIZE, generate_embeddings


class VaultEmbedding(BaseEmbedding):
    """Embeds text with the vault's OpenAI model and counts the tokens it uses."""

    model_name: str = EMBEDDING_MODEL
    embed_batch_size: int = MAX_BATCH_SIZE
    _input_tokens: int = PrivateAttr(default=0)

    @property
    def input_tokens(self) -> int:
        """Provider-reported input tokens used by this instance so far."""
        return self._input_tokens

    def _embed(self, texts: list[str]) -> list[list[float]]:
        batch = generate_embeddings(texts)
        self._input_tokens += batch.input_tokens
        if len(batch.vectors) != len(texts) or batch.model != EMBEDDING_MODEL:
            raise ValueError("Embeddings do not match the input texts or model")
        return batch.vectors

    def _get_query_embedding(self, query: str) -> list[float]:
        return self._embed([query])[0]

    async def _aget_query_embedding(self, query: str) -> list[float]:
        return await asyncio.to_thread(self._get_query_embedding, query)

    def _get_text_embedding(self, text: str) -> list[float]:
        return self._embed([text])[0]

    def _get_text_embeddings(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)
