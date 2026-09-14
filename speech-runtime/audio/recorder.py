"""Audio recording interface."""
import asyncio
from typing import Optional, Callable
from dataclasses import dataclass

from runtime.logger import get_logger
from runtime.exceptions import AudioError

logger = get_logger("recorder")


@dataclass
class RecordingConfig:
    """Recording configuration."""
    sample_rate: int = 16000
    channels: int = 1
    bit_depth: int = 16
    chunk_size: int = 1024
    device_id: Optional[str] = None


class AudioRecorder:
    """Platform-agnostic audio recorder."""

    def __init__(self, config: Optional[RecordingConfig] = None):
        self.config = config or RecordingConfig()
        self._recording = False
        self._chunks: list[bytes] = []
        self._on_data: Optional[Callable[[bytes], None]] = None

    def set_callback(self, callback: Callable[[bytes], None]) -> None:
        """Set data callback for streaming."""
        self._on_data = callback

    async def start(self) -> None:
        """Start recording."""
        if self._recording:
            raise AudioError("Already recording")
        self._recording = True
        self._chunks = []
        logger.info("Recording started")

    async def stop(self) -> bytes:
        """Stop recording and return audio data."""
        if not self._recording:
            raise AudioError("Not recording")
        self._recording = False
        data = b"".join(self._chunks)
        self._chunks = []
        logger.info(f"Recording stopped: {len(data)} bytes")
        return data

    def feed(self, chunk: bytes) -> None:
        """Feed audio chunk (called by platform backend)."""
        if not self._recording:
            return
        self._chunks.append(chunk)
        if self._on_data:
            try:
                self._on_data(chunk)
            except Exception as e:
                logger.error(f"Recorder callback error: {e}")

    def is_recording(self) -> bool:
        """Check if currently recording."""
        return self._recording
