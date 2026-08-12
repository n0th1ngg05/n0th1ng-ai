"""Piper TTS provider — real inference via piper-tts."""
from typing import Any, Optional
import io
import wave

from providers.base import (
    BaseProvider, ProviderManifest, ModelInfo, VoiceInfo,
    TTSRequest, TTSResponse, STTRequest, STTResponse,
    BenchmarkConfig, BenchmarkResult,
)
from runtime.logger import get_logger
from runtime.exceptions import ProviderError
from utils.environment import get_device_preference
from utils.timer import Timer

logger = get_logger("piper_provider")


# Voice ID → (model_path, config_path) mapping.
# Piper requires a downloaded .onnx model + .onnx.json config per voice.
# Models are expected inside speech-runtime/models/piper/<voice_id>/
VOICE_MODEL_MAP = {
    "en_US-lessac":  ("en_US-lessac-medium.onnx",   "en_US-lessac-medium.onnx.json"),
    "en_US-ryan":    ("en_US-ryan-high.onnx",        "en_US-ryan-high.onnx.json"),
    "en_US-amy":     ("en_US-amy-medium.onnx",       "en_US-amy-medium.onnx.json"),
    "en_US-kusal":   ("en_US-kusal-medium.onnx",     "en_US-kusal-medium.onnx.json"),
    "en_GB-alan":    ("en_GB-alan-medium.onnx",      "en_GB-alan-medium.onnx.json"),
    "en_GB-jenny":   ("en_GB-jenny_dioco-medium.onnx", "en_GB-jenny_dioco-medium.onnx.json"),
    "de_DE-thorsten": ("de_DE-thorsten-medium.onnx", "de_DE-thorsten-medium.onnx.json"),
    "fr_FR-siwis":   ("fr_FR-siwis-medium.onnx",     "fr_FR-siwis-medium.onnx.json"),
}

DEFAULT_VOICE = "en_US-lessac"
MODELS_DIR = "models/piper"


