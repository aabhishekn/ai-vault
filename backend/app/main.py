from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.router import router
from app.db.database import engine
from app.tasks.queue import redis_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    engine.dispose()
    redis_connection.close()


def create_app() -> FastAPI:
    application = FastAPI(title="AI Vault", lifespan=lifespan)
    register_error_handlers(application)
    application.include_router(router)
    return application


app = create_app()
