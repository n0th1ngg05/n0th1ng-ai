from pydantic import BaseModel, Field


class VisionObject(BaseModel):

    label: str

    confidence: float

    bbox: list = Field(default_factory=list)


class VisionResponse(BaseModel):

    success: bool = True

    text: str = ""

    objects: list[VisionObject] = Field(default_factory=list)

    captions: list[str] = Field(default_factory=list)

    ocr: str = ""

    metadata: dict = Field(default_factory=dict)