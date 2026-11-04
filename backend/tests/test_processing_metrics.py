import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import engine
from app.db.models import ProcessingAttempt
from app.services import processing_metrics as processing_metrics
from tests.support import requires_database


class ProcessingMetricsErrorTests(unittest.TestCase):
    def test_database_failure_is_safe(self):
        with patch.object(
            processing_metrics,
            "Session",
            side_effect=OperationalError("query", {}, Exception("private")),
        ):
            with self.assertRaises(AppError) as error:
                processing_metrics.processing_metrics()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Processing metrics database unavailable")


@requires_database
class ProcessingMetricsTests(unittest.TestCase):
    def setUp(self):
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.connection.execute(
            text(
                "CREATE TEMP TABLE processing_attempts (LIKE public.processing_attempts INCLUDING ALL) ON COMMIT DROP"
            )
        )
        self.bound_engine = patch.object(processing_metrics, "engine", self.connection)
        self.bound_engine.start()

    def tearDown(self):
        self.bound_engine.stop()
        self.transaction.rollback()
        self.connection.close()

    def test_empty_metrics_have_zero_counts_and_unknown_durations(self):
        result = processing_metrics.processing_metrics()
        self.assertEqual(result.total_attempts, 0)
        self.assertEqual(result.processing, 0)
        self.assertEqual(result.succeeded, 0)
        self.assertEqual(result.failed, 0)
        self.assertEqual(result.observed_embedding_input_tokens, 0)
        self.assertIsNone(result.average_duration_ms)
        self.assertIsNone(result.max_duration_ms)
        self.assertIsNone(result.success_rate)

    def test_completed_attempts_determine_duration_and_success_rate(self):
        now = datetime.now(timezone.utc)
        with Session(self.connection) as session:
            session.add_all(
                [
                    ProcessingAttempt(
                        document_id=uuid4(),
                        status="succeeded",
                        finished_at=now,
                        duration_ms=100,
                        embedding_input_tokens=10,
                    ),
                    ProcessingAttempt(
                        document_id=uuid4(),
                        status="failed",
                        finished_at=now,
                        duration_ms=300,
                        embedding_input_tokens=5,
                    ),
                    ProcessingAttempt(document_id=uuid4()),
                ]
            )
            session.commit()
        result = processing_metrics.processing_metrics()
        self.assertEqual(result.total_attempts, 3)
        self.assertEqual((result.processing, result.succeeded, result.failed), (1, 1, 1))
        self.assertEqual(result.success_rate, 0.5)
        self.assertEqual(result.average_duration_ms, 200)
        self.assertEqual(result.average_success_duration_ms, 100)
        self.assertEqual(result.average_failure_duration_ms, 300)
        self.assertEqual(result.max_duration_ms, 300)
        self.assertEqual(result.observed_embedding_input_tokens, 15)

    def test_completed_attempt_requires_a_nonnegative_duration(self):
        with Session(self.connection) as session:
            for duration in [None, -1]:
                with self.subTest(duration=duration):
                    with self.assertRaises(IntegrityError):
                        with session.begin_nested():
                            session.add(
                                ProcessingAttempt(
                                    document_id=uuid4(),
                                    status="succeeded",
                                    finished_at=datetime.now(timezone.utc),
                                    duration_ms=duration,
                                )
                            )
                            session.flush()
