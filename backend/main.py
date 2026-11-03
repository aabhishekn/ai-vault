from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from answers import router as answers_router
from conversations import router as conversations_router
from database import engine
from documents import router as documents_router
from document_stats import router as document_stats_router
from search import router as search_router
from summaries import router as summaries_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    engine.dispose()


app = FastAPI(title="AI Vault", lifespan=lifespan)
app.include_router(documents_router)
app.include_router(search_router)
app.include_router(answers_router)
app.include_router(conversations_router)
app.include_router(summaries_router)
app.include_router(document_stats_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
def database_health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ok", "database": "connected"}
