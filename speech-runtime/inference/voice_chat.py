"""Voice chat inference coordinator."""
from typing import Optional

from inference.tts import TTSInference
from inference.stt import STTInference
from providers.base import STTResponse, TTSResponse
from runtime.logger import get_logger
from runtime.exceptions import InferenceError

logger = get_logger("voice_chat")


class VoiceChatInference:
    """Coordinates voice chat (STT -> TTS)."""

    def __init__(self, tts: TTSInference, stt: STTInference):
        self._tts = tts
        self._stt = stt

    async def process(self, request: dict) -> dict:
        """Process voice chat request."""
        # Step 1: Transcribe
        stt_request = {
            "audio": request.get("audio"),
            "format": request.get("format", "wav"),
            "sample_rate": request.get("sample_rate", 16000),
            "language": request.get("language"),
            "provider_id": request.get("stt_provider_id", "whisper"),
        }
        transcription = await self._stt.transcribe(stt_request)
        logger.info(f"Voice chat transcription: {transcription.text}")

        # Step 2: Synthesize response
        tts_request = {
            "text": transcription.text,
            "profile_id": request.get("profile_id"),
            "provider_id": request.get("tts_provider_id"),
            "model_id": request.get("tts_model_id"),
            "voice_id": request.get("tts_voice_id"),
            "language": request.get("language"),
        }
        synthesis = await self._tts.synthesize(tts_request)

        return {
            "transcription": transcription,
            "synthesis": synthesis,
        }
