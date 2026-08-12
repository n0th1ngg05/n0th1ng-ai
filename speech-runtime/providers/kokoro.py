"""Kokoro TTS provider — HTTP client only.

This provider never imports KPipeline/kokoro, never touches CUDA, and never
loads a model in-process. All inference happens in the separate Kokoro
engine subprocess (engines/kokoro/, spawned by the user via launcher.py,
NOT auto-started by RuntimeManager) which exposes an HTTP API on
127.0.0.1:6103. This provider mirrors providers/chatterbox.py and
providers/fishspeech.py's architecture exactly.
"""
from __future__ import annotations

import asyncio
import io
import re
import wave
from typing import Any

import httpx

from providers.base import (
    BaseProvider,
    ProviderManifest,
    ModelInfo,
    VoiceInfo,
    TTSRequest,
    TTSResponse,
    STTRequest,
    STTResponse,
    BenchmarkConfig,
    BenchmarkResult,
)

from runtime.logger import get_logger
from runtime.exceptions import ProviderError
from utils.timer import Timer

logger = get_logger("kokoro_provider")

DEFAULT_MODEL = "kokoro-82M"

# Common unit abbreviations Kokoro reads letter-by-letter or mispronounces
# if left as-is (e.g. "km/h" -> "km by h"). Longer/more specific keys must
# come before shorter ones they contain (e.g. "km/h" before "km").
_UNIT_REPLACEMENTS: list[tuple[str, str]] = [
    (r"(?<=[\d\s])km/h\b", "kilometers per hour"),
    (r"\bmph\b", "miles per hour"),
    (r"(?<=[\d\s])m/s\b", "meters per second"),
    (r"(?<=[\d\s])km\b", "kilometers"),
    (r"(?<=[\d\s])kg\b", "kilograms"),
    (r"(?<=[\d\s])mg\b", "milligrams"),
    (r"(?<=[\d\s])cm\b", "centimeters"),
    (r"(?<=[\d\s])mm\b", "millimeters"),
    (r"(?<=[\d\s])ft\b", "feet"),
    (r"\bhr\b", "hour"),
    (r"\bhrs\b", "hours"),
]


def _normalize_text_for_tts(text: str) -> str:
    """Strip markdown formatting and expand symbols/units into words Kokoro
    can pronounce naturally, instead of reading punctuation literally
    (e.g. "**bold**" -> "bold", "28\u00b0C" -> "28 degrees Celsius",
    "10 km/h" -> "10 kilometers per hour")."""
    if not text:
        return text

    # --- Markdown formatting -> plain text -------------------------------
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", text)   # ***bold italic***
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)       # **bold**
    text = re.sub(r"\*(.+?)\*", r"\1", text)           # *italic*
    text = re.sub(r"__(.+?)__", r"\1", text)           # __bold__
    text = re.sub(r"_(.+?)_", r"\1", text)             # _italic_
    text = re.sub(r"`([^`]+)`", r"\1", text)           # `code`
    text = re.sub(r"~~(.+?)~~", r"\1", text)           # ~~strikethrough~~
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)  # # headings
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)  # bullet markers

    # --- Temperature: "28°C" / "28 °C" / "28°F" --------------------------
    text = re.sub(r"(-?\d+(?:\.\d+)?)\s*°\s*C\b", r"\1 degrees Celsius", text)
    text = re.sub(r"(-?\d+(?:\.\d+)?)\s*°\s*F\b", r"\1 degrees Fahrenheit", text)
    text = re.sub(r"(-?\d+(?:\.\d+)?)\s*°(?!\s*[CF])", r"\1 degrees", text)

    # --- Percent / currency symbols --------------------------------------
    text = re.sub(r"(\d)\s*%", r"\1 percent", text)
    text = text.replace("&", " and ")

    # --- Decimal numbers: "98.6" -> "98 point 6" -------------------------
    # Must run after temperature/percent above (which consume the whole
    # "98.6" as one number first) so a value like "98.6°F" still becomes
    # "98.6 degrees Fahrenheit" -> "98 point 6 degrees Fahrenheit", rather
    # than being split into two sentences at the "." before those rules
    # get a chance to see it as a single number.
    text = re.sub(r"(?<=\d)\.(?=\d)", " point ", text)

    # --- Units of measurement (word-boundary matched) --------------------
    for pattern, replacement in _UNIT_REPLACEMENTS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    # Collapse any double spaces left behind by the substitutions above,
    # and ensure a space between a digit and an expanded unit word
    # (e.g. "5kilometers" -> "5 kilometers").
    text = re.sub(r"(\d)([A-Za-z])", r"\1 \2", text)
    text = re.sub(r"[ \t]{2,}", " ", text)

    return text.strip()


