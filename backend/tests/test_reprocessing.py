import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import PROCESSING_STALE_AFTER_SECONDS
from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document, ProcessingAttempt
from app.services import reprocessing
from tests.support import requires_database


@requires_database
class ReprocessingTests(unittest.TestCase):
    def setUp(self):
        self.ids = []
        enqueue = patch.object(reprocessing, "_enqueue")
        self.enqueue = enqueue.start()
        self.addCleanup(enqueue.stop)

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id.in_(self.ids)))
            session.commit()

    def document(self, status, *, attempt_age_seconds=None, error=None):
        identifier = uuid4()
        self.ids.append(identifier)
        with Session(engine) as session:
            session.add(
                Document(
                    id=identifier,
                    filename="a.pdf",
                    storage_path=f"storage/documents/{identifier}.pdf",
                    content_type="application/pdf",
                    size_bytes=10,
                    status=status,
                    error_message=error,
                )
            )
            session.flush()
            if attempt_age_seconds is not None:
                started = datetime.now(timezone.utc) - timedelta(seconds=attempt_age_seconds)
                session.add(
                    ProcessingAttempt(
                        document_id=identifier, status="processing", started_at=started
                    )
                )
            session.commit()
        return identifier

    def state(self, identifier):
        with Session(engine) as session:
            document = session.get(Document, identifier)
            attempts = session.scalars(
                select(ProcessingAttempt).where(ProcessingAttempt.document_id == identifier)
            ).all()
            return document.status, document.error_message, attempts

    def test_failed_document_is_queued_again_and_its_error_cleared(self):
        identifier = self.document("failed", error="boom")
        result = reprocessing.reprocess_document(identifier)
        self.assertEqual(result.status, "queued")
        self.assertEqual(self.state(identifier)[:2], ("queued", None))
        self.enqueue.assert_called_once_with(identifier)

    def test_extracted_document_can_be_backfilled(self):
        identifier = self.document("extracted")
        self.assertEqual(reprocessing.reprocess_document(identifier).status, "queued")

    def test_finished_document_is_rejected(self):
        for status in ("embedded", "ready"):
            with self.subTest(status=status):
                identifier = self.document(status)
                with self.assertRaisesRegex(AppError, "already been processed") as error:
                    reprocessing.reprocess_document(identifier)
                self.assertEqual(error.exception.status_code, 409)
                self.assertEqual(self.state(identifier)[0], status)
        self.enqueue.assert_not_called()

    def test_actively_running_document_is_left_alone(self):
        identifier = self.document("processing", attempt_age_seconds=30)
        with self.assertRaisesRegex(AppError, "still being processed"):
            reprocessing.reprocess_document(identifier)
        status, _, attempts = self.state(identifier)
        self.assertEqual((status, attempts[0].status), ("processing", "processing"))
        self.enqueue.assert_not_called()

    def test_abandoned_document_is_reclaimed_and_its_attempt_closed_as_failed(self):
        identifier = self.document(
            "processing", attempt_age_seconds=PROCESSING_STALE_AFTER_SECONDS + 60
        )
        self.assertEqual(reprocessing.reprocess_document(identifier).status, "queued")
        status, _, attempts = self.state(identifier)
        self.assertEqual(status, "queued")
        self.assertEqual(attempts[0].status, "failed")
        self.assertIn("queued again", attempts[0].error_message)
        self.assertGreaterEqual(attempts[0].duration_ms, PROCESSING_STALE_AFTER_SECONDS * 1000)
        self.assertIsNotNone(attempts[0].finished_at)
        self.enqueue.assert_called_once_with(identifier)

    def test_unknown_document_is_not_found(self):
        with self.assertRaises(AppError) as error:
            reprocessing.reprocess_document(uuid4())
        self.assertEqual(error.exception.status_code, 404)

    def test_queue_outage_keeps_the_document_queued_so_the_call_can_be_repeated(self):
        identifier = self.document("failed")
        self.enqueue.side_effect = RedisConnectionError("private details")
        with self.assertRaises(AppError) as error:
            reprocessing.reprocess_document(identifier)
        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("private", str(error.exception.detail))
        self.assertEqual(self.state(identifier)[0], "queued")
        self.enqueue.side_effect = None
        self.assertEqual(reprocessing.reprocess_document(identifier).status, "queued")

    def test_worker_startup_recovers_only_abandoned_documents(self):
        abandoned = self.document(
            "processing", attempt_age_seconds=PROCESSING_STALE_AFTER_SECONDS + 60
        )
        running = self.document("processing", attempt_age_seconds=30)
        failed = self.document("failed")
        recovered = reprocessing.recover_abandoned_documents()
        self.assertIn(abandoned, recovered)
        self.assertNotIn(running, recovered)
        self.assertNotIn(failed, recovered)
        self.assertEqual(self.state(abandoned)[0], "queued")
        self.assertEqual(self.state(running)[0], "processing")
        self.assertEqual(self.state(failed)[0], "failed")
        self.enqueue.assert_called_once_with(abandoned)
