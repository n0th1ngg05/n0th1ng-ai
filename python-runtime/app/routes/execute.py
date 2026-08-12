from fastapi import APIRouter

from app.models.request import ToolRequest
from app.models.response import ToolResponse

from app.managers.tool_manager import tool_manager

router = APIRouter()


@router.post(
    "/execute",
    response_model=ToolResponse
)
async def execute_tool(
    request: ToolRequest
):

    tool = tool_manager.get(request.tool)

    if tool is None:

        return ToolResponse(

            success=False,

            error=f"Tool '{request.tool}' not found."

        )

    try:

        result = await tool.execute(
            request.arguments
        )

        return ToolResponse(

            success=result.get("success", True),

            result=result,

            error=result.get("error")

        )

    except Exception as e:

        return ToolResponse(

            success=False,

            error=str(e)

        )