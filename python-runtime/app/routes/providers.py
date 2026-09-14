from fastapi import APIRouter

from pydantic import BaseModel

from app.managers.ocr_manager import ocr_manager
from app.managers.layout_manager import layout_manager
from app.managers.pdf_manager import pdf_manager
from app.managers.vision_manager import vision_manager

router = APIRouter()


class ProviderRequest(BaseModel):

    provider: str


@router.get("/providers")
async def providers():

    return {

        "success": True,

        "ocr": ocr_manager.info(),

        "layout": layout_manager.info(),

        "pdf": pdf_manager.info(),

        "vision": vision_manager.info()

    }


@router.post("/providers/{category}")
async def switch_provider(
    category: str,
    request: ProviderRequest
):

    match category:

        case "ocr":
            ocr_manager.set_provider(request.provider)

        case "layout":
            layout_manager.set_provider(request.provider)

        case "pdf":
            pdf_manager.set_provider(request.provider)

        case "vision":
            vision_manager.set_provider(request.provider)

        case _:
            return {

                "success": False,

                "error": "Unknown provider category."

            }

    return {

        "success": True

    }