import json
import logging
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import ConfigurationError, log_level
from app.core.logging import JsonFormatter, log_ai_call, request_id_var
from app.main import create_app


class JsonFormatterTests(unittest.TestCase):
    def format(self, **extra):
        record = logging.LogRecord("app.test", logging.INFO, "f.py", 1, "hello %s", ("x",), None)
        record.__dict__.update(extra)
        return json.loads(JsonFormatter().format(record))

    def test_core_fields_and_extra_fields_are_json(self):
        entry = self.format(document_id="d1", duration_ms=5)
        self.assertEqual(entry["message"], "hello x")
        self.assertEqual(entry["level"], "INFO")
        self.assertEqual(entry["logger"], "app.test")
        self.assertEqual((entry["document_id"], entry["duration_ms"]), ("d1", 5))
        self.assertNotIn("request_id", entry)

    def test_request_id_is_included_when_set(self):
        token = request_id_var.set("req-1")
        try:
            self.assertEqual(self.format()["request_id"], "req-1")
        finally:
            request_id_var.reset(token)

    def test_exceptions_are_serialized(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = logging.LogRecord("a", logging.ERROR, "f", 1, "m", (), sys.exc_info())
        self.assertIn("ValueError: boom", json.loads(JsonFormatter().format(record))["exception"])


class AICallLogTests(unittest.TestCase):
    def test_usage_is_logged_without_content(self):
        with self.assertLogs("app.ai", "INFO") as logs:
            log_ai_call("answer", "gpt-4.1-mini", 0.0, 10, 5)
        record = logs.records[0]
        self.assertEqual(record.message, "ai_call")
        self.assertEqual(
            (record.operation, record.model, record.input_tokens, record.output_tokens),
            ("answer", "gpt-4.1-mini", 10, 5),
        )


class RequestLoggingTests(unittest.TestCase):
    def test_requests_are_logged_and_correlated(self):
        with TestClient(create_app()) as client, self.assertLogs("app.request", "INFO") as logs:
            response = client.get("/health", headers={"X-Request-ID": "trace-123"})
        self.assertEqual(response.headers["X-Request-ID"], "trace-123")
        record = logs.records[0]
        self.assertEqual((record.method, record.path, record.status), ("GET", "/health", 200))
        self.assertGreaterEqual(record.duration_ms, 0)

    def test_unsafe_request_ids_are_replaced(self):
        with TestClient(create_app()) as client:
            response = client.get("/health", headers={"X-Request-ID": "bad id\twith spaces"})
        self.assertRegex(response.headers["X-Request-ID"], r"^[0-9a-f]{32}$")

    def test_each_request_without_an_id_gets_a_new_one(self):
        with TestClient(create_app()) as client:
            ids = {client.get("/health").headers["X-Request-ID"] for _ in range(3)}
        self.assertEqual(len(ids), 3)


class LogLevelTests(unittest.TestCase):
    def test_invalid_level_is_rejected(self):
        with patch.dict("os.environ", {"LOG_LEVEL": "chatty"}):
            with self.assertRaises(ConfigurationError):
                log_level()
