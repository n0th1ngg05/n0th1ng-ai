"""Whisper STT provider implementation."""
from typing import Any
from faster_whisper import WhisperModel
import tempfile
import os

from providers.base import (
    BaseProvider, ProviderManifest, ModelInfo, VoiceInfo,
    TTSRequest, TTSResponse, STTRequest, STTResponse,
    BenchmarkConfig, BenchmarkResult,
)
from runtime.logger import get_logger
from runtime.exceptions import ProviderError
from audio.wav import WavUtil
from utils.environment import get_device_preference
from utils.timer import Timer

logger = get_logger("whisper_provider")


class WhisperProvider(BaseProvider):
    """Whisper STT provider."""

    @property
    def id(self) -> str:
        return "whisper"

    @property
    def manifest(self) -> ProviderManifest:
        return ProviderManifest(
            id="whisper",
            name="Whisper",
            type="stt",
            version="1.0.0",
            description="OpenAI Whisper speech recognition",
            author="OpenAI",
            license="MIT",
            supported_languages=["en", "zh", "de", "es", "ru", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it"],
            capabilities=["stt"],
        )

    async def initialize(self) -> None:
        self._model = None
        logger.info("Initializing Whisper provider")
        self._device = get_device_preference("auto")
        self._initialized = True

    async def shutdown(self) -> None:
        logger.info("Shutting down Whisper provider")
        await self.unload_model()
        self._initialized = False

    async def health(self) -> dict[str, Any]:
        return {"status": "healthy" if self._initialized else "unhealthy", "models_loaded": 1 if self._loaded_model else 0, "device": self._device}

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id="whisper-tiny", name="Whisper Tiny", version="1.0.0", size=75000000, languages=["en", "zh", "de", "es", "ru", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it"], capabilities=["stt"], download_url="https://huggingface.co/openai/whisper-tiny/resolve/main/model.bin"),
            ModelInfo(id="whisper-base", name="Whisper Base", version="1.0.0", size=150000000, languages=["en", "zh", "de", "es", "ru", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it"], capabilities=["stt"], download_url="https://huggingface.co/openai/whisper-base/resolve/main/model.bin"),
        ]

    async def list_voices(self) -> list[VoiceInfo]:
        return []

    async def load_model(self, model_id: str) -> None:

        logger.info(f"Loading Whisper model: {model_id}")

        size = model_id.replace("whisper-", "")

        try:
            self._model = WhisperModel(
                size,
                device=self._device,
                compute_type="float16" if self._device == "cuda" else "int8",
            )
        except ValueError as e:
            # torch.cuda.is_available() (get_device_preference) can report
            # CUDA as usable while faster-whisper's own CTranslate2
            # CUDA/cuDNN backend can't actually do efficient float16 on this
            # machine/GPU. Fall back to CPU + int8 rather than hard-failing
            # every request.
            logger.warning(f"Whisper CUDA/float16 load failed ({e}); falling back to CPU/int8")
            self._device = "cpu"
            self._model = WhisperModel(
                size,
                device=self._device,
                compute_type="int8",
            )

        self._loaded_model = model_id

    async def unload_model(self) -> None:
        self._model = None
        self._loaded_model = None

    async def synthesize(self, request: TTSRequest) -> TTSResponse:
        raise ProviderError("Whisper does not support TTS", self.id)

    async def transcribe(self, request: STTRequest) -> STTResponse:
        self._ensure_initialized()
        if not self._loaded_model:
            await self.load_model("whisper-base")

        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False
        ) as f:

            f.write(request.audio_data)

            temp_path = f.name

        try:

            segments, info = self._model.transcribe(
                temp_path,
                language=request.language,
                beam_size=5,
            )

            text = " ".join(
                segment.text.strip()
                for segment in segments
            )

        finally:

            os.remove(temp_path)

        return STTResponse(
            text=text,
            confidence=1.0,
            model_id=self._loaded_model,
            language=info.language,
        )

    async def benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        with Timer() as timer:
            await self.transcribe(STTRequest(audio_data=config.audio_data or b""))
        return BenchmarkResult(latency_ms=timer.elapsed_ms, load_time_ms=timer.elapsed_ms * 0.2, inference_speed=1.0, rtf=timer.elapsed, memory_usage_mb=0.0)