from fastapi import APIRouter

from app.services import health as service

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db")
def database_health() -> dict[str, str]:
    return service.database_health()


@router.get("/health/queue")
def queue_health() -> dict[str, str | int]:
    return service.queue_health()
