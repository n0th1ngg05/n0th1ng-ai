from kokoro import KPipeline
p = KPipeline(repo_id="hexgrad/Kokoro-82M", lang_code="a")

voices = [
    "af_bella", "af_nicole", "af_sarah", "af_sky",
    "bf_isabella", "bm_george",
]

for v in voices:
    next(p("warmup", voice=v))
    print(f"downloaded {v}")