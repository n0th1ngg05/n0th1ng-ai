"""Voice loading utilities."""
import asyncio
from pathlib import Path
from typing import Optional, Any

from runtime.logger import get_logger
from runtime.exceptions import SpeechRuntimeError
from utils.paths import get_voices_path, ensure_dir

logger = get_logger("voice_loader")


class VoiceLoader:
    """Loads voice data and configurations."""

    def __init__(self):
        self._loaded_voices: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    async def load(self, voice_id: str, provider_id: str, load_fn: callable) -> Any:
        """Load a voice if not already loaded."""
        key = f"{provider_id}:{voice_id}"
        async with self._lock:
            if key in self._loaded_voices:
                return self._loaded_voices[key]
            voice = await load_fn()
            self._loaded_voices[key] = voice
            logger.info(f"Voice loaded: {key}")
            return voice

    async def unload(self, voice_id: str, provider_id: str) -> None:
        """Unload a voice."""
        key = f"{provider_id}:{voice_id}"
        async with self._lock:
            if key in self._loaded_voices:
                del self._loaded_voices[key]
                logger.info(f"Voice unloaded: {key}")

    def is_loaded(self, voice_id: str, provider_id: str) -> bool:
        """Check if a voice is loaded."""
        key = f"{provider_id}:{voice_id}"
        return key in self._loaded_voices

    def get_voice_path(self, provider_id: str, voice_id: str) -> Path:
        """Get the storage path for a voice."""
        return ensure_dir(get_voices_path() / provider_id / voice_id)
