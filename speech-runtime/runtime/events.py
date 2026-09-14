"""Event bus for the speech runtime."""
import asyncio
from typing import Any, Callable, Awaitable, Optional
from dataclasses import dataclass, field
from datetime import datetime

from runtime.logger import get_logger

logger = get_logger("events")


@dataclass
class Event:
    """Runtime event."""
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)


EventHandler = Callable[[Event], Awaitable[None]]


class EventBus:
    """Async event bus for decoupled communication."""

    def __init__(self):
        self._handlers: dict[str, list[EventHandler]] = {}
        self._history: list[Event] = []
        self._max_history = 1000

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        """Subscribe to an event type."""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)
        logger.debug(f"Handler subscribed to {event_type}")

    def unsubscribe(self, event_type: str, handler: EventHandler) -> None:
        """Unsubscribe from an event type."""
        if event_type in self._handlers:
            self._handlers[event_type] = [h for h in self._handlers[event_type] if h != handler]

    async def emit(self, event: Event) -> None:
        """Emit an event to all subscribers."""
        self._history.append(event)
        if len(self._history) > self._max_history:
            self._history.pop(0)

        handlers = self._handlers.get(event.type, [])
        if not handlers:
            return
        await asyncio.gather(*[self._safe_call(h, event) for h in handlers], return_exceptions=True)

    async def _safe_call(self, handler: EventHandler, event: Event) -> None:
        """Safely call an event handler."""
        try:
            await handler(event)
        except Exception as e:
            logger.error(f"Event handler error for {event.type}: {e}")

    def get_history(self, event_type: Optional[str] = None) -> list[Event]:
        """Get event history."""
        if event_type:
            return [e for e in self._history if e.type == event_type]
        return list(self._history)


# Global event bus instance
event_bus = EventBus()
