"""In-process API latency statistics, kept per route template.

Counts and latencies are recorded by the request middleware and held in memory: they describe
this API process since it started, not history across restarts or multiple processes (request
logs carry the durable record). Memory is bounded: one entry per method and route template,
unmatched paths share a single entry, and each entry keeps only its most recent samples.
"""

import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import ceil

from app.schemas.analytics import ApiMetricsResponse, RouteMetrics

MAX_SAMPLES_PER_ROUTE = 1000
UNMATCHED_ROUTE = "unmatched"


@dataclass
class _RouteStats:
    count: int = 0
    errors: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0
    samples: deque = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES_PER_ROUTE))


def _percentile(sorted_values: list[float], fraction: float) -> float:
    """Nearest-rank percentile of an already sorted, non-empty list."""
    return sorted_values[max(0, ceil(fraction * len(sorted_values)) - 1)]


class ApiMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._routes: dict[tuple[str, str], _RouteStats] = {}
        self._started_at = datetime.now(timezone.utc)

    def record(self, method: str, route: str | None, status: int, duration_ms: float) -> None:
        key = (method, route or UNMATCHED_ROUTE)
        with self._lock:
            stats = self._routes.setdefault(key, _RouteStats())
            stats.count += 1
            stats.errors += status >= 500
            stats.total_ms += duration_ms
            stats.max_ms = max(stats.max_ms, duration_ms)
            stats.samples.append(duration_ms)

    def reset(self) -> None:
        with self._lock:
            self._routes.clear()
            self._started_at = datetime.now(timezone.utc)

    def snapshot(self) -> ApiMetricsResponse:
        with self._lock:
            routes = [
                RouteMetrics(
                    method=method,
                    route=route,
                    requests=stats.count,
                    server_errors=stats.errors,
                    average_ms=round(stats.total_ms / stats.count, 1),
                    p95_ms=round(_percentile(sorted(stats.samples), 0.95), 1),
                    max_ms=round(stats.max_ms, 1),
                )
                for (method, route), stats in self._routes.items()
            ]
            started_at = self._started_at
        routes.sort(key=lambda item: (-item.requests, item.route, item.method))
        total = sum(item.requests for item in routes)
        errors = sum(item.server_errors for item in routes)
        return ApiMetricsResponse(
            since=started_at,
            total_requests=total,
            server_error_rate=errors / total if total else None,
            routes=routes,
        )


api_metrics = ApiMetrics()
