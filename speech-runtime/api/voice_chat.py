"""Voice chat API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def voice_chat(request: Request):
    """Voice chat (STT + TTS)."""
    body = await request.json()
    handler = request.app.state.runtime_manager.request_handler
    result = await handler.handle_voice_chat(body)
    if not result.get("success"):
        return JSONResponse(content=result, status_code=400)
    return JSONResponse(content=result)
