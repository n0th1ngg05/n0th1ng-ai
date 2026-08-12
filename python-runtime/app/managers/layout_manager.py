from app.core.registry import Registry
from app.managers.base import Manager

from app.providers.layout.base import LayoutProvider


class LayoutManager(Manager):

    name = "layout"

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

    async def register(
        self,
        provider: LayoutProvider
    ):

        await provider.initialize()

        self.providers.register(
            provider.name,
            provider
        )

        if self.active is None:
            self.active = provider.name

    def current(self):

        return self.providers.get(
            self.active
        )

    async def shutdown(self):

        for provider in self.providers.values():

            await provider.shutdown()


layout_manager = LayoutManager()