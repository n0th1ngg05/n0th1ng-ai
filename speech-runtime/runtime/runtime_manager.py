"""Central runtime manager."""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from providers.registry import ProviderRegistry
from models.manager import ModelManager
from voices.profiles import ProfileManager
from inference.tts import TTSInference
from inference.stt import STTInference
from inference.voice_chat import VoiceChatInference

from runtime.health import HealthMonitor
from runtime.benchmark import BenchmarkRunner
from runtime.events import event_bus, Event
from runtime.logger import get_logger
from runtime.config import RuntimeConfig
from runtime.provider_loader import ProviderLoader
from runtime.request_handler import RequestHandler
from runtime.engine_manager import EngineManager
from runtime.voice_library import VoiceLibrary
from runtime.registration import RegistrationManager

logger = get_logger("runtime_manager")


class RuntimeManager:
    """Orchestrates all runtime components."""

    def __init__(self, config: Optional[RuntimeConfig] = None):

        self.config = config or RuntimeConfig()

        #
        # Engine Manager
        #
        self.engine_manager = EngineManager(self.config)

        #
        # Registries
        #
        self.provider_registry = ProviderRegistry(
            search_paths=self.config.provider_paths,
            runtime = self,
        )

        self.model_manager = ModelManager()

        self.profile_manager = ProfileManager()

        #
        # Inference
        #
        self.tts_inference = TTSInference(
            self.provider_registry,
            self.model_manager,
            self.profile_manager,
        )

        self.stt_inference = STTInference(
            self.provider_registry,
            self.model_manager,
        )

        self.voice_chat = VoiceChatInference(
            self.tts_inference,
            self.stt_inference,
        )

        #
        # Runtime Services
        #
        self.health_monitor = HealthMonitor()

        self.benchmark_runner = BenchmarkRunner(
            warmup=self.config.inference.batch_size,
            iterations=10,
        )

        #
        # Provider Loader
        #
        self.provider_loader = ProviderLoader(
            self.provider_registry,
        )
        self.voice_library = VoiceLibrary()

        self.request_handler = RequestHandler(self)

        #
        # Registration / heartbeat manager (for remote engines).
        #
        self.registration_manager = RegistrationManager(self)

    async def initialize(self) -> None:
        """Initialize the runtime.

        The runtime starts immediately and becomes healthy without waiting
        for any external engine.  Remote engines (FishSpeech, Chatterbox, …)
        are launched as fire-and-forget subprocesses; they will call
        ``POST /register`` on this runtime once they are ready.

        In-process providers (Kokoro, Piper, Whisper, …) are still
        auto-registered here so they are available right away.
        """

        logger.info("Initializing runtime manager")

        #
        # Launch remote engine subprocesses — fire and forget.
        # We no longer wait for their health endpoints here; they will
        # self-register via POST /register when they are ready.
        #
        remote_ids: set[str] = set(self.config.engine.ports.keys())

        if self.config.engine.auto_start:
            for provider in remote_ids:
                try:
                    logger.info("Launching %s engine (fire-and-forget)...", provider)
                    self.engine_manager.start(provider)
                except Exception as e:
                    logger.warning(
                        "Unable to launch %s engine: %s",
                        provider,
                        e,
                    )

        #
        # Auto-register in-process providers only.
        # Remote engine providers are skipped here; they arrive via
        # POST /register once their subprocess is ready.
        #
        await self.provider_loader.load_inprocess(skip_ids=remote_ids)

        #
        # Initialize voice profiles.
        #
        await self.profile_manager.initialize()

        #
        # Start heartbeat watchdog for remote providers.
        #
        self.registration_manager.start()

        #
        # Runtime ready.
        #
        await event_bus.emit(
            Event(
                "runtime_started",
                {},
            )
        )

        logger.info("Runtime manager initialized — waiting for engine registrations")

    async def shutdown(self) -> None:
        """Shutdown the runtime."""

        logger.info("Shutting down runtime manager")

        #
        # Stop heartbeat watchdog first.
        #
        self.registration_manager.stop()

        #
        # Shutdown providers.
        #
        await self.provider_registry.shutdown_all()

        #
        # Stop speech engines.
        #
        for provider in self.config.engine.ports.keys():

            try:
                self.engine_manager.stop(provider)
            except Exception:
                pass

        #
        # Shutdown model manager.
        #
        await self.model_manager.shutdown()

        #
        # Emit event.
        #
        await event_bus.emit(
            Event(
                "runtime_stopped",
                {},
            )
        )

        logger.info("Runtime manager shutdown complete")

    # ------------------------------------------------------------------
    # Remote-engine registration (called from POST /register)
    # ------------------------------------------------------------------

    async def register_provider(self, provider_id: str, url: str, port: int) -> dict:
        """Instantiate and register a remote provider that has just become ready.

        Called by the ``POST /register`` route when an engine subprocess
        announces itself.  If the provider is already registered (e.g. a
        restart race) the call is a no-op.
        """
        # Idempotent: already registered?
        if self.provider_registry.get(provider_id) is not None:
            logger.info("Provider '%s' is already registered — ignoring duplicate", provider_id)
            return {"status": "already_registered", "provider_id": provider_id}

        # Look up the provider class from the pre-discovered index.
        cls = self.provider_loader.get_class(provider_id)
        if cls is None:
            raise ValueError(
                f"Unknown provider '{provider_id}'. "
                "Ensure a matching provider module exists in the providers/ directory."
            )

        logger.info("Registering remote provider '%s' (url=%s, port=%d)", provider_id, url or "default", port)
        provider = await self.provider_registry.register(cls)

        # Start tracking heartbeats for this provider.
        self.registration_manager.record_heartbeat(provider_id)

        await event_bus.emit(
            Event(
                "provider_registered",
                {"provider_id": provider_id, "url": url, "port": port},
            )
        )

        logger.info("Provider '%s' successfully registered", provider_id)
        return {"status": "registered", "provider_id": provider_id}

    # ------------------------------------------------------------------
    # Heartbeat (called from POST /heartbeat)
    # ------------------------------------------------------------------

    async def handle_heartbeat(self, provider_id: str) -> dict:
        """Refresh the heartbeat timestamp for a registered remote provider."""
        if self.provider_registry.get(provider_id) is None:
            # Engine thinks it's registered but we don't know it — re-register.
            return {"status": "unknown", "provider_id": provider_id}

        self.registration_manager.record_heartbeat(provider_id)
        return {"status": "ok", "provider_id": provider_id}

    async def get_health(self) -> dict:
        """Get runtime health report."""

        provider_health = []

        for provider in self.provider_registry.list_all():

            try:

                health = await provider.health()

                provider_health.append(
                    {
                        "provider_id": provider.id,
                        **health,
                    }
                )

            except Exception as e:

                provider_health.append(
                    {
                        "provider_id": provider.id,
                        "status": "unhealthy",
                        "error": str(e),
                    }
                )

        return self.health_monitor.get_report(
            providers=provider_health,
        ).to_dict()