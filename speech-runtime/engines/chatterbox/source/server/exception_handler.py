from kui.asgi import HTTPException
from kui.asgi import JSONResponse


class ExceptionHandler:

    async def http_exception_handler(
        self,
        exc: HTTPException,
    ):

        return JSONResponse(
            {
                "error": str(exc),
            },
            status_code=exc.status_code,
        )

    async def other_exception_handler(
        self,
        exc: Exception,
    ):

        return JSONResponse(
            {
                "error": str(exc),
            },
            status_code=500,
        )