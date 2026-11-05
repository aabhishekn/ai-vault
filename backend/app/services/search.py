import re
from uuid import UUID

from llama_index.core import VectorStoreIndex
from llama_index.core.schema import QueryBundle
from llama_index.core.vector_stores.types import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)
from openai import APIError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.embed_model import VaultEmbedding
from app.ai.embeddings import EMBEDDING_MODEL
from app.core.config import SEARCHABLE_STATUSES
from app.core.errors import (
    ConfigurationError,
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
)
from app.db.database import engine
from app.db.models import Document, DocumentChunk
from app.db.queries import get_document_or_raise
from app.db.vector_store import DOCUMENT_ID, ChunkVectorStore
from app.schemas.chat import SearchMatch, SearchRequest, SearchResponse
from app.services.embedding_cache import cached_query_embedding

_EMBED_MODEL = VaultEmbedding()


def require_searchable(session: Session, document_id: UUID) -> None:
    document = get_document_or_raise(session, document_id)
    if document.status not in SEARCHABLE_STATUSES:
        raise ConflictError("Document embeddings are not ready")
    chunk = session.scalar(
        select(DocumentChunk.id)
        .where(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_not(None),
            DocumentChunk.embedding_model == EMBEDDING_MODEL,
        )
        .limit(1)
    )
    if chunk is None:
        raise ConflictError("No compatible document embeddings found")


def _embed_query(question: str) -> list[float]:
    return cached_query_embedding(question, lambda: _EMBED_MODEL.get_query_embedding(question))


def _retrieve(document_ids: list[UUID], question: str, vector: list[float], top_k: int) -> list:
    """Nearest chunks of one or several documents, found by LlamaIndex over our table."""
    if len(document_ids) == 1:
        metadata_filter = MetadataFilter(key=DOCUMENT_ID, value=str(document_ids[0]))
    else:
        metadata_filter = MetadataFilter(
            key=DOCUMENT_ID,
            value=[str(item) for item in document_ids],
            operator=FilterOperator.IN,
        )
    index = VectorStoreIndex.from_vector_store(ChunkVectorStore(), embed_model=_EMBED_MODEL)
    retriever = index.as_retriever(
        similarity_top_k=top_k, filters=MetadataFilters(filters=[metadata_filter])
    )
    return retriever.retrieve(QueryBundle(query_str=question, embedding=vector))


RRF_K = 60  # reciprocal-rank fusion constant; 60 is the usual choice
# A follow-up search adds the previous turn as context, so up to this many times top_k
# passages are kept: the right ones may come from either search.
CONTEXT_EXTRA = 1.5


def _fuse(rankings: list[list], limit: int) -> list:
    """Merge several rankings of the same chunks (reciprocal-rank fusion).

    A chunk that several searches found ranks above one that only a single search found,
    and ties keep the first search's order.
    """
    scores: dict[str, float] = {}
    best: dict[str, object] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking):
            key = item.node.node_id
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
            seen = best.get(key)
            if seen is None or (
                item.node.metadata["cosine_distance"] < seen.node.metadata["cosine_distance"]
            ):
                best[key] = item
    ordered = sorted(scores, key=lambda key: scores[key], reverse=True)
    return [best[key] for key in ordered[:limit]]


def _retrieve_for(document_ids: list[UUID], question: str, context: str | None, top_k: int) -> list:
    """Retrieve for the question itself and, in a follow-up, for the question with the
    previous turn as context.

    Searching only with the context drags in the old topic when the person changes the
    subject, and searching only the bare question misses "and the second one?". Using
    both, then fusing, handles either.
    """
    rankings = [_retrieve(document_ids, question, _embed_query(question), top_k)]
    if context:
        contextual = f"{question}\n{context}"[:2000]
        rankings.append(_retrieve(document_ids, contextual, _embed_query(contextual), top_k))
        return _fuse(rankings, int(top_k * CONTEXT_EXTRA))
    return rankings[0]


# Questions about every document ("summarize each document", "what do they have in common")
# need a passage from each of them, which nearest-neighbour search over the whole set does
# not give: a few documents can fill every slot.
_ALL_DOCUMENTS = re.compile(
    r"\b(each|every|both|compare|comparison|common|differ\w*|across"
    r"|(all|the)\s+(of\s+)?(these\s+|my\s+|those\s+|the\s+)?(documents|docs|files))\b",
    re.IGNORECASE,
)
PASSAGES_PER_DOCUMENT = 2


