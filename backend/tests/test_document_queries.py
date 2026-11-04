import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, inspect
from sqlalchemy.orm import Session

from app.core.config import embeddings_enabled
from app.core.errors import ConfigurationError
from app.db.database import engine
from app.db.models import Document
from app.db.queries import get_document_or_raise, list_documents_query
from tests.support import requires_database


@requires_database
class DeferredColumnTests(unittest.TestCase):
    def setUp(self):
        self.identifier = uuid4()
        with Session(engine) as session:
            session.add(
                Document(
                    id=self.identifier,
                    filename="a.pdf",
                    storage_path=f"storage/documents/{self.identifier}.pdf",
                    content_type="application/pdf",
                    size_bytes=10,
                    extracted_pages=[{"page_number": 1, "text": "x" * 1000}],
                    insights=[{"text": "t", "page_number": 1, "evidence": "e"}],
                )
            )
            session.commit()

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.identifier))
            session.commit()

    def unloaded(self, document):
        return inspect(document).unloaded

    def test_lookup_skips_large_columns_by_default(self):
        with Session(engine) as session:
            document = get_document_or_raise(session, self.identifier)
            self.assertTrue({"extracted_pages", "insights"} <= self.unloaded(document))

    def test_requested_columns_are_loaded(self):
        with Session(engine) as session:
            document = get_document_or_raise(session, self.identifier, load=("extracted_pages",))
            self.assertNotIn("extracted_pages", self.unloaded(document))
            self.assertIn("insights", self.unloaded(document))
            self.assertEqual(document.extracted_pages[0]["page_number"], 1)

    def test_listing_skips_large_columns(self):
        with Session(engine) as session:
            document = session.scalars(
                list_documents_query().where(Document.id == self.identifier)
            ).one()
            self.assertTrue({"extracted_pages", "insights"} <= self.unloaded(document))
            self.assertEqual(document.filename, "a.pdf")


class EmbeddingDefaultTests(unittest.TestCase):
    def enabled(self, **env):
        with patch.dict(os.environ, env, clear=False):
            for name in ("ENABLE_EMBEDDINGS", "OPENAI_API_KEY"):
                if name not in env:
                    os.environ.pop(name, None)
            return embeddings_enabled()

    def test_unset_flag_follows_whether_an_api_key_exists(self):
        self.assertTrue(self.enabled(OPENAI_API_KEY="sk-test"))
        self.assertFalse(self.enabled())
        self.assertFalse(self.enabled(OPENAI_API_KEY="   "))

    def test_blank_flag_counts_as_unset(self):
        self.assertTrue(self.enabled(ENABLE_EMBEDDINGS=" ", OPENAI_API_KEY="sk-test"))

    def test_explicit_flag_always_wins(self):
        self.assertFalse(self.enabled(ENABLE_EMBEDDINGS="false", OPENAI_API_KEY="sk-test"))
        self.assertTrue(self.enabled(ENABLE_EMBEDDINGS="TRUE"))

    def test_invalid_flag_is_rejected(self):
        with self.assertRaises(ConfigurationError):
            self.enabled(ENABLE_EMBEDDINGS="maybe")
