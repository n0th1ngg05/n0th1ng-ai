from fastapi import APIRouter

from app.managers.runtime_manager import runtime_manager
from app.managers.tool_manager import tool_manager
from app.managers.ocr_manager import ocr_manager

router = APIRouter()


@router.get("/info")
async def info():

    return {
        "runtime": {
            "name": "python-runtime",
            "version": "1.0.0"
        },
        "managers": runtime_manager.list(),
        "tools": tool_manager.list(),
        "providers": {
            "ocr": {
                "active": ocr_manager.active,
                "available": ocr_manager.list()
            }
        }
    }