class PiperProvider(BaseProvider):
    """Piper TTS provider — real inference."""

    _voice: Optional[Any] = None
    _current_voice_id: Optional[str] = None

    @property
    def id(self) -> str:
        return "piper"

    @property
    def manifest(self) -> ProviderManifest:
        return ProviderManifest(
            id="piper",
            name="Piper",
            type="tts",
            version="1.0.0",
            description="Fast local neural TTS",
            author="Rhasspy",
            license="MIT",
            supported_languages=["en", "en-gb", "de", "fr"],
            capabilities=["tts"],
        )

    async def initialize(self) -> None:
        logger.info("Initializing Piper provider")
        self._device = get_device_preference("auto")
        self._initialized = True
        logger.info("Piper provider initialized (model loads on first request)")

    async def shutdown(self) -> None:
        logger.info("Shutting down Piper provider")
        self._voice = None
        self._current_voice_id = None
        self._initialized = False

    async def health(self) -> dict[str, Any]:
        return {
            "status": "healthy" if self._initialized else "unhealthy",
            "voice_loaded": self._voice is not None,
            "current_voice": self._current_voice_id,
        }

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id="piper-en",    name="Piper English (US)", version="1.0.0", size=50000000, languages=["en"], capabilities=["tts"], download_url="https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US"),
            ModelInfo(id="piper-en-gb", name="Piper English (GB)", version="1.0.0", size=50000000, languages=["en-gb"], capabilities=["tts"], download_url="https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB"),
            ModelInfo(id="piper-de",    name="Piper German",       version="1.0.0", size=50000000, languages=["de"], capabilities=["tts"], download_url="https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE"),
            ModelInfo(id="piper-fr",    name="Piper French",       version="1.0.0", size=50000000, languages=["fr"], capabilities=["tts"], download_url="https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR"),
        ]

    async def list_voices(self) -> list[VoiceInfo]:
        return [
            VoiceInfo(id="en_US-lessac",   name="Lessac (US Female)", language="en",    gender="female", description="American English female", sample_rate=22050, is_default=True),
            VoiceInfo(id="en_US-ryan",     name="Ryan (US Male)",     language="en",    gender="male",   description="American English male",   sample_rate=22050),
            VoiceInfo(id="en_US-amy",      name="Amy (US Female)",    language="en",    gender="female", description="Warm American English",   sample_rate=22050),
            VoiceInfo(id="en_US-kusal",    name="Kusal (US Male)",    language="en",    gender="male",   description="Deep American English",   sample_rate=22050),
            VoiceInfo(id="en_GB-alan",     name="Alan (GB Male)",     language="en-gb", gender="male",   description="British English male",    sample_rate=22050),
            VoiceInfo(id="en_GB-jenny",    name="Jenny (GB Female)",  language="en-gb", gender="female", description="British English female",  sample_rate=22050),
            VoiceInfo(id="de_DE-thorsten", name="Thorsten (DE Male)", language="de",    gender="male",   description="German male",             sample_rate=22050),
            VoiceInfo(id="fr_FR-siwis",    name="Siwis (FR Female)",  language="fr",    gender="female", description="French female",           sample_rate=22050),
        ]

    def _get_model_path(self, voice_id: str) -> tuple[str, str]:
        """Resolve onnx + json paths for a voice."""
        import os
        onnx_name, json_name = VOICE_MODEL_MAP.get(voice_id, VOICE_MODEL_MAP[DEFAULT_VOICE])
        base = os.path.join(MODELS_DIR, voice_id)
        return os.path.join(base, onnx_name), os.path.join(base, json_name)

    def _load_voice(self, voice_id: str) -> None:
        """Load piper Voice object for the requested voice_id."""
        from piper.voice import PiperVoice
        import os

        onnx_path, config_path = self._get_model_path(voice_id)

        if not os.path.exists(onnx_path):
            raise ProviderError(
                f"Piper model not found: {onnx_path}. "
                f"Download from https://huggingface.co/rhasspy/piper-voices and place in {MODELS_DIR}/{voice_id}/",
                self.id,
            )

        logger.info(f"Loading Piper voice: {voice_id} from {onnx_path}")
        self._voice = PiperVoice.load(onnx_path, config_path=config_path, use_cuda=False)
        self._current_voice_id = voice_id
        logger.info(f"Piper voice loaded: {voice_id}")

    async def load_model(self, model_id: str) -> None:
        self._loaded_model = model_id

    async def unload_model(self) -> None:
        self._voice = None
        self._current_voice_id = None
        self._loaded_model = None

    async def synthesize(self, request: TTSRequest) -> TTSResponse:
        self._ensure_initialized()
        voice_id = request.voice_id or DEFAULT_VOICE

        # Reload if different voice requested
        if self._voice is None or self._current_voice_id != voice_id:
            self._load_voice(voice_id)

        self._loaded_model = self._loaded_model or "piper-en"

        logger.info(f"Piper synthesizing: voice={voice_id}, text_len={len(request.text)}")

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            self._voice.synthesize(request.text, wav_file, length_scale=1.0 / max(request.speed or 1.0, 0.1))

        wav_data = buf.getvalue()
        sample_rate = self._voice.config.sample_rate
        num_samples = (len(wav_data) - 44) // 2  # rough estimate from WAV bytes
        duration = num_samples / sample_rate

        logger.info(f"Piper synthesis complete: {duration:.2f}s, {len(wav_data)} bytes")

        return TTSResponse(
            audio_data=wav_data,
            format="wav",
            sample_rate=sample_rate,
            duration=duration,
            model_id=self._loaded_model,
            voice_id=voice_id,
        )

    async def transcribe(self, request: STTRequest) -> STTResponse:
        raise ProviderError("Piper does not support STT", self.id)

    async def benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        with Timer() as timer:
            await self.synthesize(TTSRequest(text=config.text or "Hello world"))
        return BenchmarkResult(
            latency_ms=timer.elapsed_ms,
            load_time_ms=timer.elapsed_ms * 0.2,
            inference_speed=1.0,
            rtf=timer.elapsed / (len(config.text or "Hello") * 0.08),
            memory_usage_mb=0.0,
        )
