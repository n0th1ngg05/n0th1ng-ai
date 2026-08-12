"""Voice API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def list_voices(request: Request):
    """List all available voices.

    Field names and modelId are shaped to match what the Node speech layer
    (providerManager.listVoices() -> fetchWorkerVoices) expects: camelCase
    keys, and a real modelId per voice. See runtime/router.py's /voices
    handler for the full rationale — this module currently isn't mounted
    (app.py wires up runtime/router.py instead), but is kept consistent in
    case that changes.
    """
    all_voices = []
    for provider in request.app.state.runtime_manager.provider_registry.list_all():
        models = await provider.list_models()
        default_model_id = models[0].id if models else None

        voices = await provider.list_voices()
        for v in voices:
            all_voices.append({
                "id": v.id,
                "modelId": default_model_id,
                "providerId": provider.id,
                "name": v.name,
                "language": v.language,
                "gender": v.gender,
                "description": getattr(v, "description", ""),
                "sampleRate": getattr(v, "sample_rate", 0),
                "isDefault": getattr(v, "is_default", False),
            })
    return JSONResponse(content={"voices": all_voices})