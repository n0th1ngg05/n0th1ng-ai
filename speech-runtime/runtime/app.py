"""FastAPI application factory."""
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI

from runtime.router import setup_routes
from runtime.runtime_manager import RuntimeManager
from runtime.config import RuntimeConfig
from runtime.logger import get_logger, setup_logging

logger = get_logger("app")


def create_app(lifespan: Callable = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    setup_logging()

    config = RuntimeConfig()
    app = FastAPI(
        title="n0th1ng AI Speech Runtime",
        version="1.0.0",
        description="Python Speech Runtime for n0th1ng AI",
    )

    app.state.runtime_manager = RuntimeManager(config)
    app.state.config = config

    setup_routes(app)

    @asynccontextmanager
    async def default_lifespan(app: FastAPI):
        logger.info("Speech runtime starting up")
        await app.state.runtime_manager.initialize()
        yield
        logger.info("Speech runtime shutting down")
        await app.state.runtime_manager.shutdown()

    if lifespan:
        app.router.lifespan_context = lifespan
    else:
        app.router.lifespan_context = default_lifespan

    return app
