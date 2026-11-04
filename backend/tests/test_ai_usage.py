import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import engine
from app.db.models import ConversationTurn, ProcessingAttempt
from app.services import ai_usage
from tests.support import requires_database


class AIUsageErrorTests(unittest.TestCase):
    def test_database_failure_is_safe(self):
        with patch.object(
            ai_usage, "Session", side_effect=OperationalError("q", {}, Exception("private"))
        ):
            with self.assertRaises(AppError) as error:
                ai_usage.ai_usage()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "AI usage database unavailable")


def turn(model, input_tokens, output_tokens):
    return ConversationTurn(
        conversation_id=uuid4(),
        turn_number=1,
        response={"model": model, "input_tokens": input_tokens, "output_tokens": output_tokens},
    )


@requires_database
class AIUsageTests(unittest.TestCase):
    def setUp(self):
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        for table in ("conversation_turns", "processing_attempts"):
            self.connection.execute(
                text(
                    f"CREATE TEMP TABLE {table} (LIKE public.{table} INCLUDING ALL) ON COMMIT DROP"
                )
            )
        self.bound_engine = patch.object(ai_usage, "engine", self.connection)
        self.bound_engine.start()

    def tearDown(self):
        self.bound_engine.stop()
        self.transaction.rollback()
        self.connection.close()

    def test_empty_database_reports_zero_usage_and_cost(self):
        result = ai_usage.ai_usage()
        self.assertEqual(result.chat, [])
        self.assertEqual(result.embeddings.input_tokens, 0)
        self.assertEqual(result.estimated_total_cost_usd, 0)
        self.assertEqual(result.unpriced_models, [])
        self.assertTrue(result.not_persisted)

    def test_usage_is_grouped_by_model_and_priced(self):
        with Session(self.connection) as session:
            session.add_all(
                [
                    turn("gpt-4.1-mini-2025-04-14", 1_000_000, 500_000),
                    turn("gpt-4.1-mini-2025-04-14", 1_000_000, 500_000),
                    turn("mystery-model", 10, 5),
                    ProcessingAttempt(document_id=uuid4(), embedding_input_tokens=2_000_000),
                ]
            )
            session.commit()
        result = ai_usage.ai_usage()
        by_model = {item.model: item for item in result.chat}
        priced = by_model["gpt-4.1-mini-2025-04-14"]
        self.assertEqual(
            (priced.turns, priced.input_tokens, priced.output_tokens), (2, 2_000_000, 1_000_000)
        )
        self.assertEqual(priced.estimated_cost_usd, 2.4)
        self.assertIsNone(by_model["mystery-model"].estimated_cost_usd)
        self.assertEqual(result.embeddings.input_tokens, 2_000_000)
        self.assertEqual(result.embeddings.estimated_cost_usd, 0.04)
        self.assertEqual(result.estimated_total_cost_usd, 2.44)
        self.assertEqual(result.unpriced_models, ["mystery-model"])
