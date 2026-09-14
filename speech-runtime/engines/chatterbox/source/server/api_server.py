from __future__ import annotations

import asyncio
import re

import pyrootutils
import uvicorn
from loguru import logger

from kui.asgi import (
    FactoryClass,
    HTTPException,
    Kui,
    OpenAPI,
)

from kui.openapi.specification import Info

pyrootutils.setup_root(
    __file__,
    pythonpath=True,
)

from chatterbox_engine.utils import gpu_cleanup
from server.api_utils import MsgPackRequest, parse_args
from server.exception_handler import ExceptionHandler
from server.model_manager import ModelManager
from server.routes import routes


class API(ExceptionHandler):

    def __init__(self):

        self.args = parse_args()

        self.openapi = OpenAPI(
            Info(
                {
                    "title": "Chatterbox API",
                    "version": "1.0.0",
                }
            )
        ).routes

        self.app = Kui(
            routes=routes + self.openapi[1:],
            exception_handlers={
                HTTPException: self.http_exception_handler,
                Exception: self.other_exception_handler,
            },
            factory_class=FactoryClass(
                http=MsgPackRequest,
            ),
        )

        self.app.on_startup(self.initialize_app)

        self.app.on_shutdown(self.shutdown_app)

    async def initialize_app(
        self,
        app: Kui,
    ):

        logger.info(
            "Starting Chatterbox engine (device={}, model_path={})",
            self.args.device,
            self.args.model_path,
        )

        # ModelManager.__init__ runs a blocking model load + warmup that
        # can take tens of seconds on a cold GPU. Running it directly here
        # would block this coroutine (and therefore the ASGI lifespan
        # startup handshake) on the event loop's only thread; offloading
        # to a worker thread lets uvicorn's lifespan protocol proceed
        # normally while the load happens in the background thread pool.
        app.state.model_manager = await asyncio.to_thread(
            ModelManager,
            device=self.args.device,
            model_path=self.args.model_path,
        )

        logger.info("Chatterbox engine startup complete.")

    async def shutdown_app(
        self,
        app: Kui,
    ):

        logger.info("Shutting down Chatterbox engine...")

        model_manager = getattr(app.state, "model_manager", None)

        if model_manager is not None:

            await model_manager.unload()

        gpu_cleanup()

        logger.info("Chatterbox engine shutdown complete.")


if __name__ == "__main__":

    api = API()

    match = re.search(
        r"\[([^\]]+)\]:(\d+)$",
        api.args.listen,
    )

    if match:

        host, port = match.groups()

    else:

        host, port = api.args.listen.split(":")

    logger.info(
        "Launching Chatterbox uvicorn server on {}:{} ({} worker(s))",
        host,
        port,
        api.args.workers,
    )

    uvicorn.run(
        api.app,
        host=host,
        port=int(port),
        workers=api.args.workers,
        log_level="info",
    )
