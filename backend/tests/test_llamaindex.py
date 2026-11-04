import asyncio
import re
from unittest.mock import patch
from uuid import uuid4

import pytest
from llama_index.core.vector_stores.types import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
    VectorStoreQuery,
)

from app.ai.embed_model import VaultEmbedding
from app.ai.embeddings import EMBEDDING_MODEL, MAX_BATCH_SIZE, EmbeddingBatch
from app.db.vector_store import DOCUMENT_ID, ChunkVectorStore
from app.processing.chunking import chunk_pages
from app.processing.pdf_extraction import ExtractedPage


def fake_embeddings(texts):
    return EmbeddingBatch([[float(len(t))] for t in texts], EMBEDDING_MODEL, 3 * len(texts))


@pytest.fixture
def provider():
    with patch("app.ai.embed_model.generate_embeddings", side_effect=fake_embeddings) as mock:
        yield mock


def test_embedding_model_batches_and_sums_provider_token_usage(provider):
    model = VaultEmbedding()
    texts = [f"text {n}" for n in range(MAX_BATCH_SIZE + 1)]
    vectors = model.get_text_embedding_batch(texts)
    assert [call.args[0] for call in provider.call_args_list] == [
        texts[:MAX_BATCH_SIZE],
        texts[MAX_BATCH_SIZE:],
    ]
    assert vectors[0] == [float(len("text 0"))]
    assert model.input_tokens == 3 * len(texts)


def test_query_and_async_embeddings_use_the_same_helper(provider):
    model = VaultEmbedding()
    assert model.get_query_embedding("hello") == [5.0]
    assert asyncio.run(model.aget_query_embedding("hi")) == [2.0]
    assert model.input_tokens == 6


def test_a_different_model_in_the_response_is_rejected():
    wrong = EmbeddingBatch([[1.0]], "another-model", 1)
    with patch("app.ai.embed_model.generate_embeddings", return_value=wrong):
        with pytest.raises(ValueError):
            VaultEmbedding().get_query_embedding("x")


def query(filters, embedding=(1.0,)):
    return VectorStoreQuery(
        query_embedding=list(embedding) if embedding else None,
        similarity_top_k=3,
        filters=filters,
    )


@pytest.mark.parametrize(
    "filters",
    [
        None,
        MetadataFilters(filters=[]),
        MetadataFilters(filters=[MetadataFilter(key="page_number", value="1")]),
        MetadataFilters(
            filters=[
                MetadataFilter(key=DOCUMENT_ID, value=str(uuid4()), operator=FilterOperator.NE)
            ]
        ),
        MetadataFilters(
            filters=[
                MetadataFilter(key=DOCUMENT_ID, value=str(uuid4())),
                MetadataFilter(key=DOCUMENT_ID, value=str(uuid4())),
            ]
        ),
    ],
)
def test_searches_must_be_scoped_to_exactly_one_document(filters):
    with pytest.raises(ValueError):
        ChunkVectorStore().query(query(filters))


def test_a_query_embedding_is_required():
    scoped = MetadataFilters(filters=[MetadataFilter(key=DOCUMENT_ID, value=str(uuid4()))])
    with pytest.raises(ValueError):
        ChunkVectorStore().query(query(scoped, embedding=None))


def test_the_store_is_read_only_because_ingestion_owns_writes():
    with pytest.raises(NotImplementedError):
        ChunkVectorStore().add([])
    with pytest.raises(NotImplementedError):
        ChunkVectorStore().delete("x")


def test_chunks_follow_sentence_boundaries_and_never_cross_pages():
    first = " ".join(f"Sentence number {n} ends here." for n in range(40))
    chunks = chunk_pages(
        [ExtractedPage(2, first), ExtractedPage(5, "Short page.")], max_words=30, overlap_words=6
    )
    assert {c.page_number for c in chunks} == {2, 5}
    assert chunks[-1].page_number == 5 and chunks[-1].text == "Short page."
    assert all(len(c.text.split()) <= 30 for c in chunks)
    assert all(c.text.endswith(".") for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))

    # Neighbouring chunks share text, so a fact on a boundary is found from either side.
    def sentences(text):
        return set(re.findall(r"Sentence number \d+ ends here", text))

    assert sentences(chunks[0].text) & sentences(chunks[1].text)
