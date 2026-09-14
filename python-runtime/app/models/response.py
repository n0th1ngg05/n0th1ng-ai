from pydantic import BaseModel


class ToolResponse(BaseModel):

    success: bool

    result: dict | None = None

    error: str | None = None