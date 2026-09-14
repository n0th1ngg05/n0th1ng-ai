from abc import ABC, abstractmethod


class Provider(ABC):

    name = ""
    version = "1.0.0"

    @abstractmethod
    async def initialize(self):
        pass

    @abstractmethod
    async def shutdown(self):
        pass