from redis.exceptions import RedisError
from rq import Worker
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.db.database import engine
from app.tasks.queue import document_queue


def database_health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise DependencyUnavailableError("Database unavailable") from None
    return {"status": "ok", "database": "connected"}


def queue_health() -> dict[str, str | int]:
    """Redis reachability plus how many workers are listening on the documents queue.

    Without a worker, uploaded documents stay `queued`, which otherwise looks like a hang.
    """
    try:
        workers = Worker.count(queue=document_queue)
        queued_jobs = document_queue.count
    except RedisError:
        raise DependencyUnavailableError("Job queue unavailable") from None
    return {
        "status": "ok" if workers else "no_workers",
        "redis": "connected",
        "workers": workers,
        "queued_jobs": queued_jobs,
    }
