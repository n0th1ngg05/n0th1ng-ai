from fastapi import APIRouter

from app.health import health

router = APIRouter()


@router.get("/health")
async def runtime_health():
    return health()