from abc import abstractmethod

from app.providers.base import Provider

from app.tools.vision.models import VisionResponse


class VisionProvider(Provider):

    name = ""

    @abstractmethod
    async def analyze(
        self,
        image_path: str,
        prompt: str | None = None
    ) -> VisionResponse:
        pass