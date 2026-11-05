import unittest
from unittest.mock import patch
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.ai.embeddings import EMBEDDING_MODEL, EmbeddingBatch
from app.core.errors import AppError, ConfigurationError
from app.db.database import engine
from app.db.models import Document, DocumentChunk
from app.schemas.chat import SearchRequest
from app.services import search as search
from tests.support import requires_database


class SearchValidationTests(unittest.TestCase):
    def test_question_and_limit_validation(self):
        self.assertEqual(SearchRequest(question="  Leave policy?  ").question, "Leave policy?")
        self.assertEqual(SearchRequest(question="Q").top_k, 8)
        self.assertEqual(SearchRequest(question="Q", top_k=20).top_k, 20)
        for data in [
            {"question": " "},
            {"question": "x" * 2001},
            {"question": "Q", "top_k": 0},
            {"question": "Q", "top_k": 21},
        ]:
            with self.subTest(data_length=len(data["question"])):
                with self.assertRaises(ValidationError):
                    SearchRequest(**data)


@requires_database
class DocumentSearchTests(unittest.TestCase):
    def setUp(self):
        self.identifier = uuid4()
        self.other = uuid4()
        self.query = [1.0] + [0.0] * 1535
        self.batch = EmbeddingBatch([self.query], EMBEDDING_MODEL, 3)
        with Session(engine) as session:
            for identifier in [self.identifier, self.other]:
                session.add(
                    Document(
                        id=identifier,
                        filename="search-test.pdf",
                        storage_path=f"storage/documents/{identifier}.pdf",
                        content_type="application/pdf",
                        size_bytes=10,
                        status="embedded",
                    )
                )
            session.flush()
            session.add_all(
                [
                    DocumentChunk(
                        document_id=self.identifier,
                        chunk_index=0,
                        page_number=1,
                        text="Orthogonal",
                        embedding=[0.0, 1.0] + [0.0] * 1534,
                        embedding_model=EMBEDDING_MODEL,
                    ),
                    DocumentChunk(
                        document_id=self.identifier,
                        chunk_index=1,
                        page_number=3,
                        text="Closest",
                        embedding=self.query,
                        embedding_model=EMBEDDING_MODEL,
                    ),
                    DocumentChunk(
                        document_id=self.identifier,
                        chunk_index=2,
                        page_number=4,
                        text="Wrong model",
                        embedding=self.query,
                        embedding_model="other-model",
                    ),
                    DocumentChunk(
                        document_id=self.identifier, chunk_index=3, page_number=4, text="No vector"
                    ),
                    DocumentChunk(
                        document_id=self.other,
                        chunk_index=0,
                        page_number=1,
                        text="Other document",
                        embedding=self.query,
                        embedding_model=EMBEDDING_MODEL,
                    ),
                ]
            )
            session.commit()

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_([self.identifier, self.other])))
            session.commit()

    def test_ranks_only_requested_document_and_model_with_limit(self):
        with patch("app.ai.embed_model.generate_embeddings", return_value=self.batch) as provider:
            result = search.search_document(
                self.identifier, SearchRequest(question="Question", top_k=1)
            )
            provider.assert_called_once_with(["Question"])
        self.assertEqual(result.document_id, self.identifier)
        self.assertEqual(len(result.matches), 1)
        self.assertEqual(result.matches[0].text, "Closest")
        self.assertEqual(result.matches[0].page_number, 3)
        self.assertAlmostEqual(result.matches[0].cosine_distance, 0.0)
        with patch("app.ai.embed_model.generate_embeddings", return_value=self.batch):
            result = search.search_document(
                self.identifier, SearchRequest(question="Question", top_k=10)
            )
        self.assertEqual([match.text for match in result.matches], ["Closest", "Orthogonal"])

    def test_unknown_and_unprocessed_documents_make_no_provider_calls(self):
        with Session(engine) as session:
            session.get(Document, self.identifier).status = "extracted"
            session.commit()
        with patch("app.ai.embed_model.generate_embeddings") as provider:
            for identifier, status in [(uuid4(), 404), (self.identifier, 409)]:
                with self.subTest(status=status):
                    with self.assertRaises(AppError) as error:
                        search.search_document(identifier, SearchRequest(question="Question"))
                    self.assertEqual(error.exception.status_code, status)
            provider.assert_not_called()

    def test_missing_compatible_vectors_make_no_provider_calls(self):
        with Session(engine) as session:
            session.execute(
                delete(DocumentChunk).where(
                    DocumentChunk.document_id == self.identifier,
                    DocumentChunk.embedding_model == EMBEDDING_MODEL,
                )
            )
            session.commit()
        with patch("app.ai.embed_model.generate_embeddings") as provider:
            with self.assertRaises(AppError) as error:
                search.search_document(self.identifier, SearchRequest(question="Question"))
            self.assertEqual(error.exception.status_code, 409)
            provider.assert_not_called()

    def test_provider_error_returns_safe_error(self):
        with patch(
            "app.ai.embed_model.generate_embeddings",
            side_effect=ConfigurationError("private credential details"),
        ):
            with self.assertRaises(AppError) as error:
                search.search_document(self.identifier, SearchRequest(question="Question"))
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Embedding service unavailable")
