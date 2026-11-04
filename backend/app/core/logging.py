"""JSON-lines logging shared by the API, the worker and AI provider calls.

Logs never contain document text, questions, answers or API keys: only identifiers,
sizes, durations, token counts and outcomes.
"""

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from time import perf_counter

from app.core.config import log_level

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_STANDARD_FIELDS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        payload.update(
            {key: value for key, value in record.__dict__.items() if key not in _STANDARD_FIELDS}
        )
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    """Install one JSON handler on the root logger; safe to call repeatedly."""
    root = logging.getLogger()
    if not any(getattr(handler, "ai_vault", False) for handler in root.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        handler.ai_vault = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    root.setLevel(log_level())


def log_ai_call(
    operation: str, model: str, started: float, input_tokens: int = 0, output_tokens: int = 0
) -> None:
    """Record one provider call; this is where summary/insight usage is observable."""
    logging.getLogger("app.ai").info(
        "ai_call",
        extra={
            "operation": operation,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "duration_ms": round((perf_counter() - started) * 1000),
        },
    )
