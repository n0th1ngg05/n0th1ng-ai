from app.managers.base import Manager
from app.providers.ocr.base import OCRProvider
from app.core.registry import Registry


class OCRManager(Manager):

    name = "ocr"

    def __init__(self):

        self.providers = Registry()
        self.active = None

    async def initialize(self):
        pass

    def info(self):
        return{
            "active": self.active,
            "providers": self.list()
        }

    async def register(self, provider: OCRProvider):

        await provider.initialize()

        self.providers.register(provider.name, provider)

        if self.active is None:
            self.active = provider.name

    def current(self):

       return self.providers.get(self.active)

    def list(self):

        return self.providers.list()

    def set_provider(self, provider: str):

        if provider not in self.providers:
            raise Exception(f"OCR provider '{provider}' not found.")

        self.active = provider

    async def shutdown(self):

        for provider in self.providers.values():
            await provider.shutdown()

ocr_manager = OCRManager()