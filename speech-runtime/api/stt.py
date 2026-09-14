"""STT API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def transcribe(request: Request):
    """Speech-to-text transcription."""
    body = await request.json()
    handler = request.app.state.runtime_manager.request_handler
    result = await handler.handle_stt(body)
    if not result.get("success"):
        return JSONResponse(content=result, status_code=400)
    return JSONResponse(content=result)
