"""Audio streaming utilities."""
import asyncio
from typing import AsyncIterator, Optional
from collections import deque

from runtime.logger import get_logger

logger = get_logger("audio_stream")


class AudioStreamBuffer:
    """Thread-safe async audio stream buffer."""

    def __init__(self, maxsize: int = 100):
        self._queue: deque[bytes] = deque(maxlen=maxsize)
        self._event = asyncio.Event()
        self._closed = False

    async def put(self, chunk: bytes) -> None:
        """Put a chunk into the buffer."""
        self._queue.append(chunk)
        self._event.set()

    async def get(self) -> bytes:
        """Get a chunk from the buffer."""
        while not self._queue and not self._closed:
            self._event.clear()
            await self._event.wait()
        if self._queue:
            return self._queue.popleft()
        return b""

    async def iter_chunks(self) -> AsyncIterator[bytes]:
        """Iterate over chunks."""
        while True:
            chunk = await self.get()
            if not chunk and self._closed:
                break
            if chunk:
                yield chunk

    def close(self) -> None:
        """Close the stream."""
        self._closed = True
        self._event.set()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self.iter_chunks()
