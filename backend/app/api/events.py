import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["events"])


@router.websocket("/ws/events")
async def events(ws: WebSocket):
    """Pushes camera states every second, plus any new incident events since the client connected."""
    await ws.accept()
    manager = ws.app.state.manager
    last_seq = manager.seq  # new connections do not replay history
    try:
        while True:
            new = manager.events_after(last_seq)
            if new:
                last_seq = new[-1]["seq"]
            await ws.send_json({"cameras": [s.model_dump() for s in manager.states()], "events": new})
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, RuntimeError):
        pass
