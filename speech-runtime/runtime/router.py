"""FastAPI route setup."""
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from runtime.logger import get_logger
from runtime.exceptions import SpeechRuntimeError
from runtime.registration import ProviderRegistration, HeartbeatPayload

logger = get_logger("router")


def setup_routes(app: FastAPI) -> None:
    """Configure all API routes."""

    @app.get("/health")
    async def health(request: Request):
        """Get runtime health status.

        Returns immediately — the runtime is healthy as soon as it is up,
        regardless of how many (or how few) providers are registered.
        Provider-level health is reported in the payload for observability
        but does NOT affect the top-level status.
        """
        report = await request.app.state.runtime_manager.get_health()
        return JSONResponse(content=report)

    @app.get("/providers")
    async def list_providers(request: Request):
        """List all registered providers."""
        providers = request.app.state.runtime_manager.provider_registry.list_all()
        return JSONResponse(content={
            "providers": [
                {
                    "id": p.id,
                    "name": p.manifest.name,
                    "type": p.manifest.type,
                    "version": p.manifest.version,
                    "initialized": p.is_initialized,
                }
                for p in providers
            ]
        })

    @app.get("/models")
    async def list_models(request: Request):
        """List all available models."""
        models = await request.app.state.runtime_manager.model_manager.list_models()
        return JSONResponse(content={"models": models})

    @app.get("/voices")
    async def list_voices(request: Request):
        """List all available voices.

        Field names and modelId are shaped to match what the Node speech
        layer (providerManager.listVoices() -> fetchWorkerVoices) expects:
        camelCase keys, and a real modelId per voice. VoiceInfo itself
        carries no model_id (voices aren't tracked per-model here), so we
        look up the provider's model list and attach its id.

        Providers that expose more than one model (e.g. Chatterbox:
        chatterbox-tts + chatterbox-turbo) share a single pool of cloned
        reference voices (runtime.voice_library) across all of their
        models — that pool isn't tied to any one model_id. Stamping every
        voice with only models[0].id silently dropped those shared voices
        (e.g. "kerry_condon") from every model but the first one in the
        dropdown. So instead we fan each voice out across every model the
        provider reports, emitting one entry per (voice, model) pair —
        matching the shape the Node side already expects (it filters
        voices by modelId per dropdown selection, so each model needs its
        own copy of the shared voices). Providers with exactly one model
        keep behaving exactly as before (single entry per voice).
        """
        all_voices = []
        for provider in request.app.state.runtime_manager.provider_registry.list_all():
            models = await provider.list_models()
            model_ids = [m.id for m in models] if models else [None]

            voices = await provider.list_voices()
            for v in voices:
                for model_id in model_ids:
                    all_voices.append({
                        "id": v.id,
                        "modelId": model_id,
                        "providerId": provider.id,
                        "name": v.name,
                        "language": v.language,
                        "gender": v.gender,
                        "description": getattr(v, "description", ""),
                        "sampleRate": getattr(v, "sample_rate", 0),
                        "isDefault": getattr(v, "is_default", False),
                    })
        return JSONResponse(content={"voices": all_voices})

    @app.get("/profiles")
    async def list_profiles(request: Request):
        """List all voice profiles."""
        profiles = await request.app.state.runtime_manager.profile_manager.list_profiles()
        return JSONResponse(content={"profiles": [p.to_dict() for p in profiles]})

    @app.post("/tts")
    async def tts(request: Request):
        """Text-to-speech synthesis."""
        body = await request.json()
        handler = request.app.state.runtime_manager.request_handler
        result = await handler.handle_tts(body)
        if not result.get("success"):
            return JSONResponse(content=result, status_code=400)
        return JSONResponse(content=result)

    @app.post("/stt")
    async def stt(request: Request):
        """Speech-to-text transcription."""
        body = await request.json()
        handler = request.app.state.runtime_manager.request_handler
        result = await handler.handle_stt(body)
        if not result.get("success"):
            return JSONResponse(content=result, status_code=400)
        return JSONResponse(content=result)

    @app.post("/voice-chat")
    async def voice_chat(request: Request):
        """Voice chat (STT + TTS)."""
        body = await request.json()
        handler = request.app.state.runtime_manager.request_handler
        result = await handler.handle_voice_chat(body)
        if not result.get("success"):
            return JSONResponse(content=result, status_code=400)
        return JSONResponse(content=result)

    @app.post("/download")
    async def download(request: Request):
        """Start model download."""
        body = await request.json()
        task = await request.app.state.runtime_manager.model_manager.downloader.download(
            task_id=body.get("task_id"),
            model_id=body.get("model_id"),
            provider_id=body.get("provider_id"),
            url=body.get("url"),
            total_bytes=body.get("total_bytes", 0),
            checksum=body.get("checksum", ""),
            checksum_algorithm=body.get("checksum_algorithm", "sha256"),
        )
        return JSONResponse(content={"task_id": task.id, "status": task.status})

    @app.delete("/model/{model_id}")
    async def delete_model(model_id: str, request: Request):
        """Delete a model."""
        await request.app.state.runtime_manager.model_manager.delete_model(model_id)
        return JSONResponse(content={"success": True})

    @app.get("/benchmark")
    async def get_benchmarks(request: Request):
        """Get benchmark history."""
        history = await request.app.state.runtime_manager.benchmark_runner.get_benchmark_history()
        return JSONResponse(content={"benchmarks": history})

    @app.post("/benchmark")
    async def run_benchmark(request: Request):
        """Run a benchmark."""
        body = await request.json()
        from providers.base import BenchmarkConfig
        config = BenchmarkConfig(
            model_id=body.get("model_id"),
            voice_id=body.get("voice_id"),
            iterations=body.get("iterations", 10),
            warmup=body.get("warmup", 2),
            text=body.get("text"),
            test_type=body.get("test_type", "tts"),
        )
        provider = request.app.state.runtime_manager.provider_registry.get(body.get("provider_id"))
        if not provider:
            return JSONResponse(content={"error": "Provider not found"}, status_code=404)
        result = await provider.benchmark(config)
        return JSONResponse(content={
            "latency_ms": result.latency_ms,
            "load_time_ms": result.load_time_ms,
            "inference_speed": result.inference_speed,
            "rtf": result.rtf,
            "memory_usage_mb": result.memory_usage_mb,
        })

    @app.get("/events")
    async def get_events(request: Request):
        """Get recent events."""
        from runtime.events import event_bus
        events = event_bus.get_history()
        return JSONResponse(content={
            "events": [
                {
                    "type": e.type,
                    "payload": e.payload,
                    "timestamp": e.timestamp.isoformat(),
                }
                for e in events[-100:]
            ]
        })

    @app.get("/logs")
    async def get_logs(request: Request):
        """Get recent logs."""
        from runtime.logger import get_logger
        logger = get_logger("runtime")
        return JSONResponse(content={"logs": "See logs directory"})

    @app.get("/downloads")
    async def list_downloads(request: Request):
        """List active downloads."""
        downloads = request.app.state.runtime_manager.model_manager.downloader.list_active()
        return JSONResponse(content={
            "downloads": [
                {
                    "id": d.id,
                    "model_id": d.model_id,
                    "status": d.status,
                    "progress": d.downloaded_bytes / d.total_bytes if d.total_bytes > 0 else 0,
                }
                for d in downloads
            ]
        })

    # ------------------------------------------------------------------
    # Engine self-registration
    # ------------------------------------------------------------------

    @app.post("/register")
    async def register_engine(payload: ProviderRegistration, request: Request):
        """Register a remote engine that has finished loading and is ready.

        Called by engine launchers (FishSpeech, Chatterbox, …) once their
        server is up and their models are loaded.  The runtime will
        instantiate and initialise the matching provider class, then add it
        to the registry so voices/models become available immediately.

        Expected payload::

            {"provider_id": "fishspeech", "port": 6101}

        Optional fields: ``url`` (full base-URL override), ``metadata``.
        """
        try:
            url = payload.url or f"http://127.0.0.1:{payload.port}"
            result = await request.app.state.runtime_manager.register_provider(
                provider_id=payload.provider_id,
                url=url,
                port=payload.port,
            )
            return JSONResponse(content=result)
        except ValueError as exc:
            return JSONResponse(content={"error": str(exc)}, status_code=404)
        except Exception as exc:
            logger.error("Error registering provider '%s': %s", payload.provider_id, exc)
            return JSONResponse(
                content={"error": f"Registration failed: {exc}"},
                status_code=500,
            )

    @app.post("/heartbeat")
    async def engine_heartbeat(payload: HeartbeatPayload, request: Request):
        """Receive a periodic heartbeat from a registered remote engine.

        Engines should POST here every ~20-30 seconds.  If the runtime
        stops receiving heartbeats for 60 seconds it will evict the provider
        from the registry.

        Expected payload::

            {"provider_id": "fishspeech"}
        """
        result = await request.app.state.runtime_manager.handle_heartbeat(
            provider_id=payload.provider_id,
        )
        # If the runtime doesn't recognise this provider (e.g. after a
        # runtime restart), tell the engine to re-register.
        if result.get("status") == "unknown":
            return JSONResponse(content=result, status_code=404)
        return JSONResponse(content=result)

    @app.exception_handler(SpeechRuntimeError)
    async def speech_runtime_exception_handler(request: Request, exc: SpeechRuntimeError):
        """Handle speech runtime errors."""
        return JSONResponse(
            status_code=400,
            content={"error": exc.message, "code": exc.code},
        )