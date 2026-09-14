"""Provider self-registration and heartbeat tracking.

Remote engines (FishSpeech, Chatterbox, …) call POST /register when they
are ready, and POST /heartbeat periodically so the runtime knows they are
still alive.  RegistrationManager evicts any provider that misses too many
heartbeats.
"""
from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from runtime.logger import get_logger
from runtime.events import event_bus, Event

if TYPE_CHECKING:
    from runtime.runtime_manager import RuntimeManager

logger = get_logger("registration")

# A provider is considered stale after this many seconds without a heartbeat.
HEARTBEAT_TIMEOUT: int = 60
# How often the watchdog loop wakes up to check timestamps.
HEARTBEAT_CHECK_INTERVAL: int = 20


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------


class ProviderRegistration(BaseModel):
    """Payload accepted by POST /register."""

    provider_id: str = Field(..., description="Stable provider identifier, e.g. 'fishspeech'")
    port: int = Field(..., description="TCP port the engine is listening on")
    url: str = Field(default="", description="Full base URL override (optional)")
    metadata: dict = Field(default_factory=dict, description="Arbitrary extra info")


class HeartbeatPayload(BaseModel):
    """Payload accepted by POST /heartbeat."""

    provider_id: str = Field(..., description="Provider sending the heartbeat")


# ---------------------------------------------------------------------------
# RegistrationManager
# ---------------------------------------------------------------------------


class RegistrationManager:
    """Tracks heartbeat timestamps and evicts providers that go silent."""

    def __init__(self, runtime: RuntimeManager) -> None:
        self._runtime = runtime
        # provider_id -> monotonic timestamp of last heartbeat
        self._heartbeats: dict[str, float] = {}
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record_heartbeat(self, provider_id: str) -> None:
        """Update the last-seen timestamp for a registered provider."""
        self._heartbeats[provider_id] = time.monotonic()
        logger.debug("Heartbeat from %s", provider_id)

    def untrack(self, provider_id: str) -> None:
        """Stop tracking heartbeats for a provider (e.g. after explicit unregister)."""
        self._heartbeats.pop(provider_id, None)

    def start(self) -> None:
        """Start the background watchdog coroutine."""
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._watchdog())
            logger.debug("Heartbeat watchdog started (timeout=%ds)", HEARTBEAT_TIMEOUT)

    def stop(self) -> None:
        """Cancel the watchdog coroutine."""
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None
        logger.debug("Heartbeat watchdog stopped")

    # ------------------------------------------------------------------
    # Internal watchdog
    # ------------------------------------------------------------------

    async def _watchdog(self) -> None:
        """Periodically evict providers whose heartbeats have gone silent."""
        while True:
            await asyncio.sleep(HEARTBEAT_CHECK_INTERVAL)
            now = time.monotonic()
            for provider_id, last_seen in list(self._heartbeats.items()):
                age = now - last_seen
                if age > HEARTBEAT_TIMEOUT:
                    logger.warning(
                        "Provider '%s' missed heartbeat (last seen %.0fs ago) — removing",
                        provider_id,
                        age,
                    )
                    self._heartbeats.pop(provider_id, None)
                    try:
                        await self._runtime.provider_registry.unregister(provider_id)
                        await event_bus.emit(
                            Event(
                                "provider_unregistered",
                                {
                                    "provider_id": provider_id,
                                    "reason": "heartbeat_timeout",
                                },
                            )
                        )
                    except Exception as exc:
                        logger.error(
                            "Failed to evict stale provider '%s': %s",
                            provider_id,
                            exc,
                        )
