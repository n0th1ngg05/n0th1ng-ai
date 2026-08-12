"""Benchmark API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


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


async def get_benchmarks(request: Request):
    """Get benchmark history."""
    history = await request.app.state.runtime_manager.benchmark_runner.get_benchmark_history()
    return JSONResponse(content={"benchmarks": history})
