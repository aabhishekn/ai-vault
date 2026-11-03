import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

import insights
from database import engine
from insight_generation import (InsightDraft, InsightsDraft, InsightInputTooLarge, InsightTextUnavailable,
                                generate_insights, prepare_source)
from models import Document
from schemas import DocumentInsight


class InsightGenerationTests(unittest.TestCase):
    def setUp(self):
        self.pages = [{"page_number": 3, "text": "Use FastAPI for the Python backend."}]
        self.valid = DocumentInsight(text="FastAPI is recommended.", page_number=3,
                                     evidence="Use FastAPI for the Python backend.")

    def test_source_ids_map_to_original_page_and_excerpt(self):
        with patch("insight_generation.load_dotenv"):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}):
                with patch("insight_generation.OpenAI") as sdk:
                    client = sdk.return_value.__enter__.return_value
                    client.responses.parse.return_value = SimpleNamespace(
                        status="completed", output_parsed=InsightsDraft(insights=[InsightDraft(text=self.valid.text, evidence_id=1)]))
                    result = generate_insights(self.pages)
                    self.assertEqual(result, [self.valid])
                    self.assertFalse(client.responses.parse.call_args.kwargs["store"])
                    for invalid in [
                        InsightDraft(text="Claim", evidence_id=99),
                        InsightDraft(text="Claim", evidence_id=0),
                        InsightDraft(text=" ", evidence_id=1),
                    ]:
                        client.responses.parse.return_value.output_parsed = InsightsDraft(insights=[invalid])
                        with self.assertRaises(ValueError):
                            generate_insights(self.pages)

    def test_excerpt_windows_preserve_text_and_original_page_numbers(self):
        text = " ".join(f"word{number}" for number in range(150))
        excerpts = json.loads(prepare_source([
            {"page_number": 1, "text": " "},
            {"page_number": 4, "text": text},
        ]))
        self.assertEqual(" ".join(item["text"] for item in excerpts), text)
        self.assertEqual([item["evidence_id"] for item in excerpts], list(range(1, len(excerpts) + 1)))
        self.assertTrue(all(item["page_number"] == 4 and len(item["text"]) <= 240 for item in excerpts))

    def test_unavailable_and_large_inputs_make_no_provider_calls(self):
        with patch("insight_generation.OpenAI") as sdk:
            with self.assertRaises(InsightTextUnavailable):
                prepare_source([{"page_number": 1, "text": " "}])
            with self.assertRaises(InsightInputTooLarge):
                generate_insights([{"page_number": 1, "text": "x" * 60001}])
            sdk.assert_not_called()

    def test_incomplete_or_empty_output_is_rejected(self):
        with patch("insight_generation.load_dotenv"):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}):
                with patch("insight_generation.OpenAI") as sdk:
                    client = sdk.return_value.__enter__.return_value
                    for status, draft in [("incomplete", None), ("completed", None),
                                          ("completed", InsightsDraft(insights=[]))]:
                        client.responses.parse.return_value = SimpleNamespace(status=status, output_parsed=draft)
                        with self.assertRaises(ValueError):
                            generate_insights(self.pages)


@unittest.skipUnless(os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL")
class InsightStorageTests(unittest.TestCase):
    def setUp(self):
        self.identifier = uuid4()
        self.generated = [DocumentInsight(text="FastAPI is recommended.", page_number=1,
                                          evidence="Use FastAPI for the backend.")]
        with Session(engine) as session:
            session.add(Document(id=self.identifier, filename="insights-test.pdf",
                                 storage_path=f"storage/documents/{self.identifier}.pdf",
                                 content_type="application/pdf", size_bytes=10, status="extracted",
                                 extracted_pages=[{"page_number": 1, "text": self.generated[0].evidence}]))
            session.commit()

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.identifier))
            session.commit()

    def test_insights_are_saved_and_cached(self):
        with patch.object(insights, "generate_insights", return_value=self.generated) as provider:
            first = insights.create_insights(self.identifier)
            second = insights.create_insights(self.identifier)
            fetched = insights.get_insights(self.identifier)
        provider.assert_called_once()
        self.assertEqual(first, second)
        self.assertEqual(first, fetched)
        with Session(engine) as session:
            self.assertEqual(session.get(Document, self.identifier).status, "extracted")

    def test_missing_unready_and_long_documents_skip_generation(self):
        with patch.object(insights, "generate_insights") as provider:
            for function, identifier in [(insights.get_insights, self.identifier), (insights.create_insights, uuid4())]:
                with self.assertRaises(HTTPException) as error:
                    function(identifier)
                self.assertEqual(error.exception.status_code, 404)
            for status, pages, expected in [
                ("processing", [{"page_number": 1, "text": "text"}], 409),
                ("extracted", [{"page_number": 1, "text": " "}], 409),
                ("extracted", [{"page_number": 1, "text": "x" * 60001}], 413),
            ]:
                with Session(engine) as session:
                    doc = session.get(Document, self.identifier)
                    doc.status, doc.extracted_pages = status, pages
                    session.commit()
                with self.assertRaises(HTTPException) as error:
                    insights.create_insights(self.identifier)
                self.assertEqual(error.exception.status_code, expected)
            provider.assert_not_called()

    def test_provider_failure_leaves_data_unchanged(self):
        with patch.object(insights, "generate_insights", side_effect=RuntimeError("private")):
            with self.assertRaises(HTTPException) as error:
                insights.create_insights(self.identifier)
        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("private", error.exception.detail)
        with Session(engine) as session:
            self.assertIsNone(session.get(Document, self.identifier).insights)

    def test_concurrent_saved_insights_are_preserved(self):
        def generate(pages):
            with Session(engine) as session:
                session.get(Document, self.identifier).insights = [item.model_dump() for item in self.generated]
                session.commit()
            return [DocumentInsight(text="Later result", page_number=1, evidence=self.generated[0].evidence)]
        with patch.object(insights, "generate_insights", side_effect=generate):
            result = insights.create_insights(self.identifier)
        self.assertEqual(result.insights, self.generated)
