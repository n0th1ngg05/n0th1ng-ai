from fastapi import APIRouter

from app.managers.ocr_manager import ocr_manager
from app.managers.layout_manager import layout_manager
from app.managers.pdf_manager import pdf_manager
from app.managers.vision_manager import vision_manager

router = APIRouter()


@router.get("/models")
async def models():

    return {

        "success": True,

        "ocr": {

            "provider": ocr_manager.active,

            "loaded": ocr_manager.current() is not None

        },

        "layout": {

            "provider": layout_manager.active,

            "loaded": layout_manager.current() is not None

        },

        "pdf": {

            "provider": pdf_manager.active,

            "loaded": pdf_manager.current() is not None

        },

        "vision": {

            "provider": vision_manager.active,

            "loaded": vision_manager.current() is not None

        }

    }