import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy.exc import OperationalError

import documents


class UploadTests(unittest.TestCase):
    def upload(self, name, content):
        return documents.upload_document(UploadFile(filename=name, file=io.BytesIO(content)))

    def test_invalid_uploads_leave_no_files(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(documents, 'STORAGE_DIR', Path(directory)):
                for name, content, expected in [
                    ('test.txt', b'text', 415),
                    ('empty.pdf', b'', 400),
                    ('fake.pdf', b'hello', 415),
                    ('large.pdf', b'%PDF-' + b'x' * documents.MAX_UPLOAD_BYTES, 413),
                ]:
                    with self.subTest(name=name):
                        with self.assertRaises(HTTPException) as error:
                            self.upload(name, content)
                        self.assertEqual(error.exception.status_code, expected)
                        self.assertEqual(list(Path(directory).iterdir()), [])

    def test_database_failure_removes_saved_file(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / 'storage' / 'documents'
            with patch.object(documents, 'STORAGE_DIR', storage):
                with patch.object(documents, 'Session', side_effect=OperationalError('insert', {}, Exception())):
                    with self.assertRaises(HTTPException) as error:
                        self.upload('../../test.pdf', b'%PDF-1.4\n')
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(list(storage.iterdir()), [])
