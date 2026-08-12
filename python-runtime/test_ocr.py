from paddleocr import PaddleOCR

ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_server_det",
    text_recognition_model_name="PP-OCRv5_server_rec"
)

results = list(
    ocr.predict(
        input="printed.png",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_det_limit_side_len=960,
    )
)

for page in results:
    page.print()

    print("\nRecognized Text:")
    print(page["rec_texts"])

    print("\nConfidence:")
    print(page["rec_scores"])