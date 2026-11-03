import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import document_stats
from database import engine
from models import Document, DocumentChunk


class StatisticsErrorTests(unittest.TestCase):
    def test_database_failure_returns_safe_503(self):
        with patch.object(document_stats, "Session", side_effect=OperationalError("query", {}, Exception("private details"))):
            with self.assertRaises(HTTPException) as error:
                document_stats.document_statistics()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Document statistics database unavailable")


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL")
class DocumentStatisticsTests(unittest.TestCase):
    def setUp(self):
        # PostgreSQL temporary tables shadow the real tables on this connection.
        # Tests can verify an empty dataset without modifying user documents.
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.connection.execute(text("CREATE TEMP TABLE documents (LIKE public.documents INCLUDING ALL) ON COMMIT DROP"))
        self.connection.execute(text("CREATE TEMP TABLE document_chunks (LIKE public.document_chunks INCLUDING ALL) ON COMMIT DROP"))
        self.bound_engine = patch.object(document_stats, "engine", self.connection)
        self.bound_engine.start()

    def tearDown(self):
        self.bound_engine.stop()
        self.transaction.rollback()
        self.connection.close()

    def test_empty_dataset_returns_zero_for_every_count(self):
        result = document_stats.document_statistics()
        data = result.model_dump()
        self.assertTrue(all(value == 0 for key, value in data.items() if key != "by_status"))
        self.assertEqual(data["by_status"], dict.fromkeys(document_stats.STATUSES, 0))

    def test_aggregates_without_multiplying_document_totals(self):
        identifiers = [uuid4() for _ in range(3)]
        with Session(self.connection) as session:
            session.add_all([
                Document(id=identifiers[0], filename="queued.pdf", storage_path="queued.pdf",
                         content_type="application/pdf", size_bytes=10, status="queued"),
                Document(id=identifiers[1], filename="embedded.pdf", storage_path="embedded.pdf",
                         content_type="application/pdf", size_bytes=20, status="embedded", summary="Summary",
                         extracted_pages=[{"page_number": i, "text": "Text"} for i in range(1, 4)]),
                Document(id=identifiers[2], filename="failed.pdf", storage_path="failed.pdf",
                         content_type="application/pdf", size_bytes=30, status="failed",
                         extracted_pages=[{"page_number": 1, "text": "Retained text"}]),
            ])
            session.flush()
            session.add_all([
                DocumentChunk(document_id=identifiers[1], chunk_index=0, page_number=1, text="First",
                              embedding=[1.0] + [0.0] * 1535, embedding_model="test-synthetic"),
                DocumentChunk(document_id=identifiers[1], chunk_index=1, page_number=2, text="Second"),
                DocumentChunk(document_id=identifiers[2], chunk_index=0, page_number=1, text="Retained",
                              embedding=[1.0] + [0.0] * 1535, embedding_model="test-synthetic"),
            ])
            session.flush()
            session.commit()
        result = document_stats.document_statistics()
        self.assertEqual(result.total_documents, 3)
        self.assertEqual(result.total_storage_bytes, 60)
        self.assertEqual(result.documents_with_summary, 1)
        self.assertEqual(result.total_extracted_pages, 4)
        self.assertEqual(result.total_chunks, 3)
        self.assertEqual(result.chunks_with_embeddings, 2)
        self.assertEqual(result.by_status.model_dump(), {
            "queued": 1, "processing": 0, "extracted": 0, "embedded": 1, "ready": 0, "failed": 1,
        })
