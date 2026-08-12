from pydantic import BaseModel, Field


class ToolRequest(BaseModel):

    tool: str

    arguments: dict = Field(default_factory=dict)