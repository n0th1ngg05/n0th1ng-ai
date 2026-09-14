"""Audio playback interface."""
import asyncio
from typing import Optional, Callable

from runtime.logger import get_logger
from runtime.exceptions import AudioError

logger = get_logger("player")


class AudioPlayer:
    """Platform-agnostic audio player."""

    def __init__(self):
        self._playing = False
        self._on_complete: Optional[Callable[[], None]] = None

    def set_callback(self, callback: Callable[[], None]) -> None:
        """Set completion callback."""
        self._on_complete = callback

    async def play(self, audio_data: bytes, sample_rate: int = 22050, channels: int = 1) -> None:
        """Play audio data."""
        if self._playing:
            await self.stop()
        self._playing = True
        logger.info(f"Playback started: {len(audio_data)} bytes")
        # Platform-specific playback would happen here
        # For now, simulate duration
        duration = len(audio_data) / (sample_rate * channels * 2)
        await asyncio.sleep(duration)
        self._playing = False
        if self._on_complete:
            try:
                self._on_complete()
            except Exception as e:
                logger.error(f"Player callback error: {e}")

    async def stop(self) -> None:
        """Stop playback."""
        self._playing = False
        logger.info("Playback stopped")

    def is_playing(self) -> bool:
        """Check if currently playing."""
        return self._playing
