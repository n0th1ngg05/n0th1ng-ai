from __future__ import annotations

import asyncio
import time
from pathlib import Path

from chatterbox.tts import ChatterboxTTS
from chatterbox.tts_turbo import ChatterboxTurboTTS
from loguru import logger

from chatterbox_engine.utils import gpu_cleanup, resolve_device
from chatterbox_engine.voice_library import VoiceLibrary


class ModelManager:
    """Owns the resident ChatterboxTTS model instance.

    The model is loaded exactly once at startup and kept resident for the
    lifetime of the process — synthesis and streaming requests read
    `self.model` directly rather than triggering a load. Reload/unload are
    explicit operations invoked only via their own methods (and the
    corresponding routes), never implicitly from the inference path, so a
    request can never accidentally trigger a multi-second model load.

    A lock serializes load/unload/reload against each other so concurrent
    admin calls can't leave the model in a half-swapped state; ordinary
    inference calls don't take this lock and are unaffected by it.
    """

    def __init__(
        self,
        device: str,
        model_path: str,
    ):

        self.requested_device = device

        self.device = resolve_device(device)

        self.model_path = Path(model_path)

        self.model: ChatterboxTTS | ChatterboxTurboTTS | None = None

        self.model_id: str | None = None

        self.last_load_time_ms: float = 0.0

        self._lock = asyncio.Lock()

        engine_root = Path(__file__).resolve().parent.parent.parent

        self.voice_library = VoiceLibrary(
            voices_root=engine_root / "voices",
        )

        self.load_model("chatterbox-tts")

    def load_model(
        self,
        model_id: str,
    ) -> None:
        """
    Load the requested Chatterbox model synchronously.

    Called once at startup from the app's on_startup hook (which runs
    before the server accepts requests), so this blocking call doesn't
    stall any in-flight request.
    """

        logger.info(
            "Loading Chatterbox model '{}' on device '{}'...",
            model_id,
            self.device,
        )

        start = time.perf_counter()

        self.model = None

        if self.device.startswith("cuda"):
            import torch

            torch.cuda.empty_cache()

        if model_id == "chatterbox-tts":

            if self.model_path.exists() and any(self.model_path.iterdir()):

                logger.info(
                    "Found local TTS model files at {}, loading via from_local().",
                    self.model_path,
                )

                self.model = ChatterboxTTS.from_local(
                    self.model_path,
                    device=self.device,
                )

            else:

                logger.info(
                    "No local TTS model files at {}, loading via from_pretrained()(HuggingFace download if needed).",
                    self.model_path,
                )

                self.model = ChatterboxTTS.from_pretrained(
                    device=self.device,
                )

        elif model_id == "chatterbox-turbo":

            logger.info(
                "Loading Chatterbox Turbo model..."
            )

            self.model = ChatterboxTurboTTS.from_pretrained(
                device=self.device,
            )

        else:

            raise ValueError(
                f"Unknown Chatterbox model '{model_id}'"
            )

        self.model_id = model_id

        self.last_load_time_ms = (
            time.perf_counter() - start
        ) * 1000

        logger.info(
            "Chatterbox model '{}' loaded in {:.1f}ms on '{}'.",
            model_id,
            self.last_load_time_ms,
            self.device,
        )

        self.warm_up()

    def warm_up(self) -> None:
        """Run a single throwaway generation so the first real request
        doesn't pay for lazy kernel compilation / CUDA context setup."""

        logger.info("Running warmup generation...")

        start = time.perf_counter()

        _ = self.model.generate("Hello world.")

        logger.info(
            "Warmup complete in {:.1f}ms.",
            (time.perf_counter() - start) * 1000,
        )

    async def reload(self) -> None:
        """Unload then load again — e.g. after swapping model files on
        disk. Serialized against unload() via the lock so a request
        arriving mid-swap can't observe a torn state."""

        async with self._lock:

            self._unload_locked()

            self.load_model(self.model_id or "chatterbox-tts")

    async def unload(self) -> None:
        """Release the model and free GPU memory. The engine process
        stays alive (so /health still responds) but model is None until
        reload() or load_model() is called again."""

        async with self._lock:

            self._unload_locked()

    def _unload_locked(self) -> None:

        if self.model is not None:

            logger.info("Unloading Chatterbox model and releasing GPU memory.")

            self.model = None

            gpu_cleanup()

        else:

            logger.info("Unload requested but no model was loaded.")
