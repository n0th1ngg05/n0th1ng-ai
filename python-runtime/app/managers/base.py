from abc import ABC, abstractmethod


class Manager(ABC):

    name = ""

    @abstractmethod
    async def initialize(self):
        pass

    @abstractmethod
    async def shutdown(self):
        pass