from abc import abstractmethod

from app.providers.base import Provider


class LayoutProvider(Provider):

    @abstractmethod
    async def analyze(self, image):
        pass