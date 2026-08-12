class Registry:

    def __init__(self):
        self.items = {}

    def register(self, name, item):
        self.items[name] = item

    def get(self, name):
        return self.items.get(name)

    def list(self):
        return list(self.items.keys())

    def values(self):
        return self.items.values()