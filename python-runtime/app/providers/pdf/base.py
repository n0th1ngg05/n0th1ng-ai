from abc import abstractmethod

from app.providers.base import Provider


class PDFProvider(Provider):

    @abstractmethod
    async def parse(self, file_path: str):
        pass