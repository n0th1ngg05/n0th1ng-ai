import os
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

# Patch shutil.move so Surya model downloads overwrite existing files instead of crashing
_orig_shutil_move = shutil.move

def _safe_shutil_move(src, dst, *args, **kwargs):
    if os.path.isdir(dst):
        target = os.path.join(dst, os.path.basename(src))
        if os.path.exists(target):
            try:
                if os.path.isdir(target):
                    shutil.rmtree(target)
                else:
                    os.remove(target)
            except Exception:
                pass
    return _orig_shutil_move(src, dst, *args, **kwargs)

shutil.move = _safe_shutil_move

from app.config import HOST, PORT
from app.routes import router
from app.runtime import runtime


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
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=False,
    )