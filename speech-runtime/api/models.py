"""Model API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def list_models(request: Request):
    """List all available models."""
    models = await request.app.state.runtime_manager.model_manager.list_models()
    return JSONResponse(content={"models": models})