def asks_about_every_document(question: str) -> bool:
    return _ALL_DOCUMENTS.search(question) is not None


def _grouped_by_document(found: list) -> list:
    """Passages of one document next to each other, documents in order of their best passage,
    so source numbers run in order within a document."""
    order: dict[str, list] = {}
    for item in found:
        order.setdefault(item.node.metadata[DOCUMENT_ID], []).append(item)
    return [item for group in order.values() for item in group]


def _without_repeats(found: list) -> list:
    """Drop passages whose text repeats an earlier one (the same file uploaded twice would
    otherwise fill several slots with one passage)."""
    seen: set[str] = set()
    kept = []
    for item in found:
        text = " ".join(item.node.get_content().split()).casefold()
        if text not in seen:
            seen.add(text)
            kept.append(item)
    return kept


def search_document(
    document_id: UUID, request: SearchRequest, context: str | None = None
) -> SearchResponse:
    try:
        with Session(engine) as session:
            require_searchable(session, document_id)
        found = _retrieve_for([document_id], request.question, context, request.top_k)
        # The document may have been deleted or changed while the question was embedded.
        with Session(engine) as session:
            require_searchable(session, document_id)
        return SearchResponse(
            document_id=document_id,
            question=request.question,
            matches=[
                SearchMatch(
                    chunk_id=UUID(item.node.node_id),
                    chunk_index=item.node.metadata["chunk_index"],
                    page_number=item.node.metadata["page_number"],
                    text=item.node.get_content(),
                    cosine_distance=item.node.metadata["cosine_distance"],
                )
                for item in found
            ],
        )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Document search database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Embedding service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError("Invalid response from embedding service") from None


MAX_MULTI_TOP_K = 12


def _name(names: dict, item, field: str) -> str | None:
    """A matched chunk's document name (its file name or title), if that document is known."""
    row = names.get(UUID(item.node.metadata[DOCUMENT_ID]))
    return getattr(row, field) if row is not None else None


def search_documents(
    document_ids: list[UUID], request: SearchRequest, context: str | None = None
) -> SearchResponse:
    """Search several documents at once; each match names the document it came from."""
    try:
        with Session(engine) as session:
            for document_id in document_ids:
                require_searchable(session, document_id)
            names = {
                row.id: row
                for row in session.execute(
                    select(Document.id, Document.filename, Document.title).where(
                        Document.id.in_(document_ids)
                    )
                )
            }
        # Leave room for every document to contribute, within a bounded prompt.
        top_k = min(MAX_MULTI_TOP_K, max(request.top_k, 2 * len(document_ids)))
        if asks_about_every_document(request.question):
            # The best passages of each document, so a few documents cannot fill every slot.
            vector = _embed_query(request.question)
            found = [
                item
                for document_id in document_ids
                for item in passages_of_document(
                    document_id, request.question, vector, PASSAGES_PER_DOCUMENT
                )
            ]
        else:
            found = _without_repeats(_retrieve_for(document_ids, request.question, context, top_k))
        found = _grouped_by_document(found)
        return SearchResponse(
            document_id=None,
            question=request.question,
            matches=[
                SearchMatch(
                    document_id=UUID(item.node.metadata[DOCUMENT_ID]),
                    filename=_name(names, item, "filename"),
                    title=_name(names, item, "title"),
                    chunk_id=UUID(item.node.node_id),
                    chunk_index=item.node.metadata["chunk_index"],
                    page_number=item.node.metadata["page_number"],
                    text=item.node.get_content(),
                    cosine_distance=item.node.metadata["cosine_distance"],
                )
                for item in found
            ],
        )
    except SQLAlchemyError:
        raise DependencyUnavailableError("Document search database unavailable") from None
    except (APIError, ConfigurationError):
        raise DependencyUnavailableError("Embedding service unavailable") from None
    except ValueError:
        raise InvalidAIResponseError("Invalid response from embedding service") from None


def embed_question(question: str) -> list[float]:
    """Embedding of a question (cached), for callers that retrieve per document."""
    return _embed_query(question)


def passages_of_document(document_id: UUID, question: str, vector: list[float], top_k: int) -> list:
    """The nearest passages of a single document for an already-embedded question."""
    return _retrieve([document_id], question, vector, top_k)
