"""Streaming inference support."""
import asyncio
from typing import AsyncIterator, Optional
from collections import deque

from runtime.logger import get_logger
from runtime.exceptions import InferenceError
from audio.stream import AudioStreamBuffer

logger = get_logger("streaming_inference")


class StreamingTTS:
    """Streaming text-to-speech."""

    def __init__(self, provider):
        self._provider = provider
        self._buffer = AudioStreamBuffer()

    async def stream(self, text: str, voice_id: Optional[str] = None) -> AsyncIterator[bytes]:
        """Stream synthesized audio chunks."""
        # This is a simplified implementation
        # Real streaming would chunk text and synthesize incrementally
        try:
            from providers.base import TTSRequest
            request = TTSRequest(text=text, voice_id=voice_id)
            response = await self._provider.synthesize(request)
            chunk_size = 4096
            audio = response.audio_data
            for i in range(0, len(audio), chunk_size):
                yield audio[i:i + chunk_size]
                await asyncio.sleep(0)
        except Exception as e:
            logger.error(f"Streaming TTS error: {e}")
            raise InferenceError(f"Streaming TTS failed: {e}")


class StreamingSTT:
    """Streaming speech-to-text."""

    def __init__(self, provider):
        self._provider = provider
        self._buffer = deque(maxlen=100)

    async def feed_audio(self, chunk: bytes) -> None:
        """Feed audio chunk for streaming transcription."""
        self._buffer.append(chunk)

    async def transcribe_stream(self) -> AsyncIterator[str]:
        """Stream transcription results."""
        # Simplified: accumulate and transcribe periodically
        accumulated = b""
        while True:
            while self._buffer:
                accumulated += self._buffer.popleft()
            if len(accumulated) > 16000 * 2:  # ~1 second at 16kHz 16-bit
                try:
                    from providers.base import STTRequest
                    request = STTRequest(audio_data=accumulated, format="pcm")
                    response = await self._provider.transcribe(request)
                    yield response.text
                    accumulated = b""
                except Exception as e:
                    logger.error(f"Streaming STT error: {e}")
            await asyncio.sleep(0.5)
