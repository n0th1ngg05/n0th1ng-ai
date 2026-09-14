"""Async HTTP downloader with resume and progress tracking."""
import asyncio
import aiohttp
import aiofiles
from pathlib import Path
from typing import Callable, Optional
from dataclasses import dataclass

from utils.constants import DOWNLOAD_CHUNK_SIZE, DOWNLOAD_TIMEOUT_SECONDS, MAX_DOWNLOAD_RETRIES
from runtime.logger import get_logger

logger = get_logger("downloader")


@dataclass
class DownloadProgress:
    """Download progress information."""
    downloaded_bytes: int
    total_bytes: int
    speed: float
    eta: int


class HttpDownloader:
    """Async HTTP file downloader."""

    def __init__(self):
        self._cancelled = False
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def download(
        self,
        url: str,
        destination: Path,
        total_bytes: int = 0,
        progress_callback: Optional[Callable[[DownloadProgress], None]] = None,
    ) -> Path:
        """Download a file with progress tracking."""
        destination.parent.mkdir(parents=True, exist_ok=True)
        downloaded = destination.exists() and destination.stat().st_size or 0

        headers = {}
        if downloaded > 0:
            headers["Range"] = f"bytes={downloaded}-"

        for attempt in range(MAX_DOWNLOAD_RETRIES):
            try:
                session = await self._get_session()
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=DOWNLOAD_TIMEOUT_SECONDS)) as resp:
                    if resp.status not in (200, 206):
                        raise RuntimeError(f"HTTP {resp.status}: {await resp.text()}")

                    total = total_bytes or int(resp.headers.get("Content-Length", 0)) + downloaded
                    mode = "ab" if downloaded > 0 else "wb"

                    async with aiofiles.open(destination, mode) as f:
                        start_time = asyncio.get_event_loop().time()
                        async for chunk in resp.content.iter_chunked(DOWNLOAD_CHUNK_SIZE):
                            if self._cancelled:
                                raise asyncio.CancelledError("Download cancelled")
                            await f.write(chunk)
                            downloaded += len(chunk)
                            elapsed = asyncio.get_event_loop().time() - start_time
                            speed = downloaded / elapsed if elapsed > 0 else 0
                            eta = int((total - downloaded) / speed) if speed > 0 else 0
                            if progress_callback:
                                progress_callback(DownloadProgress(downloaded, total, speed, eta))
                return destination
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {e}")
                if attempt == MAX_DOWNLOAD_RETRIES - 1:
                    raise RuntimeError(f"Download failed after {MAX_DOWNLOAD_RETRIES} attempts: {e}")
                await asyncio.sleep(2 ** attempt)

        return destination

    def cancel(self) -> None:
        """Cancel the current download."""
        self._cancelled = True

    async def close(self) -> None:
        """Close the downloader session."""
        if self._session and not self._session.closed:
            await self._session.close()
