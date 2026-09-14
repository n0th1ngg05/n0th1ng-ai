from abc import ABC, abstractmethod


class BaseTool(ABC):

    name: str = ""
    version: str = "1.0.0"

    @abstractmethod
    async def initialize(self):
        pass

    @abstractmethod
    async def execute(self, payload: dict):
        pass

    @abstractmethod
    async def shutdown(self):
        pass