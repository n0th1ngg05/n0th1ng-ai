from fastapi import APIRouter

from app.runtime import runtime
from app.managers.tool_manager import tool_manager
from app.managers.ocr_manager import ocr_manager
from app.managers.layout_manager import layout_manager
from app.managers.pdf_manager import pdf_manager
from app.managers.vision_manager import vision_manager

router = APIRouter()


@router.get("/runtime")
async def runtime_info():

    return {

        "success": True,

        "runtime": runtime.info(),

        "tools": tool_manager.info(),

        "providers": {

            "ocr": ocr_manager.info(),

            "layout": layout_manager.info(),

            "pdf": pdf_manager.info(),

            "vision": vision_manager.info(),

        }

    }