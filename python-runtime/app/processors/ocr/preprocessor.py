import cv2


class OCRPreprocessor:

    @staticmethod
    def load(path: str):

        image = cv2.imread(path)

        if image is None:
            raise Exception(f"Cannot read image: {path}")

        return image


    @staticmethod
    def grayscale(image):

        return cv2.cvtColor(
            image,
            cv2.COLOR_BGR2GRAY
        )


    @staticmethod
    def resize(image, scale=2):

        return cv2.resize(

            image,

            None,

            fx=scale,

            fy=scale,

            interpolation=cv2.INTER_CUBIC

        )
    @staticmethod
    def denoise(image):

        return cv2.fastNlMeansDenoising(image)

    @staticmethod
    def threshold(image):

        return cv2.adaptiveThreshold(
            image,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            15,
        )

    @staticmethod
    def blur(image):

        return cv2.GaussianBlur(
            image,
            (3, 3),
            0,
        )

    @staticmethod
    def sharpen(image):

        kernel = [
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0],
        ]

        return cv2.filter2D(
            image,
            -1,
            kernel,
        )