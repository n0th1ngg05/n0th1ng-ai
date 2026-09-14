"""Profile API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def list_profiles(request: Request):
    """List all voice profiles."""
    profiles = await request.app.state.runtime_manager.profile_manager.list_profiles()
    return JSONResponse(content={"profiles": [p.to_dict() for p in profiles]})
