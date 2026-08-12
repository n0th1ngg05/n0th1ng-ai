"""Batch inference support."""
import asyncio
from typing import List, Optional
from dataclasses import dataclass

from runtime.logger import get_logger
from runtime.exceptions import InferenceError

logger = get_logger("batch_inference")


@dataclass
class BatchTTSItem:
    """Single item in a TTS batch."""
    text: str
    voice_id: Optional[str] = None
    model_id: Optional[str] = None


@dataclass
class BatchSTTItem:
    """Single item in an STT batch."""
    audio_data: bytes
    format: str = "wav"
    sample_rate: int = 16000


class BatchTTS:
    """Batch TTS inference."""

    def __init__(self, provider):
        self._provider = provider

    async def process(self, items: List[BatchTTSItem]) -> List[bytes]:
        """Process a batch of TTS requests."""
        results = []
        for item in items:
            try:
                from providers.base import TTSRequest
                request = TTSRequest(
                    text=item.text,
                    voice_id=item.voice_id,
                    model_id=item.model_id,
                )
                response = await self._provider.synthesize(request)
                results.append(response.audio_data)
            except Exception as e:
                logger.error(f"Batch TTS item failed: {e}")
                results.append(b"")
        return results


class BatchSTT:
    """Batch STT inference."""

    def __init__(self, provider):
        self._provider = provider

    async def process(self, items: List[BatchSTTItem]) -> List[str]:
        """Process a batch of STT requests."""
        results = []
        for item in items:
            try:
                from providers.base import STTRequest
                request = STTRequest(
                    audio_data=item.audio_data,
                    format=item.format,
                    sample_rate=item.sample_rate,
                )
                response = await self._provider.transcribe(request)
                results.append(response.text)
            except Exception as e:
                logger.error(f"Batch STT item failed: {e}")
                results.append("")
        return results
