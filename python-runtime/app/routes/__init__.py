from fastapi import APIRouter

from app.routes.health import router as health_router
from app.routes.runtime import router as runtime_router
from app.routes.ocr import router as ocr_router
from app.routes.providers import router as providers_router
from app.routes.info import router as info_router
from app.routes.execute import router as execute_router
from app.routes.models import router as models_router
from app.routes.analyze import router as analyze_router

router = APIRouter()

router.include_router(health_router)
router.include_router(runtime_router)
router.include_router(ocr_router)
router.include_router(providers_router)
router.include_router(info_router)
router.include_router(execute_router)
router.include_router(models_router)
router.include_router(analyze_router)