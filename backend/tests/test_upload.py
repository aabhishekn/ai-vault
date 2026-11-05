import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import delete
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import engine
from app.db.models import Document
from app.services import documents as documents
from tests.support import requires_database


class UploadTests(unittest.TestCase):
    def upload(self, name, content):
        return documents.upload_document(name, io.BytesIO(content))

    def test_invalid_uploads_leave_no_files(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(documents, "STORAGE_DIR", Path(directory)):
                for name, content, expected in [
                    ("test.txt", b"text", 415),
                    ("empty.pdf", b"", 400),
                    ("fake.pdf", b"hello", 415),
                    ("large.pdf", b"%PDF-" + b"x" * documents.MAX_UPLOAD_BYTES, 413),
                    ("animation.gif", b"GIF89a", 415),
                    ("fake.png", b"%PDF-1.4", 415),
                    ("fake.jpg", b"\x89PNG\r\n\x1a\n", 415),
                    ("empty.png", b"", 400),
                    ("large.png", b"\x89PNG\r\n\x1a\n" + b"x" * documents.MAX_UPLOAD_BYTES, 413),
                ]:
                    with self.subTest(name=name):
                        with self.assertRaises(AppError) as error:
                            self.upload(name, content)
                        self.assertEqual(error.exception.status_code, expected)
                        self.assertEqual(list(Path(directory).iterdir()), [])

    def test_database_failure_removes_saved_file(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "storage" / "documents"
            with patch.object(documents, "STORAGE_DIR", storage):
                with patch.object(
                    documents, "Session", side_effect=OperationalError("insert", {}, Exception())
                ):
                    with self.assertRaises(AppError) as error:
                        self.upload("../../test.pdf", b"%PDF-1.4\n")
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(list(storage.iterdir()), [])

    def test_cleanup_failure_does_not_mask_original_database_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "storage" / "documents"
            with patch.object(documents, "STORAGE_DIR", storage):
                with patch.object(
                    documents, "Session", side_effect=OperationalError("insert", {}, Exception())
                ):
                    with patch("pathlib.Path.unlink", side_effect=OSError("cleanup failed")):
                        with self.assertLogs("app.services.documents", level="WARNING"):
                            with self.assertRaises(AppError) as error:
                                self.upload("test.pdf", b"%PDF-1.4\n")
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(error.exception.detail, "Unable to save document metadata")


@requires_database
class UploadQueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = Path(self.directory.name) / "storage" / "documents"
        self.identifiers = []
        self.storage_patch = patch.object(documents, "STORAGE_DIR", self.storage)
        self.storage_patch.start()

    def tearDown(self):
        self.storage_patch.stop()
        with Session(engine) as session:
            for identifier in self.identifiers:
                session.execute(delete(Document).where(Document.id == identifier))
            session.commit()
        self.directory.cleanup()

    def upload(self):
        return documents.upload_document("test.pdf", io.BytesIO(b"%PDF-1.4\n"))

    def test_enqueues_only_after_document_is_committed(self):

        def enqueue(function, identifier, **kwargs):
            from uuid import UUID

            self.identifiers.append(UUID(identifier))
            with Session(engine) as session:
                doc = session.get(Document, UUID(identifier))
                self.assertIsNotNone(doc)
                self.assertEqual(doc.status, "queued")
            self.assertTrue((self.storage / f"{identifier}.pdf").exists())
            self.assertIs(function, documents.extract_document)

        with patch.object(documents.document_queue, "enqueue", side_effect=enqueue) as queued:
            response = self.upload()
            queued.assert_called_once()
        self.assertEqual(response.status, "queued")

    def test_pictures_are_stored_with_their_own_type(self):
        from uuid import UUID

        png = b"\x89PNG\r\n\x1a\n" + b"data"
        jpeg = b"\xff\xd8\xff\xe0" + b"data"
        cases = [
            ("scan.png", png, "image/png", ".png"),
            ("Photo.JPG", jpeg, "image/jpeg", ".jpg"),
            ("photo.jpeg", jpeg, "image/jpeg", ".jpeg"),
        ]
        for name, content, content_type, suffix in cases:
            with self.subTest(name=name):
                with patch.object(
                    documents.document_queue,
                    "enqueue",
                    side_effect=lambda function, identifier, **kwargs: self.identifiers.append(
                        UUID(identifier)
                    ),
                ):
                    response = documents.upload_document(name, io.BytesIO(content))
                self.assertEqual(response.content_type, content_type)
                self.assertEqual(response.filename, name)
                self.assertTrue((self.storage / f"{response.id}{suffix}").exists())

    def test_redis_failure_preserves_document_and_returns_its_id(self):

        def unavailable(function, identifier, **kwargs):
            from uuid import UUID

            self.identifiers.append(UUID(identifier))
            raise RedisConnectionError("Queue unavailable")

        with patch.object(documents.document_queue, "enqueue", side_effect=unavailable):
            with self.assertRaises(AppError) as error:
                self.upload()
        self.assertEqual(error.exception.status_code, 503)
        identifier = self.identifiers[0]
        self.assertEqual(error.exception.detail["document_id"], str(identifier))
        self.assertTrue((self.storage / f"{identifier}.pdf").exists())
        with Session(engine) as session:
            self.assertEqual(session.get(Document, identifier).status, "queued")
