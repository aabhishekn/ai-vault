"""HTTP regression coverage for route/service separation and shared error rendering."""

import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.errors import (
    ConflictError,
    DependencyUnavailableError,
    InvalidAIResponseError,
    NotFoundError,
)
from app.main import create_app
from app.schemas.documents import InsightsResponse, SummaryResponse


class APIContractTests(unittest.TestCase):
    def setUp(self):
        self.client_context = TestClient(create_app())
        self.client = self.client_context.__enter__()
        self.identifier = uuid4()
        self.provider_guard = patch(
            "app.ai.client.OpenAI", side_effect=AssertionError("Unexpected paid API call")
        )
        self.provider_guard.start()
        self.addCleanup(self.provider_guard.stop)
        self.addCleanup(self.client_context.__exit__, None, None, None)

    def test_existing_route_paths_and_methods_are_available(self):
        expected = {
            ("GET", "/health"),
            ("GET", "/health/db"),
            ("GET", "/health/queue"),
            ("GET", "/documents"),
            ("POST", "/documents"),
            ("GET", "/documents/{document_id}"),
            ("PATCH", "/documents/{document_id}"),
            ("DELETE", "/documents/{document_id}"),
            ("POST", "/documents/{document_id}/reprocess"),
            ("POST", "/documents/{document_id}/search"),
            ("POST", "/documents/{document_id}/ask"),
            ("GET", "/documents/{document_id}/summary"),
            ("POST", "/documents/{document_id}/summary"),
            ("POST", "/documents/{document_id}/summary/custom"),
            ("GET", "/documents/{document_id}/insights"),
            ("POST", "/documents/{document_id}/insights"),
            ("GET", "/documents/{document_id}/classification"),
            ("POST", "/documents/{document_id}/versions"),
            ("GET", "/documents/{document_id}/versions"),
            ("POST", "/documents/{document_id}/classification"),
            ("POST", "/documents/{document_id}/suggested-questions"),
            ("POST", "/documents/{document_id}/conversations"),
            ("POST", "/multi-conversations"),
            ("POST", "/comparisons"),
            ("GET", "/multi-conversations"),
            ("GET", "/documents/{document_id}/conversations"),
            ("GET", "/conversations/{conversation_id}"),
            ("POST", "/conversations/{conversation_id}/messages"),
            ("POST", "/conversations/{conversation_id}/messages/stream"),
            ("GET", "/stats/documents"),
            ("GET", "/metrics/processing"),
            ("GET", "/metrics/ai-usage"),
            ("GET", "/metrics/api"),
        }
        schema = self.client.get("/openapi.json").json()
        actual = {
            (method.upper(), path)
            for path, operations in schema["paths"].items()
            for method in operations
        }
        self.assertEqual(actual, expected)
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})

    def test_shared_error_handler_preserves_status_and_detail(self):
        for error in [
            NotFoundError("Document not found"),
            InvalidAIResponseError("Invalid provider response"),
        ]:
            with self.subTest(status=error.status_code):
                with patch("app.services.documents.get_document", side_effect=error):
                    response = self.client.get(f"/documents/{self.identifier}")
                self.assertEqual(response.status_code, error.status_code)
                self.assertEqual(response.json(), {"detail": error.detail})

    def test_rename_forwards_a_tidied_title_and_null_clears_it(self):
        with patch("app.services.documents.rename_document") as rename:
            rename.side_effect = lambda document_id, title: {
                "id": str(document_id),
                "filename": "a.pdf",
                "title": title,
                "content_type": "application/pdf",
                "size_bytes": 1,
                "status": "embedded",
                "created_at": "2026-11-04T06:00:00Z",
            }
            response = self.client.patch(
                f"/documents/{self.identifier}", json={"title": "  Q3   Budget  Review "}
            )
            self.assertEqual(
                (response.status_code, response.json()["title"]), (200, "Q3 Budget Review")
            )
            rename.assert_called_once_with(self.identifier, "Q3 Budget Review")
            for blank in (None, "", "   "):
                rename.reset_mock()
                self.client.patch(f"/documents/{self.identifier}", json={"title": blank})
                rename.assert_called_once_with(self.identifier, None)

    def test_rename_rejects_a_missing_or_overlong_title(self):
        with patch("app.services.documents.rename_document") as rename:
            for body in ({}, {"title": "x" * 121}, {"title": 5}):
                with self.subTest(body=body):
                    self.assertEqual(
                        self.client.patch(f"/documents/{self.identifier}", json=body).status_code,
                        422,
                    )
            rename.assert_not_called()

    def test_rename_renders_service_errors(self):
        with patch(
            "app.services.documents.rename_document",
            side_effect=NotFoundError("Document not found"),
        ):
            response = self.client.patch(f"/documents/{self.identifier}", json={"title": "x"})
        self.assertEqual(
            (response.status_code, response.json()), (404, {"detail": "Document not found"})
        )

    def test_delete_returns_no_content_and_forwards_the_versions_flag(self):
        with patch("app.services.deletion.delete_document") as delete_document:
            response = self.client.delete(f"/documents/{self.identifier}")
            self.assertEqual((response.status_code, response.content), (204, b""))
            delete_document.assert_called_once_with(self.identifier, all_versions=False)
            delete_document.reset_mock()
            self.client.delete(f"/documents/{self.identifier}?all_versions=true")
            delete_document.assert_called_once_with(self.identifier, all_versions=True)

    def test_delete_renders_service_errors(self):
        for error in [NotFoundError("Document not found"), ConflictError("Still processing")]:
            with self.subTest(status=error.status_code):
                with patch("app.services.deletion.delete_document", side_effect=error):
                    response = self.client.delete(f"/documents/{self.identifier}")
                self.assertEqual(response.status_code, error.status_code)
                self.assertEqual(response.json(), {"detail": error.detail})

    def test_queue_health_reports_workers_and_backlog(self):
        for workers, expected in [(2, "ok"), (0, "no_workers")]:
            with self.subTest(workers=workers):
                with (
                    patch("app.services.health.Worker.count", return_value=workers),
                    patch("app.services.health.document_queue") as queue,
                ):
                    queue.count = 3
                    response = self.client.get("/health/queue")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json(),
                    {
                        "status": expected,
                        "redis": "connected",
                        "workers": workers,
                        "queued_jobs": 3,
                    },
                )

    def test_queue_health_is_503_when_redis_is_unreachable(self):
        with patch("app.services.health.Worker.count", side_effect=RedisConnectionError("down")):
            response = self.client.get("/health/queue")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Job queue unavailable"})

    def test_queue_failure_preserves_recovery_document_id(self):
        detail = {
            "message": "Document saved, but queue confirmation failed.",
            "document_id": str(self.identifier),
        }
        with patch(
            "app.services.documents.upload_document", side_effect=DependencyUnavailableError(detail)
        ):
            response = self.client.post(
                "/documents", files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")}
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], detail)

    def test_request_validation_happens_before_services(self):
        with patch("app.services.search.search_document") as search:
            for body in [{"question": " "}, {"question": "Q", "top_k": 11}]:
                response = self.client.post(f"/documents/{self.identifier}/search", json=body)
                self.assertEqual(response.status_code, 422)
            search.assert_not_called()
        with patch("app.services.documents.list_documents") as listing:
            self.assertEqual(self.client.get("/documents?limit=0").status_code, 422)
            listing.assert_not_called()

    def test_content_routes_return_existing_response_shapes(self):
        summary = SummaryResponse(document_id=self.identifier, summary="Stored summary")
        insights = InsightsResponse(document_id=self.identifier, insights=[])
        for suffix, result, module in [
            ("summary", summary, "summaries"),
            ("insights", insights, "insights"),
        ]:
            with patch(
                f"app.services.{module}.get_{suffix if suffix == 'summary' else 'insights'}",
                return_value=result,
            ):
                response = self.client.get(f"/documents/{self.identifier}/{suffix}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), result.model_dump(mode="json"))
