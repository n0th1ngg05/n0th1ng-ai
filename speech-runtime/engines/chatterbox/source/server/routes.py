import asyncio

from kui.asgi import (
    Body,
    HTTPException,
    JSONResponse,
    Routes,
    StreamResponse,
    request,
)
from loguru import logger

from chatterbox_engine.benchmark import run_benchmark
from chatterbox_engine.health import HealthTracker
from chatterbox_engine.schema import (
    ServeBenchmarkRequest,
    ServeBenchmarkResponse,
    ServeModelInfo,
    ServeModelsResponse,
    ServeTTSRequest,
    ServeVoiceInfo,
    ServeVoicesResponse,
)
from chatterbox_engine.streaming import stream_synthesis
from server.inference import synthesize


async def _single_chunk(data: bytes):
    """Wrap a single bytes payload as an async iterable.

    kui/baize's StreamResponse always iterates its payload with
    `async for`, so even a non-streaming response (a single complete WAV)
    must be handed an async iterable rather than a plain `iter([...])`.
    """
    yield data


routes = Routes()

_health_tracker = HealthTracker()


def _model_manager():
    return request.app.state.model_manager


@routes.http.get("/v1/health")
async def health():

    report = _health_tracker.report(_model_manager())

    return JSONResponse(report.model_dump())


@routes.http.get("/v1/models")
async def models():

    manager = _model_manager()

    model = manager.model

    sample_rate = (
        getattr(model, "sr", 24000)
        if model is not None
        else 24000
    )

    return JSONResponse(
        ServeModelsResponse(
            models=[
                ServeModelInfo(
                    id="chatterbox-tts",
                    name="Chatterbox TTS",
                    version="1.0.0",
                    loaded=(
                        model is not None
                        and manager.model_id == "chatterbox-tts"
                    ),
                    device=manager.device,
                    sample_rate=sample_rate,
                ),
                ServeModelInfo(
                    id="chatterbox-turbo",
                    name="Chatterbox Turbo",
                    version="1.0.0",
                    loaded=(
                        model is not None
                        and manager.model_id == "chatterbox-turbo"
                    ),
                    device=manager.device,
                    sample_rate=sample_rate,
                ),
            ]
        ).model_dump()
    )


@routes.http.get("/v1/voices")
async def voices():

    manager = _model_manager()

    entries = manager.voice_library.list()

    return JSONResponse(
        ServeVoicesResponse(
            voices=[
                ServeVoiceInfo(
                    id=v.id,
                    name=v.name,
                    language=v.language,
                    description=v.description,
                    is_default=v.is_default,
                    is_cloned=v.is_cloned,
                    sample_rate=v.sample_rate,
                    source_path=str(v.audio_path) if v.audio_path else None,
                )
                for v in entries
            ]
        ).model_dump()
    )


@routes.http.post("/v1/tts")
async def tts(
    body: ServeTTSRequest = Body(exclusive=True),
):

    manager = _model_manager()

    if manager.model is None:

        raise HTTPException(
            503,
            content="Model is not loaded. Call POST /v1/model/reload.",
        )

    if body.streaming:

        async def chunk_iter():

            async for chunk in stream_synthesis(manager, body):
                yield chunk

        return StreamResponse(
            chunk_iter(),
            content_type="audio/wav",
        )

    try:

        # synthesize() runs blocking GPU inference; offloading to a thread
        # keeps the single-worker event loop free to answer /v1/health
        # (which EngineManager polls every 0.5s) and other requests while
        # generation is in flight.
        result = await asyncio.to_thread(synthesize, manager, body)

    except Exception as e:

        raise HTTPException(500, content=f"Synthesis failed: {e}")

    return StreamResponse(
        _single_chunk(result.audio),
        content_type="audio/wav",
        headers={
            "X-Sample-Rate": str(result.sample_rate),
            "X-Duration": str(result.duration),
        },
    )


@routes.http.post("/v1/benchmark")
async def benchmark(
    body: ServeBenchmarkRequest = Body(exclusive=True),
):

    manager = _model_manager()

    if manager.model is None:

        raise HTTPException(
            503,
            content="Model is not loaded. Call POST /v1/model/reload.",
        )

    try:

        result: ServeBenchmarkResponse = await asyncio.to_thread(
            run_benchmark, manager, body
        )

    except Exception as e:

        raise HTTPException(500, content=f"Benchmark failed: {e}")

    return JSONResponse(result.model_dump())


@routes.http.post("/v1/model/reload")
async def reload_model():

    manager = _model_manager()

    logger.info("Received request to reload model.")

    await manager.reload()

    return JSONResponse({"status": "reloaded", "device": manager.device})


@routes.http.post("/v1/model/unload")
async def unload_model():

    manager = _model_manager()

    logger.info("Received request to unload model.")

    await manager.unload()

    return JSONResponse({"status": "unloaded"})


@routes.http.post("/v1/voices/reload")
async def reload_voices():

    manager = _model_manager()

    manager.voice_library.reload()

    return JSONResponse(
        {
            "status": "reloaded",
            "voices": [v.id for v in manager.voice_library.list()],
        }
    )