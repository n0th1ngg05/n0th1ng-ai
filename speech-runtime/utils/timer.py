"""Timing and benchmark utilities."""
import time
import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from dataclasses import dataclass


@dataclass
class TimingResult:
    """Result of a timed operation."""
    elapsed_ms: float
    start_time: float
    end_time: float


class Timer:
    """Simple timer context manager."""

    def __init__(self):
        self.start: float = 0.0
        self.end: float = 0.0

    def __enter__(self) -> "Timer":
        self.start = time.perf_counter()
        return self

    def __exit__(self, *args) -> None:
        self.end = time.perf_counter()

    @property
    def elapsed(self) -> float:
        """Elapsed time in seconds."""
        return self.end - self.start

    @property
    def elapsed_ms(self) -> float:
        """Elapsed time in milliseconds."""
        return self.elapsed * 1000


@asynccontextmanager
async def async_timer() -> AsyncGenerator[Timer, None]:
    """Async timer context manager."""
    timer = Timer()
    timer.start = time.perf_counter()
    try:
        yield timer
    finally:
        timer.end = time.perf_counter()
