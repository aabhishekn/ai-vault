"""FastAPI dependency that applies a named rate-limit scope to a route."""

from fastapi import Depends, Request

from app.services.rate_limits import check_rate_limit


def limit(scope: str):
    def enforce(request: Request) -> None:
        # Uses the direct peer address; X-Forwarded-For is not trusted without a known proxy.
        check_rate_limit(scope, request.client.host if request.client else "unknown")

    return Depends(enforce)
