from app.providers.vision.qwen3vl import Qwen3VLProvider
from app.providers.vision.minicpm import MiniCPMVProvider
from app.providers.vision.florence2 import Florence2Provider
from app.providers.vision.internvl import InternVLProvider


VISION_PROVIDERS = [

    Qwen3VLProvider(),

    MiniCPMVProvider(),

    # Florence2Provider(),

    # InternVLProvider(),

]