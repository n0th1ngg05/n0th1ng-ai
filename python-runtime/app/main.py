from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

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