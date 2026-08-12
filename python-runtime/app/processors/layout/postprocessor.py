class LayoutPostProcessor:

    @staticmethod
    def cleanup(layout: dict):

        regions = layout.get("regions", [])

        def sort_key(region):

            bbox = region.get("bbox", [])

            if len(bbox) >= 4:

                x1 = bbox[0]
                y1 = bbox[1]

                return (y1, x1)

            return (0, 0)

        regions.sort(key=sort_key)

        layout["regions"] = regions

        return layout