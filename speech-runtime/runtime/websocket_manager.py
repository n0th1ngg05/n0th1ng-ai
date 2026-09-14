"""WebSocket manager for streaming and events."""
import asyncio
import json
from typing import Set, Optional

from fastapi import WebSocket

from runtime.logger import get_logger
from runtime.events import event_bus, Event
from runtime.exceptions import SpeechRuntimeError

logger = get_logger("websocket_manager")


class WebSocketManager:
    """Manages WebSocket connections."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logger.info(f"WebSocket connected. Total: {len(self._connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Disconnect a WebSocket."""
        async with self._lock:
            self._connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self._connections)}")

    async def broadcast(self, message: dict) -> None:
        """Broadcast a message to all connections."""
        disconnected = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            await self.disconnect(ws)

    async def handle_stream(self, websocket: WebSocket) -> None:
        """Handle streaming WebSocket connection."""
        await self.connect(websocket)
        try:
            while True:
                data = await websocket.receive_text()
                message = json.loads(data)
                msg_type = message.get("type")
                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "audio_chunk":
                    # Process audio chunk for streaming STT
                    await websocket.send_json({"type": "ack", "chunk_id": message.get("chunk_id")})
                else:
                    await websocket.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})
        except Exception as e:
            logger.error(f"WebSocket stream error: {e}")
        finally:
            await self.disconnect(websocket)

    async def subscribe_events(self) -> None:
        """Subscribe to events and broadcast to WebSockets."""
        async def event_handler(event: Event):
            await self.broadcast({
                "type": "event",
                "event_type": event.type,
                "payload": event.payload,
                "timestamp": event.timestamp.isoformat(),
            })
        event_bus.subscribe("*", event_handler)
