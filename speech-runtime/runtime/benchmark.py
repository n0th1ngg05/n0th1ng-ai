"""Benchmarking utilities for the speech runtime."""
import time
import asyncio
import psutil
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from datetime import datetime

from utils.timer import async_timer
from runtime.logger import get_logger

logger = get_logger("benchmark")


@dataclass
class BenchmarkResult:
    """Result of a benchmark run."""
    id: str
    provider_id: str
    model_id: str
    voice_id: Optional[str] = None
    test_type: str = "tts"
    latency_ms: float = 0.0
    load_time_ms: float = 0.0
    inference_speed: float = 0.0
    rtf: float = 0.0
    memory_usage_mb: float = 0.0
    cpu_percent: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BenchmarkRunner:
    """Runs standardized benchmarks."""

    def __init__(self, warmup: int = 2, iterations: int = 10):
        self.warmup = warmup
        self.iterations = iterations

    async def run_tts_benchmark(
        self,
        provider,
        model_id: str,
        voice_id: Optional[str],
        text: str = "Hello world, this is a benchmark test.",
    ) -> BenchmarkResult:
        """Run a TTS benchmark."""
        from utils.helpers import generate_id
        bench_id = generate_id()

        # Warmup
        for _ in range(self.warmup):
            try:
                await provider.synthesize({"text": text, "model_id": model_id, "voice_id": voice_id})
            except Exception as e:
                logger.warning(f"Warmup error: {e}")

        latencies = []
        process = psutil.Process()
        mem_before = process.memory_info().rss / (1024 * 1024)

        for _ in range(self.iterations):
            async with async_timer() as timer:
                await provider.synthesize({"text": text, "model_id": model_id, "voice_id": voice_id})
            latencies.append(timer.elapsed_ms)

        mem_after = process.memory_info().rss / (1024 * 1024)
        avg_latency = sum(latencies) / len(latencies)
        duration_sec = (len(text) * 0.1) / 1000  # rough estimate
        rtf = avg_latency / 1000 / duration_sec if duration_sec > 0 else 0

        return BenchmarkResult(
            id=bench_id,
            provider_id=provider.id,
            model_id=model_id,
            voice_id=voice_id,
            test_type="tts",
            latency_ms=avg_latency,
            load_time_ms=latencies[0] if latencies else 0,
            inference_speed=len(text) / (avg_latency / 1000) if avg_latency > 0 else 0,
            rtf=rtf,
            memory_usage_mb=mem_after - mem_before,
            cpu_percent=psutil.cpu_percent(),
        )

    async def run_stt_benchmark(
        self,
        provider,
        model_id: str,
        audio_data: bytes,
    ) -> BenchmarkResult:
        """Run an STT benchmark."""
        from utils.helpers import generate_id
        bench_id = generate_id()

        for _ in range(self.warmup):
            try:
                await provider.transcribe({"audio": audio_data, "model_id": model_id})
            except Exception as e:
                logger.warning(f"Warmup error: {e}")

        latencies = []
        process = psutil.Process()
        mem_before = process.memory_info().rss / (1024 * 1024)

        for _ in range(self.iterations):
            async with async_timer() as timer:
                await provider.transcribe({"audio": audio_data, "model_id": model_id})
            latencies.append(timer.elapsed_ms)

        mem_after = process.memory_info().rss / (1024 * 1024)
        avg_latency = sum(latencies) / len(latencies)

        return BenchmarkResult(
            id=bench_id,
            provider_id=provider.id,
            model_id=model_id,
            test_type="stt",
            latency_ms=avg_latency,
            load_time_ms=latencies[0] if latencies else 0,
            inference_speed=1.0,
            rtf=avg_latency / 1000,
            memory_usage_mb=mem_after - mem_before,
            cpu_percent=psutil.cpu_percent(),
        )
