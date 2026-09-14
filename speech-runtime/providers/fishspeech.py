from __future__ import annotations

import asyncio
import base64
import io
from typing import Any

import ormsgpack
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

logger = get_logger("fishspeech_provider")

DEFAULT_MODEL = "fishspeech-1.5"


class FishSpeechProvider(BaseProvider):

    def __init__(self):

        super().__init__()


        self.client = httpx.AsyncClient(
            base_url = "http://127.0.0.1:6101",
            timeout=httpx.Timeout(
                connect=10.0,
                read=300.0,
                write=300.0,
                pool=300.0,
            ),
        )
        

    @property
    def id(self) -> str:
        return "fishspeech"

    @property
    def manifest(self) -> ProviderManifest:

        return ProviderManifest(
            id="fishspeech",
            name="Fish Speech",
            type="tts",
            version="1.5.0",
            description="FishSpeech HTTP Engine",
            author="Fish Audio",
            license="MIT",
            supported_languages=[
                "en",
                "zh",
                "ja",
                "ko",
                "fr",
                "de",
                "ar",
                "es",
            ],
            capabilities=[
                "tts",
                "voice-cloning",
                "emotion",
            ],
            supports_tts=True,
            supports_gpu=True,
            supports_cpu=True,
        )

    async def initialize(self):

        logger.info("Initializing FishSpeech provider")

        # EngineManager.start() (runtime/engine_manager.py) already polls
        # the engine's /v1/health for up to 30s before returning, but its
        # return value is discarded by RuntimeManager.initialize() (it only
        # logs a warning on outright failure to spawn the process) — so if
        # the FishSpeech engine subprocess is still loading its model past
        # that 30s window (easily the case for a 1.5B-parameter model on a
        # cold GPU), this provider's initialize() used to run a single
        # health check immediately after, fail, raise, and get silently
        # dropped by ProviderRegistry.register()/initialize_all(). Nothing
        # ever retried it afterward, so the worker would run its entire
        # lifetime without FishSpeech in /voices — exactly the case where
        # the Node side's "worker before node server" ordering mattered.
        #
        # Retrying here (independently of EngineManager's own wait) means
        # this provider tolerates the engine still coming up, without
        # needing to change engine_manager.py's or runtime_manager.py's
        # startup sequencing.
        max_attempts = 12
        retry_delay_seconds = 5.0  # 12 * 5s = up to 60s additional wait

        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):

            try:

                response = await self.client.get("/v1/health")

                response.raise_for_status()

                self._initialized = True

                logger.info(
                    "Connected to FishSpeech engine (attempt %d/%d)",
                    attempt,
                    max_attempts,
                )

                return

            except Exception as e:

                last_error = e

                if attempt < max_attempts:

                    logger.warning(
                        "FishSpeech engine not ready yet (attempt %d/%d): %s — retrying in %.0fs",
                        attempt,
                        max_attempts,
                        e,
                        retry_delay_seconds,
                    )

                    await asyncio.sleep(retry_delay_seconds)

        raise ProviderError(
            f"Unable to connect to FishSpeech engine after {max_attempts} attempts: {last_error}",
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

    async def list_models(self):

        return [
            ModelInfo(
                id="fishspeech-1.5",
                name="Fish Speech 1.5",
                version="1.5.0",
                size=0,
                languages=[
                    "en",
                    "zh",
                    "ja",
                    "ko",
                    "fr",
                    "de",
                    "ar",
                    "es",
                ],
                capabilities=[
                    "tts",
                    "voice-cloning",
                ],
                installed=True,
                loaded=True,
            )
        ]

    async def list_voices(self):

        voices = [
            VoiceInfo(
                id="default",
                name="Default",
                language="en",
                gender="neutral",
                description="FishSpeech Default",
                sample_rate=44100,
                is_default=True,
            )
        ]

    #
    # Append cloned voices from VoiceLibrary
    #

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
                        sample_rate=44100,
                        is_default=False,
                    )

                )

        return voices

    async def load_model(self, model_id: str) -> None:

        self._loaded_model = model_id or DEFAULT_MODEL

    async def unload_model(self) -> None:

        self._loaded_model = None

    async def synthesize(
        self,
        request: TTSRequest,
    ) -> TTSResponse:

        self._ensure_initialized()

        #
# Build FishSpeech payload
#

        references = []

        if (
            self.runtime is not None
            and hasattr(self.runtime, "voice_library")
        ):
            voice = None
            if request.reference_id:
                voice = self.runtime.voice_library.get(request.reference_id)

            if voice:

                references = voice["references"]

        # 384 was a fixed, undersized budget copied from a short-text example.
        # For longer/multi-sentence requests, hitting this cap mid-generation
        # (while the semantic/acoustic dual-codebook streams are still
        # aligning) can leave the KV cache/position indexing inconsistent on
        # the next kernel launch — this manifests as a CUDA "illegal memory
        # access" / "misaligned address" crash, especially on GPUs without
        # forgiving bounds-checking (e.g. Pascal). Scale the budget with
        # input length instead, with a safe floor and ceiling.
        estimated_tokens = max(384, int(len(request.text) * 4))
        max_new_tokens = min(estimated_tokens, 2048)

        payload = {
            "text": request.text,
            "format": "wav",
            "streaming": False,
            "chunk_length": 200,
            "max_new_tokens": max_new_tokens,
            "top_p": 0.7,
            "repetition_penalty": 1.2,
            "temperature": request.temperature,
            "references": references,
            "reference_id": None,
        }

        try:

            logger.info(
                f"FishSpeech TTS request ({len(request.text)} chars)"
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
                f"FishSpeech returned HTTP {e.response.status_code}: {e.response.text}",
                self.id,
            )

        except Exception as e:

            raise ProviderError(
                f"FishSpeech request failed: {e}",
                self.id,
            )

        #
        # Calculate duration from WAV.
        #

        try:

            import wave

            with wave.open(io.BytesIO(wav_data), "rb") as wav:

                sample_rate = wav.getframerate()

                frames = wav.getnframes()

                duration = frames / float(sample_rate)

        except Exception:

            sample_rate = 44100

            duration = 0.0

        return TTSResponse(
            audio_data=wav_data,
            format="wav",
            sample_rate=sample_rate,
            duration=duration,
            model_id=self._loaded_model or DEFAULT_MODEL,
            voice_id=request.voice_id or "default",
        )

    async def transcribe(
        self,
        request: STTRequest,
    ) -> STTResponse:

        raise ProviderError(
            "FishSpeech does not support STT.",
            self.id,
        )

    async def benchmark(
        self,
        config: BenchmarkConfig,
    ) -> BenchmarkResult:

        with Timer() as timer:

            await self.synthesize(
                TTSRequest(
                    text=config.text or "Hello world."
                )
            )

        return BenchmarkResult(
            latency_ms=timer.elapsed_ms,
            load_time_ms=0.0,
            inference_speed=1.0,
            rtf=1.0,
            memory_usage_mb=0.0,
        )