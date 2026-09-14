"""Provider loader for dynamic discovery."""
from __future__ import annotations

from typing import Type, Optional

from providers.base import BaseProvider
from providers.registry import ProviderRegistry
from runtime.logger import get_logger

logger = get_logger("provider_loader")


class ProviderLoader:
    """Loads and manages provider classes."""

    def __init__(self, registry: ProviderRegistry):
        self._registry = registry
        # Populated lazily by _discover_and_index(); maps provider_id -> class.
        self._discovered: dict[str, Type[BaseProvider]] = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def _discover_and_index(self) -> None:
        """Run provider discovery and index classes by their provider ID.

        Each class is instantiated *briefly* just to read its ``id`` property;
        the throwaway instance is discarded immediately (no ``initialize()``
        is called, so no network connections or heavy resources are created).
        """
        if self._discovered:
            return  # already indexed

        classes = self._registry.discover()
        for cls in classes:
            try:
                temp = cls()
                pid = temp.id
                self._discovered[pid] = cls
                # Clean up any resources the constructor may have opened
                # (e.g. httpx.AsyncClient for FishSpeech) without awaiting.
                if hasattr(temp, "client") and hasattr(temp.client, "_transport"):
                    pass  # httpx client is lazy — no connection yet, safe to GC
            except Exception as exc:
                logger.warning("Could not index provider class %s: %s", cls.__name__, exc)

    def get_class(self, provider_id: str) -> Optional[Type[BaseProvider]]:
        """Return a discovered provider class by ID, or None if unknown."""
        self._discover_and_index()
        return self._discovered.get(provider_id)

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    async def load_inprocess(self, skip_ids: set[str] | None = None) -> None:
        """Register only in-process (non-remote) providers.

        Providers whose IDs appear in *skip_ids* are expected to call
        ``POST /register`` themselves once their subprocess is ready, so they
        are skipped here.
        """
        skip_ids = skip_ids or set()
        self._discover_and_index()

        count = 0
        for provider_id, cls in self._discovered.items():
            if provider_id in skip_ids:
                logger.info(
                    "Skipping remote provider '%s' — will self-register via POST /register",
                    provider_id,
                )
                continue
            try:
                await self._registry.register(cls)
                count += 1
            except Exception as exc:
                logger.error("Failed to register in-process provider '%s': %s", cls.__name__, exc)

        logger.info("Loaded %d in-process provider(s)", count)

    async def load_all(self) -> None:
        """Discover and load *all* providers (legacy / backward-compat path)."""
        logger.info("Discovering providers...")
        self._discover_and_index()
        for cls in self._discovered.values():
            try:
                await self._registry.register(cls)
            except Exception as exc:
                logger.error("Failed to register %s: %s", cls.__name__, exc)
        logger.info("Loaded %d provider(s)", len(self._registry.list_all()))

    async def reload(self, provider_id: str) -> None:
        """Reload a specific provider."""
        await self._registry.reload(provider_id)