class KokoroProvider(BaseProvider):
    """Kokoro TTS provider — communicates with the Kokoro engine
    exclusively over HTTP, exactly like ChatterboxProvider/FishSpeechProvider."""

    def __init__(self):
        super().__init__()
        self.client = httpx.AsyncClient(
            base_url="http://127.0.0.1:6103",
            timeout=httpx.Timeout(
                connect=10.0,
                read=300.0,
                write=300.0,
                pool=300.0,
            ),
        )

    @property
    def id(self) -> str:
        return "kokoro"

    @property
    def manifest(self) -> ProviderManifest:
        return ProviderManifest(
            id="kokoro",
            name="Kokoro",
            type="tts",
            version="1.0.0",
            description="Kokoro HTTP Engine — lightweight high-quality TTS",
            author="Kokoro Team",
            license="MIT",
            supported_languages=["en"],
            capabilities=["tts"],
            supports_tts=True,
            supports_streaming=False,
            supports_voice_cloning=False,
            supports_gpu=True,
            supports_cpu=True,
        )

    async def initialize(self):
        logger.info("Initializing Kokoro provider")

        # Mirrors ChatterboxProvider/FishSpeechProvider.initialize(): the
        # engine subprocess is started independently by the user (not by
        # EngineManager), so retry rather than fail permanently if it
        # isn't up yet when the runtime boots.
        max_attempts = 12
        retry_delay_seconds = 5.0  # 12 * 5s = up to 60s additional wait

        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                response = await self.client.get("/v1/health")
                response.raise_for_status()
                self._initialized = True
                logger.info(
                    "Connected to Kokoro engine (attempt %d/%d)",
                    attempt,
                    max_attempts,
                )
                return
            except Exception as e:
                last_error = e
                if attempt < max_attempts:
                    logger.warning(
                        "Kokoro engine not ready yet (attempt %d/%d): %s — retrying in %.0fs",
                        attempt,
                        max_attempts,
                        e,
                        retry_delay_seconds,
                    )
                    await asyncio.sleep(retry_delay_seconds)

        raise ProviderError(
            f"Unable to connect to Kokoro engine after {max_attempts} attempts: {last_error}",
            self.id,
        )

    async def shutdown(self):
        await self.client.aclose()
        self._initialized = False

    async def health(self) -> dict[str, Any]:
        try:
            response = await self.client.get("/v1/health")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            return {
                "status": "offline",
                "error": str(e),
            }

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id="kokoro-82M",
                name="Kokoro 82M",
                version="1.0.0",
                size=165000000,
                languages=["en"],
                capabilities=["tts"],
                download_url="https://huggingface.co/hexgrad/Kokoro-82M",
            ),
        ]

    async def list_voices(self) -> list[VoiceInfo]:
        return [
            VoiceInfo(id="af_bella", name="Bella", language="en", gender="female", description="Warm female voice", sample_rate=24000, is_default=True),
            VoiceInfo(id="am_adam", name="Adam", language="en", gender="male", description="Clear male voice", sample_rate=24000),
            VoiceInfo(id="af_nicole", name="Nicole", language="en", gender="female", description="American female voice", sample_rate=24000),
            VoiceInfo(id="af_sarah", name="Sarah", language="en", gender="female", description="American female voice", sample_rate=24000),
            VoiceInfo(id="af_sky", name="Sky", language="en", gender="female", description="American female voice", sample_rate=24000),
            VoiceInfo(id="bf_isabella", name="Isabella", language="en", gender="female", description="British female voice", sample_rate=24000),
            VoiceInfo(id="bm_george", name="George", language="en", gender="male", description="British male voice", sample_rate=24000),
        ]

    async def load_model(self, model_id: str) -> None:
        # The engine keeps its single pipeline resident from process
        # start; there is no per-model-id load/swap concept to forward
        # over HTTP. This only updates this provider's own bookkeeping.
        self._loaded_model = model_id or DEFAULT_MODEL

    async def unload_model(self) -> None:
        self._loaded_model = None

    async def synthesize(self, request: TTSRequest) -> TTSResponse:
        self._ensure_initialized()

        voice_id = request.voice_id or "af_bella"

        clean_text = _normalize_text_for_tts(request.text)

        payload = {
            "text": clean_text,
            "voice_id": voice_id,
        }

        try:
            logger.info(
                "Kokoro request (%d chars, voice=%s)",
                len(clean_text),
                voice_id,
            )

            response = await self.client.post("/v1/tts", json=payload)
            response.raise_for_status()
            wav_data = response.content

        except httpx.HTTPStatusError as e:
            raise ProviderError(
                f"Kokoro returned HTTP {e.response.status_code}: {e.response.text}",
                self.id,
            )
        except Exception as e:
            raise ProviderError(f"Kokoro request failed: {e}", self.id)

        try:
            with wave.open(io.BytesIO(wav_data), "rb") as wav:
                sample_rate = wav.getframerate()
                frames = wav.getnframes()
                duration = frames / float(sample_rate)
        except Exception:
            sample_rate = 24000
            duration = 0.0

        return TTSResponse(
            audio_data=wav_data,
            format="wav",
            sample_rate=sample_rate,
            duration=duration,
            model_id=self._loaded_model or DEFAULT_MODEL,
            voice_id=voice_id,
        )

    async def transcribe(self, request: STTRequest) -> STTResponse:
        raise ProviderError("Kokoro does not support STT", self.id)

    async def benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        with Timer() as timer:
            await self.synthesize(TTSRequest(text=config.text or "Hello world"))
        return BenchmarkResult(
            latency_ms=timer.elapsed_ms,
            load_time_ms=0.0,
            inference_speed=1.0,
            rtf=timer.elapsed / (len(config.text or "Hello") * 0.1),
            memory_usage_mb=0.0,
        )