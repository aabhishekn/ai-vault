import threading
import unittest

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.api_metrics import MAX_SAMPLES_PER_ROUTE, UNMATCHED_ROUTE, ApiMetrics, api_metrics


class ApiMetricsTests(unittest.TestCase):
    def test_empty_snapshot_has_no_error_rate(self):
        snapshot = ApiMetrics().snapshot()
        self.assertEqual((snapshot.total_requests, snapshot.routes), (0, []))
        self.assertIsNone(snapshot.server_error_rate)

    def test_counts_averages_and_server_errors_are_tracked_per_route(self):
        metrics = ApiMetrics()
        for duration, status in [(10, 200), (20, 200), (30, 500)]:
            metrics.record("GET", "/documents", status, duration)
        metrics.record("POST", "/documents", 201, 100)
        snapshot = metrics.snapshot()
        listing = next(item for item in snapshot.routes if item.method == "GET")
        self.assertEqual((listing.requests, listing.server_errors), (3, 1))
        self.assertEqual((listing.average_ms, listing.max_ms), (20.0, 30.0))
        self.assertEqual(snapshot.total_requests, 4)
        self.assertEqual(snapshot.server_error_rate, 0.25)
        self.assertEqual(snapshot.routes[0].method, "GET")  # busiest route first

    def test_client_errors_are_not_server_errors(self):
        metrics = ApiMetrics()
        metrics.record("GET", "/documents/{document_id}", 404, 5)
        self.assertEqual(metrics.snapshot().routes[0].server_errors, 0)

    def test_p95_uses_nearest_rank(self):
        metrics = ApiMetrics()
        for duration in range(1, 101):
            metrics.record("GET", "/x", 200, duration)
        route = metrics.snapshot().routes[0]
        self.assertEqual(route.p95_ms, 95.0)
        self.assertEqual(route.max_ms, 100.0)

    def test_single_sample_percentile(self):
        metrics = ApiMetrics()
        metrics.record("GET", "/x", 200, 7)
        self.assertEqual(metrics.snapshot().routes[0].p95_ms, 7.0)

    def test_memory_is_bounded_but_totals_stay_exact(self):
        metrics = ApiMetrics()
        for index in range(MAX_SAMPLES_PER_ROUTE + 500):
            metrics.record("GET", "/x", 200, 1000 if index < 500 else 1)
        route = metrics.snapshot().routes[0]
        self.assertEqual(route.requests, MAX_SAMPLES_PER_ROUTE + 500)
        self.assertEqual(route.p95_ms, 1.0)  # the oldest, slowest samples were dropped
        self.assertEqual(route.max_ms, 1000.0)  # but the all-time maximum is kept

    def test_unmatched_paths_share_one_entry(self):
        metrics = ApiMetrics()
        for _ in range(50):
            metrics.record("GET", None, 404, 1)
        snapshot = metrics.snapshot()
        self.assertEqual([item.route for item in snapshot.routes], [UNMATCHED_ROUTE])
        self.assertEqual(snapshot.routes[0].requests, 50)

    def test_concurrent_recording_loses_nothing(self):
        metrics = ApiMetrics()

        def work():
            for _ in range(500):
                metrics.record("GET", "/x", 200, 1)

        threads = [threading.Thread(target=work) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(metrics.snapshot().total_requests, 4000)

    def test_reset_clears_everything(self):
        metrics = ApiMetrics()
        metrics.record("GET", "/x", 200, 1)
        metrics.reset()
        self.assertEqual(metrics.snapshot().total_requests, 0)


class ApiMetricsEndpointTests(unittest.TestCase):
    def setUp(self):
        api_metrics.reset()
        context = TestClient(create_app())
        self.client = context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)

    def routes(self):
        return {
            (item["method"], item["route"]): item
            for item in self.client.get("/metrics/api").json()["routes"]
        }

    def test_requests_are_grouped_by_route_template_not_raw_path(self):
        self.client.get("/health")
        self.client.get("/health")
        self.client.get("/documents/00000000-0000-0000-0000-000000000001/summary")
        self.client.get("/documents/00000000-0000-0000-0000-000000000002/summary")
        routes = self.routes()
        self.assertEqual(routes[("GET", "/health")]["requests"], 2)
        self.assertEqual(routes[("GET", "/documents/{document_id}/summary")]["requests"], 2)
        templates = {route for (_, route) in routes}
        self.assertNotIn("/documents/00000000-0000-0000-0000-000000000001/summary", templates)

    def test_unknown_paths_do_not_create_new_entries(self):
        for index in range(5):
            self.client.get(f"/no-such-path-{index}")
        routes = self.routes()
        self.assertEqual(routes[("GET", UNMATCHED_ROUTE)]["requests"], 5)
        self.assertFalse([route for (_, route) in routes if route.startswith("/no-such")])

    def test_response_shape(self):
        self.client.get("/health")
        body = self.client.get("/metrics/api").json()
        self.assertEqual(sorted(body), ["routes", "server_error_rate", "since", "total_requests"])
        self.assertEqual(
            sorted(body["routes"][0]),
            ["average_ms", "max_ms", "method", "p95_ms", "requests", "route", "server_errors"],
        )
