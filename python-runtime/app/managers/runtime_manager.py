class RuntimeManager:

    def __init__(self):

        self.managers = {}

    def register(self, name: str, manager):

        self.managers[name] = manager

    def get(self, name: str):

        return self.managers.get(name)

    def list(self):

        return list(self.managers.keys())


runtime_manager = RuntimeManager()