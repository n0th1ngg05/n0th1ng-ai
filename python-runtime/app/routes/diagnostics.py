from fastapi import APIRouter

from app.runtime import runtime
from app.managers.tool_manager import tool_manager
from app.managers.ocr_manager import ocr_manager
from app.managers.layout_manager import layout_manager
from app.managers.pdf_manager import pdf_manager
from app.managers.vision_manager import vision_manager

router = APIRouter()


@router.get("/diagnostics")

async def diagnostics():

    return {

        "success": True,

        "runtime": runtime.info(),

        "tools": tool_manager.info(),

        "ocr": ocr_manager.health(),

        "layout": layout_manager.health(),

        "pdf": pdf_manager.health(),

        "vision": vision_manager.health()

    }