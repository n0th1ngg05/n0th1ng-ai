"""Chatterbox TTS provider — HTTP client only.

This provider never imports ChatterboxTTS, never touches CUDA, and never
loads a model in-process. All inference happens in the separate Chatterbox
engine subprocess (engines/chatterbox/, spawned by runtime/engine_manager.py
via launcher.py) which exposes an HTTP API on 127.0.0.1:<port>. This
provider is purely responsible for translating between the runtime's
provider interface (BaseProvider/TTSRequest/TTSResponse) and that engine's
HTTP contract — mirroring providers/fishspeech.py's architecture exactly,
since from the runtime's perspective Chatterbox must behave identically to
FishSpeech.
"""
from __future__ import annotations

import asyncio
import io
import wave
from typing import Any

import httpx
import ormsgpack

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

logger = get_logger("chatterbox_provider")

DEFAULT_MODEL = "chatterbox-tts"

# Voice-id presets applied when no explicit reference dataset is used —
# these mirror the tuned exaggeration/cfg_weight pairs from the previous
# in-process provider, kept here so existing voice profiles referencing
# these voice_ids ("expressive", "calm", "narrator", ...) keep behaving
# the same now that synthesis has moved behind HTTP.
VOICE_PRESETS = {
    "default":        {"exaggeration": 0.5, "cfg_weight": 0.5},
    "expressive":     {"exaggeration": 0.8, "cfg_weight": 0.6},
    "calm":           {"exaggeration": 0.2, "cfg_weight": 0.4},
    "narrator":       {"exaggeration": 0.4, "cfg_weight": 0.7},
    "cloned_default": {"exaggeration": 0.5, "cfg_weight": 0.5},
}


