"""Entry point for the speech runtime."""
import asyncio
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

from config import settings
from runtime.app import create_app
from runtime.logger import get_logger

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Speech runtime starting up")
    await app.state.runtime_manager.initialize()
    yield
    logger.info("Speech runtime shutting down")
    await app.state.runtime_manager.shutdown()


def main():
    """Main entry point."""
    app = create_app(lifespan=lifespan)
    logger.info(f"Starting speech runtime on {settings.host}:{settings.port}")
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        workers=settings.workers,
    )


if __name__ == "__main__":
    main()
