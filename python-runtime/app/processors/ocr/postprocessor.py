class OCRPostProcessor:

    @staticmethod
    def cleanup(text: str):

        return "\n".join(

            line.strip()

            for line in text.splitlines()

            if line.strip()

        )