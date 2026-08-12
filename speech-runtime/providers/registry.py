"""Provider registry with automatic discovery."""
import os
import sys
import importlib
import importlib.util
import inspect
from pathlib import Path
from typing import Type, Optional

from providers.base import BaseProvider
from runtime.logger import get_logger
from runtime.events import event_bus, Event

logger = get_logger("provider_registry")


class ProviderRegistry:
    """Registry for provider discovery and management."""

    def __init__(self, search_paths: list[str] = None, runtime = None,):
        self._providers: dict[str, BaseProvider] = {}
        self._search_paths = search_paths or ["providers"]
        self._provider_classes: dict[str, Type[BaseProvider]] = {}
        self._runtime = runtime

    def discover(self) -> list[Type[BaseProvider]]:
        """Automatically discover provider classes."""
        discovered = []
        base_dir = Path(__file__).parent.parent

        for path_str in self._search_paths:
            path = base_dir / path_str
            if not path.exists():
                logger.warning(f"Provider path not found: {path}")
                continue

            for file in path.glob("*.py"):
                if file.name.startswith("_") or file.name == "base.py":
                    continue
                try:
                    module_name = f"{path_str}.{file.stem}"
                    spec = importlib.util.spec_from_file_location(module_name, file)
                    if spec is None or spec.loader is None:
                        continue
                    module = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = module
                    spec.loader.exec_module(module)

                    for name, obj in inspect.getmembers(module, inspect.isclass):
                        if issubclass(obj, BaseProvider) and obj is not BaseProvider and not inspect.isabstract(obj):
                            discovered.append(obj)
                            logger.info(f"Discovered provider class: {name} in {file.name}")
                except Exception as e:
                    logger.error(f"Failed to load provider from {file}: {e}")

        return discovered

    async def register(self, provider_class: Type[BaseProvider]) -> BaseProvider:
        """Register and initialize a provider."""
        instance = provider_class()
        instance.runtime = self._runtime
        await instance.initialize()
        self._providers[instance.id] = instance
        self._provider_classes[instance.id] = provider_class
        logger.info(f"Registered provider: {instance.id}")
        await event_bus.emit(Event("provider_loaded", {"provider_id": instance.id}))
        return instance

    async def unregister(self, provider_id: str) -> None:
        """Unregister and shutdown a provider."""
        provider = self._providers.get(provider_id)
        if provider:
            await provider.shutdown()
            del self._providers[provider_id]
            logger.info(f"Unregistered provider: {provider_id}")
            await event_bus.emit(Event("provider_removed", {"provider_id": provider_id}))

    async def reload(self, provider_id: str) -> BaseProvider:
        """Reload a provider."""
        await self.unregister(provider_id)
        provider_class = self._provider_classes.get(provider_id)
        if provider_class:
            return await self.register(provider_class)
        raise RuntimeError(f"Provider class for {provider_id} not found")

    def get(self, provider_id: str) -> Optional[BaseProvider]:
        """Get a provider by ID."""
        return self._providers.get(provider_id)

    def list_all(self) -> list[BaseProvider]:
        """List all registered providers."""
        return list(self._providers.values())

    def list_ids(self) -> list[str]:
        """List all registered provider IDs."""
        return list(self._providers.keys())

    async def initialize_all(self) -> None:
        """Discover and register all providers."""
        classes = self.discover()
        for cls in classes:
            try:
                await self.register(cls)
            except Exception as e:
                logger.error(f"Failed to register provider {cls.__name__}: {e}")

    async def shutdown_all(self) -> None:
        """Shutdown all providers."""
        for provider_id in list(self._providers.keys()):
            await self.unregister(provider_id)
