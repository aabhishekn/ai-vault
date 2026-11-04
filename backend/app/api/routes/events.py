import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.errors import DependencyUnavailableError
from app.services import event_stream

router = APIRouter(tags=["events"])


@router.websocket("/ws/events")
async def document_events(websocket: WebSocket) -> None:
    """Push document status changes to the browser as they happen.

    Messages are JSON: ``{"type": "document.status", "document_id": ..., "status": ...}``
    and ``{"type": "document.content", "document_id": ...}`` once the summary, insights
    and tags are generated. The first message, ``{"type": "ready"}``, confirms the
    subscription is active. Clients refetch after (re)connecting, since events sent
    while disconnected are not replayed.
    """
    await websocket.accept()

    async def forward() -> None:
        async for event in event_stream.event_messages():
            await websocket.send_json(event)

    async def watch_disconnect() -> None:
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            return

    tasks = [asyncio.create_task(forward()), asyncio.create_task(watch_disconnect())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            error = task.exception()
            if isinstance(error, DependencyUnavailableError):
                await websocket.close(code=1013, reason="Live updates unavailable")
                return
            if error is not None and not isinstance(error, WebSocketDisconnect | RuntimeError):
                raise error
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.wait(tasks)
