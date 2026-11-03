import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

import summaries
from database import engine
from models import Document
from summary_generation import SummaryDraft, generate_summary


class SummaryGenerationTests(unittest.TestCase):
    def test_calls_structured_api_and_returns_trimmed_summary(self):
        with patch("summary_generation.load_dotenv"):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}):
                with patch("summary_generation.OpenAI") as sdk:
                    client = sdk.return_value.__enter__.return_value
                    client.responses.parse.return_value = SimpleNamespace(
                        status="completed", output_parsed=SummaryDraft(summary="  A document summary.  "))
                    self.assertEqual(generate_summary("Page 1: Document text"), "A document summary.")
                    kwargs = client.responses.parse.call_args.kwargs
                    self.assertFalse(kwargs["store"])
                    self.assertEqual(kwargs["max_output_tokens"], 800)
                    self.assertIn("untrusted data", kwargs["instructions"])

    def test_invalid_inputs_make_no_provider_calls(self):
        with patch("summary_generation.OpenAI") as sdk:
            for source in [" ", "x" * 60001]:
                with self.assertRaises(ValueError):
                    generate_summary(source)
            sdk.assert_not_called()

    def test_incomplete_empty_or_oversized_output_is_rejected(self):
        with patch("summary_generation.load_dotenv"):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}):
                with patch("summary_generation.OpenAI") as sdk:
                    client = sdk.return_value.__enter__.return_value
                    for status, draft in [("incomplete", None), ("completed", None),
                                          ("completed", SummaryDraft(summary=" ")),
                                          ("completed", SummaryDraft(summary="x" * 4001))]:
                        client.responses.parse.return_value = SimpleNamespace(status=status, output_parsed=draft)
                        with self.assertRaises(ValueError):
                            generate_summary("Document text")


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL")
class SummaryStorageTests(unittest.TestCase):
    def setUp(self):
        self.identifier = uuid4()
        with Session(engine) as session:
            session.add(Document(id=self.identifier, filename="summary-test.pdf",
                                 storage_path=f"storage/documents/{self.identifier}.pdf",
                                 content_type="application/pdf", size_bytes=10, status="extracted",
                                 extracted_pages=[{"page_number": 1, "text": "First\n page"},
                                                  {"page_number": 2, "text": "Last page"}]))
            session.commit()

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.identifier))
            session.commit()

    def test_generation_is_saved_and_cached_without_more_calls(self):
        with patch.object(summaries, "generate_summary", return_value="Saved summary.") as provider:
            first = summaries.create_summary(self.identifier)
            second = summaries.create_summary(self.identifier)
            fetched = summaries.get_summary(self.identifier)
        provider.assert_called_once_with("Page 1: First page\n\nPage 2: Last page")
        self.assertEqual(first, second)
        self.assertEqual(first, fetched)
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertEqual(doc.summary, "Saved summary.")
            self.assertEqual(doc.status, "extracted")

    def test_missing_and_unready_documents_skip_provider(self):
        with patch.object(summaries, "generate_summary") as provider:
            for function, identifier, status in [
                (summaries.get_summary, self.identifier, 404),
                (summaries.create_summary, uuid4(), 404),
            ]:
                with self.assertRaises(HTTPException) as error:
                    function(identifier)
                self.assertEqual(error.exception.status_code, status)
            with Session(engine) as session:
                session.get(Document, self.identifier).status = "processing"
                session.commit()
            with self.assertRaises(HTTPException) as error:
                summaries.create_summary(self.identifier)
            self.assertEqual(error.exception.status_code, 409)
            provider.assert_not_called()

    def test_long_documents_are_rejected_without_truncation(self):
        with Session(engine) as session:
            session.get(Document, self.identifier).extracted_pages = [{"page_number": 1, "text": "x" * 60001}]
            session.commit()
        with patch.object(summaries, "generate_summary") as provider:
            with self.assertRaises(HTTPException) as error:
                summaries.create_summary(self.identifier)
            self.assertEqual(error.exception.status_code, 413)
            provider.assert_not_called()

    def test_provider_failure_leaves_document_unchanged(self):
        with patch.object(summaries, "generate_summary", side_effect=RuntimeError("private details")):
            with self.assertRaises(HTTPException) as error:
                summaries.create_summary(self.identifier)
        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("private", error.exception.detail)
        with Session(engine) as session:
            doc = session.get(Document, self.identifier)
            self.assertIsNone(doc.summary)
            self.assertEqual(doc.status, "extracted")

    def test_concurrent_saved_summary_is_preserved(self):
        def generate(source):
            with Session(engine) as session:
                session.get(Document, self.identifier).summary = "First saved summary."
                session.commit()
            return "Later result."
        with patch.object(summaries, "generate_summary", side_effect=generate):
            result = summaries.create_summary(self.identifier)
        self.assertEqual(result.summary, "First saved summary.")
