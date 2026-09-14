from app.core.registry import Registry
from app.managers.base import Manager
from app.managers.ocr_manager import ocr_manager
from app.tools.base import BaseTool


class ToolManager(Manager):

    name = "tool"

    def __init__(self):
        self.tools = Registry()

    async def initialize(self):
        pass

    async def register(self, tool: BaseTool):

        await tool.initialize()

        self.tools.register(
            tool.name,
            tool
        )

    def get(self, name: str):

        return self.tools.get(name)

    def list(self):

        return self.tools.list()

    def info(self):

        return {
            "count": len(self.tools),
            "tools": sorted(self.tools.keys())
        }

    async def shutdown(self):

        for tool in self.tools.values():
            await tool.shutdown()


tool_manager = ToolManager()