"""STT inference coordinator."""
from typing import Optional

from providers.base import STTRequest, STTResponse
from providers.registry import ProviderRegistry
from models.manager import ModelManager
from runtime.logger import get_logger
from runtime.exceptions import InferenceError, NotFoundError
from utils.validation import validate_stt_request
from audio.converter import AudioConverter

logger = get_logger("stt_inference")


class STTInference:
    """Coordinates STT inference across providers."""

    def __init__(self, provider_registry: ProviderRegistry, model_manager: ModelManager):
        self._providers = provider_registry
        self._models = model_manager

    async def transcribe(self, request: dict) -> STTResponse:
        """Transcribe audio to text."""
        validate_stt_request(request)

        provider_id = request.get("provider_id", "whisper")
        model_id = request.get("model_id")
        audio_data = request.get("audio")
        audio_format = request.get("format", "wav")
        sample_rate = request.get("sample_rate", 16000)
        language = request.get("language")

        if not isinstance(audio_data, bytes):
            if isinstance(audio_data, str):
                import base64
                audio_data = base64.b64decode(audio_data)
            else:
                raise InferenceError("Invalid audio data type")

        provider = self._providers.get(provider_id)
        if not provider:
            raise NotFoundError(f"Provider {provider_id} not available")

        # Browser formats (webm, ogg, opus) often report sample_rate=0 or omit it.
        # Default to 16000 Hz for STT if the caller didn't specify a valid value.
        if sample_rate < 8000:
            sample_rate = 16000

        # Convert to wav if needed (webm/ogg/opus from browser MediaRecorder land here)
        if audio_format != "wav":
            audio_data = AudioConverter.convert(audio_data, audio_format, "wav", sample_rate)

        if not model_id:
            models = await provider.list_models()
            if models:
                model_id = models[0].id
            else:
                raise NotFoundError(f"No models available for provider {provider_id}")

        if not self._models.loader.is_loaded(model_id, provider_id):
            await provider.load_model(model_id)

        stt_request = STTRequest(
            audio_data=audio_data,
            format="wav",
            sample_rate=sample_rate,
            model_id=model_id,
            language=language,
        )

        logger.info(f"Transcribing with {provider_id}/{model_id}")
        response = await provider.transcribe(stt_request)
        return response