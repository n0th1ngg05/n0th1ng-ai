from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from loguru import logger


@dataclass
class VoiceEntry:
    """A single discovered voice: either the built-in default or a
    reference-audio dataset used for zero-shot cloning."""

    id: str
    name: str
    language: str
    description: str
    is_default: bool
    is_cloned: bool
    sample_rate: int
    audio_path: Path | None
    exaggeration: float
    cfg_weight: float

    def read_prompt_bytes(self) -> bytes | None:

        if self.audio_path is None or not self.audio_path.exists():
            return None

        return self.audio_path.read_bytes()


class VoiceLibrary:
    """Discovers reference-audio voice datasets for Chatterbox voice cloning.

    Layout expected under <engine_root>/voices/:

        voices/
            <voice_id>/
                metadata.json     # {"name": ..., "language": "en",
                                   #  "description": ..., "exaggeration": 0.5,
                                   #  "cfg_weight": 0.5}
                reference.wav      # single conditioning clip

    A dataset missing reference.wav is skipped (logged, not raised) so one
    malformed voice folder can't take the whole engine down. This mirrors
    the runtime-level VoiceLibrary's tolerance for partial datasets, but
    Chatterbox only needs a single prompt clip per voice rather than a
    transcript-aligned reference list, since ChatterboxTTS.generate()
    conditions on one audio_prompt rather than multiple paired examples.
    """

    DEFAULT_EXAGGERATION = 0.5
    DEFAULT_CFG_WEIGHT = 0.5

    def __init__(self, voices_root: Path, default_sample_rate: int = 24000):

        self.root = voices_root

        self.default_sample_rate = default_sample_rate

        self._entries: dict[str, VoiceEntry] = {}

        self.reload()

    def reload(self) -> None:
        """Re-scan the voices directory. Safe to call at any time — used
        both at startup and to pick up newly-added cloned voices without
        a restart."""

        self._entries.clear()

        self._entries["default"] = VoiceEntry(
            id="default",
            name="Default",
            language="en",
            description="Built-in Chatterbox voice (no reference audio)",
            is_default=True,
            is_cloned=False,
            sample_rate=self.default_sample_rate,
            audio_path=None,
            exaggeration=self.DEFAULT_EXAGGERATION,
            cfg_weight=self.DEFAULT_CFG_WEIGHT,
        )

        if not self.root.exists():
            logger.info(
                "Voice library directory not found at {}, only 'default' voice available.",
                self.root,
            )
            return

        for dataset_dir in sorted(self.root.iterdir()):

            if not dataset_dir.is_dir():
                continue

            voice_id = dataset_dir.name

            reference = dataset_dir / "reference.wav"

            if not reference.exists():
                logger.warning(
                    "Skipping voice dataset '{}': no reference.wav found.",
                    voice_id,
                )
                continue

            metadata = {}

            metadata_path = dataset_dir / "metadata.json"

            if metadata_path.exists():

                try:
                    metadata = json.loads(
                        metadata_path.read_text(encoding="utf-8")
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to parse metadata.json for voice '{}': {}",
                        voice_id,
                        e,
                    )

            self._entries[voice_id] = VoiceEntry(
                id=voice_id,
                name=metadata.get("name", voice_id.replace("_", " ").title()),
                language=metadata.get("language", "en"),
                description=metadata.get("description", "Cloned reference voice"),
                is_default=False,
                is_cloned=True,
                sample_rate=self.default_sample_rate,
                audio_path=reference,
                exaggeration=float(
                    metadata.get("exaggeration", self.DEFAULT_EXAGGERATION)
                ),
                cfg_weight=float(
                    metadata.get("cfg_weight", self.DEFAULT_CFG_WEIGHT)
                ),
            )

        logger.info(
            "Voice library loaded {} voice(s): {}",
            len(self._entries),
            ", ".join(self._entries.keys()),
        )

    def get(self, voice_id: str | None) -> VoiceEntry:

        if not voice_id:
            return self._entries["default"]

        entry = self._entries.get(voice_id)

        if entry is None:
            logger.warning(
                "Voice '{}' not found, falling back to default.",
                voice_id,
            )
            return self._entries["default"]

        return entry

    def list(self) -> list[VoiceEntry]:
        return list(self._entries.values())
