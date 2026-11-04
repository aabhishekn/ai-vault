"""Request correlation and access logging."""

import logging
import re
from collections.abc import Awaitable, Callable
from time import perf_counter
from uuid import uuid4

from fastapi import Request, Response

from app.core.logging import request_id_var
from app.services.api_metrics import api_metrics

logger = logging.getLogger("app.request")
_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


def _record(request: Request, status: int, duration_ms: float) -> None:
    # The matched route template (e.g. /documents/{document_id}) keeps cardinality bounded.
    route = request.scope.get("route")
    api_metrics.record(request.method, getattr(route, "path", None), status, duration_ms)


async def request_logging(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    supplied = request.headers.get("X-Request-ID", "")
    request_id = supplied if _SAFE_REQUEST_ID.fullmatch(supplied) else uuid4().hex
    token = request_id_var.set(request_id)
    started = perf_counter()
    fields = {
        "method": request.method,
        "path": request.url.path,
        "client": request.client.host if request.client else None,
    }
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - started) * 1000
        _record(request, 500, duration_ms)
        logger.exception(
            "request_failed",
            extra={**fields, "status": 500, "duration_ms": round(duration_ms)},
        )
        raise
    else:
        duration_ms = (perf_counter() - started) * 1000
        _record(request, response.status_code, duration_ms)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request",
            extra={**fields, "status": response.status_code, "duration_ms": round(duration_ms)},
        )
        return response
    finally:
        request_id_var.reset(token)
