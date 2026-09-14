from abc import abstractmethod

from app.providers.base import Provider


class OCRProvider(Provider):

    @abstractmethod
    async def recognize(self, image):
        pass