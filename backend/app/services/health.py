from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.db.database import engine


def database_health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise DependencyUnavailableError("Database unavailable") from None
    return {"status": "ok", "database": "connected"}
