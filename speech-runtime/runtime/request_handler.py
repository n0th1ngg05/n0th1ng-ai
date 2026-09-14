"""Request handler for incoming speech requests."""
from typing import Any
import base64

from runtime.logger import get_logger
from runtime.exceptions import SpeechRuntimeError, NotFoundError, AudioError

logger = get_logger("request_handler")


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from runtime.runtime_manager import RuntimeManager


class RequestHandler:

    def __init__(self, runtime: "RuntimeManager"):
        self._runtime = runtime

    async def handle_tts(self, request: dict) -> dict[str, Any]:
        """Handle TTS request."""
        try:
            logger.info(request)
            response = await self._runtime.tts_inference.synthesize(request)
            return {
                "success": True,
                "audio": base64.b64encode(response.audio_data).decode("utf-8"),
                "format": response.format,
                "sample_rate": response.sample_rate,
                "duration": response.duration,
                "model_id": response.model_id,
                "voice_id": response.voice_id,
            }
        except SpeechRuntimeError as e:
            logger.error(f"TTS error: {e.message}")
            return {"success": False, "error": e.message, "code": e.code}

    async def handle_stt(self, request: dict) -> dict[str, Any]:
        """Handle STT request."""
        try:
            response = await self._runtime.stt_inference.transcribe(request)
            return {
                "success": True,
                "text": response.text,
                "confidence": response.confidence,
                "model_id": response.model_id,
                "language": response.language,
                "segments": response.segments,
            }
        except AudioError as e:
            logger.error(f"STT audio error: {e}")
            return {"success": False, "error": str(e), "code": "AUDIO_ERROR"}
        except SpeechRuntimeError as e:
            logger.error(f"STT error: {e.message}")
            return {"success": False, "error": e.message, "code": e.code}

    async def handle_voice_chat(self, request: dict) -> dict[str, Any]:
        """Handle voice chat request."""
        try:
            result = await self._runtime.voice_chat.process(request)
            return {
                "success": True,
                "transcription": {
                    "text": result["transcription"].text,
                    "confidence": result["transcription"].confidence,
                },
                "audio": result["synthesis"].audio_data.hex(),
                "format": result["synthesis"].format,
                "duration": result["synthesis"].duration,
            }
        except SpeechRuntimeError as e:
            logger.error(f"Voice chat error: {e.message}")
            return {"success": False, "error": e.message, "code": e.code}