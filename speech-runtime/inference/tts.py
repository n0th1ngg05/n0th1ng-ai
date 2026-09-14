"""TTS inference coordinator."""
import asyncio
from typing import Optional

from providers.base import TTSRequest, TTSResponse
from providers.registry import ProviderRegistry
from models.manager import ModelManager
from voices.profiles import ProfileManager, VoiceProfile
from runtime.logger import get_logger
from runtime.exceptions import InferenceError, NotFoundError
from utils.validation import validate_tts_request

logger = get_logger("tts_inference")


class TTSInference:
    """Coordinates TTS inference across providers."""

    def __init__(self, provider_registry: ProviderRegistry, model_manager: ModelManager, profile_manager: ProfileManager):
        self._providers = provider_registry
        self._models = model_manager
        self._profiles = profile_manager

    async def synthesize(self, request: dict) -> TTSResponse:
        """Synthesize speech from text."""
        validate_tts_request(request)

        profile_id = request.get("profile_id")
        provider_id = request.get("provider_id")
        model_id = request.get("model_id")
        voice_id = request.get("voice_id")

        # Resolve profile
        profile: Optional[VoiceProfile] = None
        if profile_id:
            profile = await self._profiles.get_profile(profile_id)
        if not profile and provider_id and model_id and voice_id:
            profile = VoiceProfile(
                id="temp",
                name="Temporary",
                provider_id=provider_id,
                model_id=model_id,
                voice_id=voice_id,
            )
        if not profile:
            profile = await self._profiles.get_default()
        if not profile:
            raise NotFoundError("No voice profile could be resolved")

        provider = self._providers.get(profile.provider_id)
        if not provider:
            raise NotFoundError(f"Provider {profile.provider_id} not available")

        # Ensure model is loaded
        if not self._models.loader.is_loaded(profile.model_id, profile.provider_id):
            await provider.load_model(profile.model_id)

        tts_request = TTSRequest(
            text=request["text"],
            model_id=profile.model_id,
            voice_id=profile.voice_id,
            reference_id=request.get("reference_id"),
            speed=request.get("speed", profile.speed),
            pitch=request.get("pitch", profile.pitch),
            temperature=request.get("temperature", profile.temperature),
            volume=request.get("volume", profile.volume),
            emotion=request.get("emotion", profile.emotion),
            language=request.get("language", profile.language),
            format=request.get("format", "wav"),
            sample_rate=request.get("sample_rate", 22050),
        )

        logger.info(f"Synthesizing with {provider.id}/{profile.model_id}/{profile.voice_id}")
        response = await provider.synthesize(tts_request)
        return response
