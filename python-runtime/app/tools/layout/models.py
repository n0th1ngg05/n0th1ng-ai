from pydantic import BaseModel


class LayoutRequest(BaseModel):

    image_path: str