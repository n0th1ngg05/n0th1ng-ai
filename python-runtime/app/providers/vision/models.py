VISION_MODELS = {

    "qwen3_vl": {

        "display_name": "Qwen3-VL 8B",

        "backend": "ollama",

        "capabilities": [

            "vision",

            "reasoning",

            "ocr",

            "documents",

            "charts",

            "screenshots"

        ]

    },

    "minicpm": {

        "display_name": "MiniCPM-V 4.5 8B",

        "backend": "ollama",

        "capabilities": [

            "vision",

            "ocr",

            "fast"

        ]

    },

    "florence2": {

        "display_name": "Florence-2",

        "backend": "huggingface",

        "capabilities": [

            "caption",

            "grounding",

            "detection"

        ]

    },

    "internvl": {

        "display_name": "InternVL",

        "backend": "huggingface",

        "capabilities": [

            "vision",

            "reasoning"

        ]

    }

}