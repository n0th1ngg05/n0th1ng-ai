from fastapi import APIRouter, HTTPException

from app.managers.tool_manager import ToolManager
from app.models.ocr import OCRRequest

router = APIRouter()


@router.post("/ocr")
async def run_ocr(request: OCRRequest):

    tool = ToolManager.get("local_vision_ocr")

    if tool is None:
        raise HTTPException(
            status_code=500,
            detail="OCR Tool not loaded."
        )

    return await tool.execute(
        request.model_dump()
    )