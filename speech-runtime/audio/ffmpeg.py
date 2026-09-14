import shutil
import subprocess
import tempfile
from pathlib import Path

from runtime.exceptions import AudioError


class FFmpegUtil:

    @staticmethod
    def available() -> bool:
        return shutil.which("ffmpeg") is not None

    @staticmethod
    def decode(
        data: bytes,
        source_format: str,
        sample_rate: int = 16000,
        channels: int = 1,
    ) -> tuple[bytes, int, int]:

        if not FFmpegUtil.available():
            raise AudioError("FFmpeg not installed.")

        with tempfile.TemporaryDirectory() as tmp:

            input_file = Path(tmp) / f"input.{source_format}"
            output_file = Path(tmp) / "output.pcm"

            input_file.write_bytes(data)

            command = [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(input_file),
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                str(channels),
                "-ar",
                str(sample_rate),
                str(output_file),
            ]

            process = subprocess.run(
                command,
                capture_output=True,
                text=True,
            )

            if process.returncode != 0:
                raise AudioError(process.stderr)

            return (
                output_file.read_bytes(),
                sample_rate,
                channels,
            )