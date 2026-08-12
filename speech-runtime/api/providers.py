"""Provider API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def list_providers(request: Request):
    """List all registered providers."""
    providers = request.app.state.runtime_manager.provider_registry.list_all()
    return JSONResponse(content={
        "providers": [
            {
                "id": p.id,
                "name": p.manifest.name,
                "type": p.manifest.type,
                "version": p.manifest.version,
                "initialized": p.is_initialized,
            }
            for p in providers
        ]
    })
