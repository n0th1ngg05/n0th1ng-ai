from __future__ import annotations
import json
from pathlib import Path


class VoiceLibrary:

    def __init__(self):

        self.root = (
            Path(__file__).resolve().parent.parent
            / "voices"
            / "datasets"
        )

        self.cache: dict = {}

        self.load_all()

    def load_all(self):

        self.cache.clear()

        if not self.root.exists():
            return

        for dataset in self.root.iterdir():

            if not dataset.is_dir():
                continue

            metadata = dataset / "metadata.json"

            if not metadata.exists():
                continue

            data = json.loads(
                metadata.read_text(
                    encoding="utf-8"
                )
            )

            cleaned = dataset / "cleaned"

            transcripts = dataset / "transcripts"

            reference_name = data.get("reference")

            references = []

            for wav in sorted(cleaned.glob("*.wav")):

                txt = transcripts / f"{wav.stem}.txt"

                if not txt.exists():
                    continue

                references.append(
                    {
                        "audio": wav.read_bytes(),

                        "text": txt.read_text(
                            encoding="utf-8"
                        ).strip(),
                    }
                )

            data["references"] = references

            selected_reference = None

            if reference_name:

                wav = cleaned / f"{reference_name}.wav"
                txt = transcripts / f"{reference_name}.txt"

                if not wav.exists():
                    raise FileNotFoundError(
                        f"Reference WAV not found: {wav}"
                    )

                if not txt.exists():
                    raise FileNotFoundError(
                        f"Reference transcript not found: {txt}"
                    )

                selected_reference = {
                    "audio": wav.read_bytes(),
                    "text": txt.read_text(
                        encoding="utf-8"
                    ).strip(),
                }

            elif references:

                selected_reference = references[0]

            if selected_reference:

                data["reference_audio"] = selected_reference["audio"]
                data["reference_text"] = selected_reference["text"]

            self.cache[data["id"]] = data

    def get(self, voice_id: str):

        return self.cache.get(voice_id)

    def list(self):

        return list(self.cache.values())