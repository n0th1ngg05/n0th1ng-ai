import socket
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

from app.config import HOST, PORT
from app.routes import router
from app.runtime import runtime


def _ensure_port_free(host: str, port: int) -> None:
    """
    Fail fast if something is already bound to (host, port), instead of
    loading every model and only discovering the conflict when uvicorn
    tries to bind. Prevents the multi-minute "load everything, then die"
    loop when a stray start.ps1 (or other instance) already owns the port.

    NOTE: This is called unconditionally at module level (not just under
    __main__) so that it also fires when the process is launched via
    `python -m app.main` from Node, which sets __name__ = "app.main",
    not "__main__".
    """
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind((host, port))
    except OSError:
        print(
            f"[Runtime] Port {port} on {host} is already in use. "
            f"Another Python Runtime instance (e.g. a stray start.ps1) "
            f"is likely still running. Refusing to start.",
            file=sys.stderr,
        )
        sys.exit(1)
    finally:
        probe.close()


# Run the port check immediately, before any model loading.
# This fires whether we are run as `python app/main.py` (__name__ == "__main__")
# OR as `python -m app.main` (__name__ == "app.main") — the old placement
# inside the `if __name__ == "__main__"` block was skipped in the latter case,
# meaning uvicorn only discovered the conflict AFTER all models had loaded.
_ensure_port_free(HOST, PORT)


@asynccontextmanager
async def lifespan(app: FastAPI):

    await runtime.initialize()

    print("===================================")
    print("   Python Tool Runtime Started")
    print("===================================")

    yield

    await runtime.shutdown()


app = FastAPI(
    title="Python Tool Runtime",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(router)


if __name__ == "__main__":
    # Port was already checked at module load above; no need to call again.
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=False,
    )