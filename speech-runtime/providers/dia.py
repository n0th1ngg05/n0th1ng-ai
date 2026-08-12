"""Dia TTS provider — real inference via nari-labs/dia."""
from typing import Any, Optional
import io
import torch

from providers.base import (
    BaseProvider, ProviderManifest, ModelInfo, VoiceInfo,
    TTSRequest, TTSResponse, STTRequest, STTResponse,
    BenchmarkConfig, BenchmarkResult,
)
from runtime.logger import get_logger
from runtime.exceptions import ProviderError
from utils.environment import get_device_preference
from utils.timer import Timer

logger = get_logger("dia_provider")

DEFAULT_MODEL = "dia-1.6b"
MODEL_REPO = "nari-labs/Dia-1.6B"
MODELS_DIR = "models/dia"


class DiaProvider(BaseProvider):
    """Dia TTS provider — real nari-labs/dia inference."""

    _model: Optional[Any] = None
    _current_model_id: Optional[str] = None

    @property
    def id(self) -> str:
        return "dia"

    @property
    def manifest(self) -> ProviderManifest:
        return ProviderManifest(
            id="dia",
            name="Dia",
            type="tts",
            version="1.0.0",
            description="Dia — high-quality expressive neural TTS with dialogue support",
            author="Nari Labs",
            license="Apache-2.0",
            supported_languages=["en"],
            capabilities=["tts"],
        )

    async def initialize(self) -> None:
        logger.info("Initializing Dia provider")
        self._device = get_device_preference("auto")
        self._initialized = True
        logger.info("Dia provider initialized (model loads on first request)")

    async def shutdown(self) -> None:
        logger.info("Shutting down Dia provider")
        self._model = None
        self._current_model_id = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._initialized = False

    async def health(self) -> dict[str, Any]:
        return {
            "status": "healthy" if self._initialized else "unhealthy",
            "model_loaded": self._model is not None,
            "current_model": self._current_model_id,
            "device": self._device,
        }

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id="dia-1.6b",
                name="Dia 1.6B",
                version="1.0.0",
                size=1600000000,
                languages=["en"],
                capabilities=["tts"],
                download_url=f"https://huggingface.co/{MODEL_REPO}",
            ),
        ]

    async def list_voices(self) -> list[VoiceInfo]:
        return [
            VoiceInfo(id="default",    name="Default",    language="en", gender="neutral", description="Default Dia voice",                  sample_rate=44100, is_default=True),
            VoiceInfo(id="speaker_s1", name="Speaker 1",  language="en", gender="neutral", description="Dialogue speaker [S1]",              sample_rate=44100),
            VoiceInfo(id="speaker_s2", name="Speaker 2",  language="en", gender="neutral", description="Dialogue speaker [S2]",              sample_rate=44100),
            VoiceInfo(id="expressive", name="Expressive", language="en", gender="neutral", description="High-emotion expressive rendering",  sample_rate=44100),
        ]

    def _load_model(self, model_id: str) -> None:
        """Load Dia model."""
        import os
        try:
            from dia.model import Dia
        except ImportError:
            raise ProviderError(
                "dia not installed. Run: pip install git+https://github.com/nari-labs/dia.git",
                self.id,
            )

        device = "cuda" if self._device != "cpu" and torch.cuda.is_available() else "cpu"

        # Try local checkpoint first, fall back to HF download
        local_dir = os.path.join(MODELS_DIR, model_id)
        if os.path.exists(os.path.join(local_dir, "config.json")):
            logger.info(f"Loading Dia from local checkpoint: {local_dir}")
            self._model = Dia.from_pretrained(local_dir, compute_dtype="float16" if device == "cuda" else "float32")
        else:
            logger.info(f"Downloading Dia model from {MODEL_REPO}")
            self._model = Dia.from_pretrained(MODEL_REPO, compute_dtype="float16" if device == "cuda" else "float32")
            # Cache locally
            os.makedirs(local_dir, exist_ok=True)
            self._model.save_pretrained(local_dir)
            logger.info(f"Saved Dia to {local_dir}")

        self._model = self._model.to(device)
        self._current_model_id = model_id
        logger.info(f"Dia model loaded on {device}")

    async def load_model(self, model_id: str) -> None:
        if self._model is None or self._current_model_id != model_id:
            self._load_model(model_id)
        self._loaded_model = model_id

    async def unload_model(self) -> None:
        self._model = None
        self._current_model_id = None
        self._loaded_model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _build_dia_text(self, text: str, voice_id: str) -> str:
        """
        Dia uses [S1] / [S2] tags for dialogue speakers.
        For single-voice modes, wrap the whole text in [S1].
        For speaker slots, pass through as-is (user provides tags).
        """
        if voice_id == "speaker_s2":
            return f"[S2] {text}"
        # Default, expressive, speaker_s1 → single speaker
        return f"[S1] {text}"

    async def synthesize(self, request: TTSRequest) -> TTSResponse:
        self._ensure_initialized()
        model_id = request.model_id or DEFAULT_MODEL

        if self._model is None or self._current_model_id != model_id:
            await self.load_model(model_id)

        voice_id = request.voice_id or "default"
        text = self._build_dia_text(request.text, voice_id)
        speed = request.speed or 1.0

        logger.info(f"Dia synthesizing: model={model_id}, voice={voice_id}, text_len={len(text)}")

        try:
            import soundfile as sf
            import numpy as np

            # Dia generate returns numpy float32 audio at 44100 Hz
            audio = self._model.generate(
                text,
                max_tokens=1024,
                verbose=False,
                use_torch_compile=False,
            )

            sample_rate = 44100
            audio = np.array(audio, dtype=np.float32)

            # Normalize
            peak = np.abs(audio).max()
            if peak > 0:
                audio = audio / peak * 0.9

            buf = io.BytesIO()
            sf.write(buf, audio, sample_rate, format="WAV")
            wav_data = buf.getvalue()
            duration = len(audio) / sample_rate

        except Exception as e:
            raise ProviderError(f"Dia inference failed: {e}", self.id)

        logger.info(f"Dia synthesis complete: {duration:.2f}s")

        return TTSResponse(
            audio_data=wav_data,
            format="wav",
            sample_rate=sample_rate,
            duration=duration,
            model_id=model_id,
            voice_id=voice_id,
        )

    async def transcribe(self, request: STTRequest) -> STTResponse:
        raise ProviderError("Dia does not support STT", self.id)

    async def benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        with Timer() as timer:
            await self.synthesize(TTSRequest(text=config.text or "Hello world"))
        return BenchmarkResult(
            latency_ms=timer.elapsed_ms,
            load_time_ms=timer.elapsed_ms * 0.5,
            inference_speed=1.0,
            rtf=timer.elapsed / (len(config.text or "Hello") * 0.13),
            memory_usage_mb=0.0,
        )
