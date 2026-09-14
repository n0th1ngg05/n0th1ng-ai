class LayoutParser:

    @staticmethod
    def parse(result):

        return {

            "width": result.get("width", 0),

            "height": result.get("height", 0),

            "regions": result.get("regions", [])

        }