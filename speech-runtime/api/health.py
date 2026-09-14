"""Health API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def get_health(request: Request):
    """Get runtime health status."""
    report = await request.app.state.runtime_manager.get_health()
    return JSONResponse(content=report)
