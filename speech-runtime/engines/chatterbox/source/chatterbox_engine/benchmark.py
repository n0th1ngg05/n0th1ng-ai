from __future__ import annotations

import time

from loguru import logger

from chatterbox_engine.schema import ServeBenchmarkRequest, ServeBenchmarkResponse
from chatterbox_engine.utils import gpu_memory_stats


def run_benchmark(
    model_manager,
    request: ServeBenchmarkRequest,
) -> ServeBenchmarkResponse:
    """Run a warmup-then-measure benchmark against the resident model.

    Load time is taken from ModelManager's last recorded load duration
    rather than re-loading the model here — reloading on every benchmark
    call would defeat the "load once, stay resident" requirement and would
    make the reported load_time_ms meaningless (it would just measure
    cache-hit reload speed, not cold start).
    """

    model = model_manager.model

    if model is None:
        raise RuntimeError("Cannot benchmark: model is not loaded.")

    voice = model_manager.voice_library.get(request.voice_id)

    audio_prompt_path = str(voice.audio_path) if voice.audio_path else None

    logger.info(
        "Benchmark starting: {} warmup, {} measured iterations",
        request.warmup,
        request.iterations,
    )

    for _ in range(request.warmup):

        model.generate(
            request.text,
            exaggeration=voice.exaggeration,
            cfg_weight=voice.cfg_weight,
            audio_prompt_path=audio_prompt_path,
        )

    durations_ms: list[float] = []

    rtfs: list[float] = []

    for i in range(request.iterations):

        start = time.perf_counter()

        wav = model.generate(
            request.text,
            exaggeration=voice.exaggeration,
            cfg_weight=voice.cfg_weight,
            audio_prompt_path=audio_prompt_path,
        )

        elapsed = time.perf_counter() - start

        audio_seconds = wav.shape[-1] / model.sr

        rtf = elapsed / audio_seconds if audio_seconds > 0 else float("inf")

        durations_ms.append(elapsed * 1000)

        rtfs.append(rtf)

        logger.info(
            "Benchmark iteration {}/{}: {:.1f}ms, rtf={:.3f}",
            i + 1,
            request.iterations,
            elapsed * 1000,
            rtf,
        )

    allocated_mb, reserved_mb = gpu_memory_stats()

    avg_ms = sum(durations_ms) / len(durations_ms)

    avg_rtf = sum(rtfs) / len(rtfs)

    result = ServeBenchmarkResponse(
        load_time_ms=model_manager.last_load_time_ms,
        avg_inference_ms=avg_ms,
        min_inference_ms=min(durations_ms),
        max_inference_ms=max(durations_ms),
        avg_rtf=avg_rtf,
        inference_speed=1.0 / avg_rtf if avg_rtf > 0 else 0.0,
        gpu_memory_allocated_mb=allocated_mb,
        gpu_memory_reserved_mb=reserved_mb,
        iterations=request.iterations,
    )

    logger.info(
        "Benchmark complete: avg={:.1f}ms rtf={:.3f} speed={:.2f}x",
        result.avg_inference_ms,
        result.avg_rtf,
        result.inference_speed,
    )

    return result
