from pathlib import Path

from faster_whisper import WhisperModel

# ------------------------

VOICESET = Path(
    "voices/datasets/kerry_condon/cleaned"
)

OUT = Path(
    "voices/datasets/kerry_condon/transcripts"
)

MODEL = "turbo"

# ------------------------

OUT.mkdir(parents=True, exist_ok=True)

print("Loading Whisper...")

model = WhisperModel(
    MODEL,
    device="cuda",
    compute_type="int8",
)

print("Ready.\n")

files = sorted(VOICESET.glob("*.wav"))

print(f"Found {len(files)} clips.\n")

for wav in files:

    print(wav.name)

    segments, info = model.transcribe(
        str(wav),
        beam_size=5,
        vad_filter=True,
    )

    text = " ".join(
        segment.text.strip()
        for segment in segments
    ).strip()

    txt = OUT / (wav.stem + ".txt")

    txt.write_text(
        text,
        encoding="utf-8",
    )

print("\nFinished.")