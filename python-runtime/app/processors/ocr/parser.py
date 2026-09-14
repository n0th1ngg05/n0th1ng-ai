class OCRParser:

    @staticmethod
    def parse(result):

        blocks = []
        text = []

        for page in result:

            for line in page.text_lines:

                polygon = []

                if line.polygon is not None:

                    polygon = [

                        [point[0], point[1]]

                        for point in line.polygon
                    ]

                blocks.append(

                    {

                        "text": line.text,

                        "confidence": float(line.confidence),

                        "bbox": polygon,

                    }

                )

                text.append(line.text)

        return {

            "text": "\n".join(text),

            "blocks": blocks

        }