"""Voice registry for provider voices."""
from typing import Optional, Any

from runtime.logger import get_logger
from providers.base import VoiceInfo

logger = get_logger("voice_registry")


class VoiceRegistry:
    """Registry for available voices across providers."""

    def __init__(self):
        self._voices: dict[str, VoiceInfo] = {}

    def register(self, voice: VoiceInfo) -> None:
        """Register a voice."""
        self._voices[voice.id] = voice
        logger.debug(f"Registered voice: {voice.id}")

    def unregister(self, voice_id: str) -> None:
        """Unregister a voice."""
        if voice_id in self._voices:
            del self._voices[voice_id]
            logger.debug(f"Unregistered voice: {voice_id}")

    def get(self, voice_id: str) -> Optional[VoiceInfo]:
        """Get a voice by ID."""
        return self._voices.get(voice_id)

    def list_all(self) -> list[VoiceInfo]:
        """List all registered voices."""
        return list(self._voices.values())

    def list_by_provider(self, provider_id: str) -> list[VoiceInfo]:
        """List voices by provider."""
        return [v for v in self._voices.values() if hasattr(v, "provider_id") and getattr(v, "provider_id") == provider_id]

    def clear(self) -> None:
        """Clear all voices."""
        self._voices.clear()
