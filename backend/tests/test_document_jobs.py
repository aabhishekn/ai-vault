import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import jobs
from database import engine
from models import Document, DocumentChunk
from pdf_extraction import ExtractedPage, PDFExtractionError
from chunking import TextChunk


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL")
class DocumentJobTests(unittest.TestCase):
    def setUp(self):
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