class ChatterboxProvider(BaseProvider):
    """Chatterbox TTS provider — communicates with the Chatterbox engine
    exclusively over HTTP, exactly like FishSpeechProvider does."""

    def __init__(self):

        super().__init__()

        self.client = httpx.AsyncClient(
            base_url="http://127.0.0.1:6102",
            timeout=httpx.Timeout(
                connect=10.0,
                read=300.0,
                write=300.0,
                pool=300.0,
            ),
        )

    @property
    def id(self) -> str:
        return "chatterbox"

    @property
    def manifest(self) -> ProviderManifest:

        return ProviderManifest(
            id="chatterbox",
            name="Chatterbox",
            type="tts",
            version="1.0.0",
            description="Chatterbox HTTP Engine — expressive zero-shot TTS by Resemble AI",
            author="Resemble AI",
            license="MIT",
            supported_languages=["en"],
            capabilities=[
                "tts",
                "voice-cloning",
                "emotion",
                "streaming",
            ],
            supports_tts=True,
            supports_streaming=True,
            supports_voice_cloning=True,
            supports_gpu=True,
            supports_cpu=True,
        )

    async def initialize(self):

        logger.info("Initializing Chatterbox provider")

        # Mirrors FishSpeechProvider.initialize(): EngineManager.start()
        # already polls /v1/health for up to 30s before RuntimeManager
        # moves on, but that result is discarded, so if the Chatterbox
        # engine subprocess is still loading the model (warmup included)
        # past that window, this provider needs to keep retrying on its
        # own rather than fail permanently and drop out of the registry.
        max_attempts = 12
        retry_delay_seconds = 5.0  # 12 * 5s = up to 60s additional wait

        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):

            try:

                response = await self.client.get("/v1/health")

                response.raise_for_status()

                self._initialized = True

                logger.info(
                    "Connected to Chatterbox engine (attempt %d/%d)",
                    attempt,
                    max_attempts,
                )

                return

            except Exception as e:

                last_error = e

                if attempt < max_attempts:

                    logger.warning(
                        "Chatterbox engine not ready yet (attempt %d/%d): %s — retrying in %.0fs",
                        attempt,
                        max_attempts,
                        e,
                        retry_delay_seconds,
                    )

                    await asyncio.sleep(retry_delay_seconds)

        raise ProviderError(
            f"Unable to connect to Chatterbox engine after {max_attempts} attempts: {last_error}",
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

        try:

            response = await self.client.get("/v1/models")

            response.raise_for_status()

            data = response.json()

            return [
                ModelInfo(
                    id=m["id"],
                    name=m["name"],
                    version=m["version"],
                    size=0,
                    languages=["en"],
                    capabilities=["tts", "voice-cloning"],
                    installed=True,
                    loaded=m["loaded"],
                )
                for m in data.get("models", [])
            ]

        except Exception as e:

            logger.warning("Failed to fetch Chatterbox models: %s", e)

            # Fall back to a static descriptor so /models keeps working
            # (e.g. for UI listing) even if the engine is momentarily
            # unreachable — mirrors FishSpeechProvider always returning a
            # static single-model list rather than depending on the
            # engine being up.
            return [
                ModelInfo(
                    id=DEFAULT_MODEL,
                    name="Chatterbox TTS",
                    version="1.0.0",
                    size=0,
                    languages=["en"],
                    capabilities=["tts", "voice-cloning"],
                    installed=True,
                    loaded=False,
                )
            ]

    async def list_voices(self) -> list[VoiceInfo]:

        voices: list[VoiceInfo] = []

        try:

            response = await self.client.get("/v1/voices")

            response.raise_for_status()

            data = response.json()

            for v in data.get("voices", []):

                voices.append(
                    VoiceInfo(
                        id=v["id"],
                        name=v["name"],
                        language=v.get("language", "en"),
                        gender="neutral",
                        description=v.get("description", ""),
                        sample_rate=v.get("sample_rate", 24000),
                        is_default=v.get("is_default", False),
                    )
                )

        except Exception as e:

            logger.warning("Failed to fetch Chatterbox voices: %s", e)

            voices.append(
                VoiceInfo(
                    id="default",
                    name="Default",
                    language="en",
                    gender="neutral",
                    description="Default Chatterbox voice",
                    sample_rate=24000,
                    is_default=True,
                )
            )

        # Append cloned voices from the shared runtime VoiceLibrary, same
        # as FishSpeechProvider does — these are datasets under
        # voices/datasets/ managed centrally by the runtime, distinct from
        # the engine's own local voices/ folder used for engine-native
        # presets.
        if (
            self.runtime is not None
            and hasattr(self.runtime, "voice_library")
        ):

            for dataset in self.runtime.voice_library.list():

                voices.append(
                    VoiceInfo(
                        id=dataset["id"],
                        name=dataset["name"],
                        language=dataset.get("language", "en"),
                        gender="unknown",
                        description="Reference Voice",
                        sample_rate=24000,
                        is_default=False,
                    )
                )

        return voices

    async def load_model(self, model_id: str) -> None:

        # The engine keeps a single model resident and loaded from
        # process start (ModelManager.load_model() runs once at
        # startup); there is no per-model-id load/swap concept to
        # forward over HTTP here. This only updates the provider's own
        # bookkeeping of which model_id the caller asked for, matching
        # FishSpeechProvider's load_model().
        self._loaded_model = model_id or DEFAULT_MODEL

    async def unload_model(self) -> None:

        try:

            response = await self.client.post("/v1/model/unload")

            response.raise_for_status()

        except Exception as e:

            logger.warning("Failed to unload Chatterbox model: %s", e)

        self._loaded_model = None

    async def synthesize(
        self,
        request: TTSRequest,
    ) -> TTSResponse:

        self._ensure_initialized()

        voice_id = request.voice_id or "default"

        preset = VOICE_PRESETS.get(voice_id, VOICE_PRESETS["default"])

        audio_prompt: bytes | None = None

        # A reference_id (shared runtime VoiceLibrary dataset) takes
        # priority over the built-in Chatterbox voice presets.
        if (
            request.reference_id
            and self.runtime is not None
            and hasattr(self.runtime, "voice_library")
        ):

            dataset = self.runtime.voice_library.get(
                request.reference_id
            )

            if dataset:

                audio_prompt = dataset.get(
                    "reference_audio"
                )

        # Callers commonly pass a cloned-voice dataset name via voice_id
        # rather than the separate reference_id field (reference_id is
        # never populated automatically from voice_id upstream in
        # inference/tts.py). If voice_id isn't one of our own presets,
        # check whether it matches a dataset in the shared runtime
        # VoiceLibrary before giving up and falling back to "default" —
        # this is what makes e.g. voice_id="kerry_condon" actually
        # resolve to the cloned dataset instead of silently falling back.
        if (
            audio_prompt is None
            and voice_id not in VOICE_PRESETS
            and self.runtime is not None
            and hasattr(self.runtime, "voice_library")
        ):

            dataset = self.runtime.voice_library.get(voice_id)

            if dataset:

                audio_prompt = dataset.get("reference_audio")

        payload = {
            "text": request.text,
            "model_id": request.model_id or DEFAULT_MODEL,
            "temperature": request.temperature,
            "exaggeration": preset["exaggeration"],
            "cfg_weight": preset["cfg_weight"],
            "voice_id": voice_id if audio_prompt is None else None,
            "audio_prompt": audio_prompt,
            "streaming": False,
            "format": "wav",
        }

        try:

            logger.info(
                "Chatterbox {} request ({} chars, voice={})", request.model_id or DEFAULT_MODEL, len(request.text), voice_id,
            )

            response = await self.client.post(
                "/v1/tts",
                content=ormsgpack.packb(payload),
                headers={
                    "Content-Type": "application/msgpack"
                },
            )

            response.raise_for_status()

            wav_data = response.content

        except httpx.HTTPStatusError as e:

            raise ProviderError(
                f"Chatterbox returned HTTP {e.response.status_code}: {e.response.text}",
                self.id,
            )

        except Exception as e:

            raise ProviderError(
                f"Chatterbox request failed: {e}",
                self.id,
            )

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
            model_id=request.model_id or DEFAULT_MODEL,
            voice_id=voice_id,
        )

    async def transcribe(
        self,
        request: STTRequest,
    ) -> STTResponse:

        raise ProviderError("Chatterbox does not support STT.", self.id)

    async def benchmark(
        self,
        config: BenchmarkConfig,
    ) -> BenchmarkResult:

        payload = {
            "text": config.text or "Hello world.",
            "iterations": config.iterations,
            "warmup": config.warmup,
            "voice_id": config.voice_id,
        }

        try:

            response = await self.client.post(
                "/v1/benchmark",
                content=ormsgpack.packb(payload),
                headers={
                    "Content-Type": "application/msgpack"
                },
            )

            response.raise_for_status()

            data = response.json()

            return BenchmarkResult(
                latency_ms=data["avg_inference_ms"],
                load_time_ms=data["load_time_ms"],
                inference_speed=data["inference_speed"],
                rtf=data["avg_rtf"],
                memory_usage_mb=data["gpu_memory_allocated_mb"],
            )

        except Exception as e:

            logger.warning(
                "Chatterbox engine benchmark endpoint failed (%s), falling back to client-side timing.",
                e,
            )

            # Fall back to timing a single synthesize() call end-to-end
            # (including HTTP round-trip) rather than failing outright —
            # still useful signal even if the engine's own /v1/benchmark
            # is unreachable.
            with Timer() as timer:

                await self.synthesize(
                    TTSRequest(text=config.text or "Hello world.")
                )

            return BenchmarkResult(
                latency_ms=timer.elapsed_ms,
                load_time_ms=0.0,
                inference_speed=1.0,
                rtf=1.0,
                memory_usage_mb=0.0,
            )