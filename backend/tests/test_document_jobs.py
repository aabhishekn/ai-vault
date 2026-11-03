import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

import jobs
from database import engine
from models import Document, DocumentChunk, ProcessingAttempt
from pdf_extraction import ExtractedPage, PDFExtractionError
from chunking import TextChunk
from embeddings import EmbeddingBatch, EMBEDDING_MODEL


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL")
class DocumentJobTests(unittest.TestCase):
    def setUp(self):
        self.embedding_flag = patch.dict(os.environ, {"ENABLE_EMBEDDINGS": "false"})
        self.embedding_flag.start()
        self.addCleanup(self.embedding_flag.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name).resolve()
        self.path = self.root / "storage" / "documents" / "test.pdf"
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b"%PDF-1.4\n")
        self.identifier = uuid4()
        with Session(engine) as session:
            session.add(Document(
                id=self.identifier, filename="test.pdf",
                storage_path="storage/documents/test.pdf",
                content_type="application/pdf", size_bytes=self.path.stat().st_size,
            ))
            session.commit()
        self.root_patch = patch.object(jobs, "REPOSITORY_ROOT", self.root)
        self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop()
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.identifier))
            session.commit()
        self.directory.cleanup()

    def test_persists_pages_and_skips_duplicate_execution(self):
        def extract(path):
            self.assertEqual(path, self.path)
            with Session(engine) as session:
                self.assertEqual(session.get(Document, self.identifier).status, "processing")
            return [ExtractedPage(1, "First page"), ExtractedPage(2, "")]

        with patch.object(jobs, "extract_pdf", side_effect=extract) as extractor:
            result = jobs.extract_document(str(self.identifier))
            duplicate = jobs.extract_document(str(self.identifier))
            extractor.assert_called_once()
        self.assertEqual(result["status"], "extracted")
        self.assertEqual(result["page_count"], 2)
        self.assertEqual(result["chunk_count"], 1)
        self.assertTrue(duplicate["skipped"])
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.status, "extracted")
            attempts = session.scalars(select(ProcessingAttempt).where(ProcessingAttempt.document_id == self.identifier)).all()
            self.assertEqual(len(attempts), 1)  # duplicate execution was skipped
            self.assertEqual(attempts[0].status, "succeeded")
            self.assertIsNotNone(attempts[0].finished_at)
            self.assertGreaterEqual(attempts[0].duration_ms, 0)
            self.assertEqual(str(attempts[0].id), result["processing_attempt_id"])
            chunks = session.scalars(select(DocumentChunk).where(
                DocumentChunk.document_id == self.identifier
            ).order_by(DocumentChunk.chunk_index)).all()
            self.assertEqual([(chunk.chunk_index, chunk.page_number, chunk.text) for chunk in chunks],
                             [(0, 1, "First page")])
            self.assertEqual(doc.extracted_pages, [
                {"page_number": 1, "text": "First page"},
                {"page_number": 2, "text": ""},
            ])

    def test_invalid_pdf_records_failure_and_can_be_retried(self):
        with self.assertRaises(PDFExtractionError):
            jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.status, "failed")
            self.assertIn("damaged or invalid", doc.error_message)
        with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Recovered")]):
            jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.status, "extracted")
            self.assertIsNone(doc.error_message)
            attempts = session.scalars(select(ProcessingAttempt).where(ProcessingAttempt.document_id == self.identifier)).all()
            self.assertEqual(len(attempts), 2)
            self.assertEqual({attempt.status for attempt in attempts}, {"failed", "succeeded"})
            self.assertTrue(all(attempt.duration_ms >= 0 for attempt in attempts))


    def test_chunk_failure_rolls_back_pages_and_preserves_previous_chunks(self):
        with Session(engine) as session:
            session.add(DocumentChunk(document_id=self.identifier, chunk_index=0,
                                      page_number=1, text="Previous chunk"))
            session.commit()
        with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Replacement")]):
            with patch.object(jobs, "chunk_pages", return_value=[TextChunk(0, 1, "")]):
                with self.assertRaises(IntegrityError):
                    jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.status, "failed")
            self.assertIsNone(doc.extracted_pages)
            chunks = session.scalars(select(DocumentChunk).where(
                DocumentChunk.document_id == self.identifier
            )).all()
            self.assertEqual([chunk.text for chunk in chunks], ["Previous chunk"])
        with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Replacement")]):
            jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            chunks = session.scalars(select(DocumentChunk).where(
                DocumentChunk.document_id == self.identifier
            )).all()
            self.assertEqual([chunk.text for chunk in chunks], ["Replacement"])
            session.execute(delete(Document).where(Document.id == self.identifier))
            session.commit()
            self.assertEqual(session.scalars(select(DocumentChunk).where(
                DocumentChunk.document_id == self.identifier
            )).all(), [])


    def test_enabled_embeddings_batch_and_persist_in_chunk_order(self):
        chunks = [TextChunk(index, 1, f"Chunk {index}") for index in range(65)]

        def embed(texts):
            with Session(engine) as session:
                self.assertEqual(session.get(Document, self.identifier).status, "processing")
            return EmbeddingBatch(
                [[float(text.split()[-1]) + 1] + [0.0] * 1535 for text in texts],
                EMBEDDING_MODEL, len(texts) * 3,
            )

        with patch.dict(os.environ, {"ENABLE_EMBEDDINGS": "true"}):
            with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Text")]):
                with patch.object(jobs, "chunk_pages", return_value=chunks):
                    with patch.object(jobs, "generate_embeddings", side_effect=embed) as provider:
                        result = jobs.extract_document(str(self.identifier))
        self.assertEqual([len(call.args[0]) for call in provider.call_args_list], [64, 1])
        self.assertEqual(result["status"], "embedded")
        self.assertEqual(result["embedding_input_tokens"], 195)
        with Session(engine) as session:
            self.assertEqual(session.get(Document, self.identifier).status, "embedded")
            attempt = session.scalar(select(ProcessingAttempt).where(ProcessingAttempt.document_id == self.identifier))
            self.assertEqual(attempt.status, "succeeded")
            self.assertEqual(attempt.embedding_input_tokens, 195)
            saved = session.scalars(select(DocumentChunk).where(
                DocumentChunk.document_id == self.identifier
            ).order_by(DocumentChunk.chunk_index)).all()
            self.assertEqual([float(chunk.embedding[0]) for chunk in saved], list(range(1, 66)))
            self.assertTrue(all(chunk.embedding_model == EMBEDDING_MODEL for chunk in saved))

    def test_provider_failure_preserves_text_without_partial_embeddings(self):
        chunks = [TextChunk(index, 1, f"Chunk {index}") for index in range(65)]
        first_batch = EmbeddingBatch([[1.0] + [0.0] * 1535 for _ in range(64)], EMBEDDING_MODEL, 64)
        with patch.dict(os.environ, {"ENABLE_EMBEDDINGS": "true"}):
            with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Saved text")]):
                with patch.object(jobs, "chunk_pages", return_value=chunks):
                    with patch.object(jobs, "generate_embeddings", side_effect=[first_batch, TimeoutError("secret provider details")]):
                        with self.assertRaises(TimeoutError):
                            jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.status, "failed")
            self.assertEqual(doc.error_message, "Document processing failed.")
            attempt = session.scalar(select(ProcessingAttempt).where(ProcessingAttempt.document_id == self.identifier))
            self.assertEqual(attempt.status, "failed")
            self.assertEqual(attempt.embedding_input_tokens, 64)
            self.assertEqual(attempt.error_message, "Document processing failed.")
            self.assertEqual(doc.extracted_pages, [{"page_number": 1, "text": "Saved text"}])
            saved = session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == self.identifier)).all()
            self.assertEqual(len(saved), 65)
            self.assertTrue(all(chunk.embedding is None for chunk in saved))

    def test_disabled_embeddings_make_no_provider_calls(self):
        with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "Text")]):
            with patch.object(jobs, "generate_embeddings") as provider:
                result = jobs.extract_document(str(self.identifier))
        provider.assert_not_called()
        self.assertEqual(result["status"], "extracted")


    def test_vector_save_failure_rolls_back_all_vectors(self):
        batch = EmbeddingBatch([[1.0] + [0.0] * 1535, [1.0, 0.0]], EMBEDDING_MODEL, 2)
        with patch.dict(os.environ, {"ENABLE_EMBEDDINGS": "true"}):
            with patch.object(jobs, "extract_pdf", return_value=[ExtractedPage(1, "First"), ExtractedPage(2, "Second")]):
                with patch.object(jobs, "generate_embeddings", return_value=batch):
                    with self.assertRaises(StatementError):
                        jobs.extract_document(str(self.identifier))
        with Session(engine) as session:
            self.assertEqual(session.get(Document, self.identifier).status, "failed")
            saved = session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == self.identifier)).all()
            self.assertEqual(len(saved), 2)
            self.assertTrue(all(chunk.embedding is None and chunk.embedding_model is None for chunk in saved))
