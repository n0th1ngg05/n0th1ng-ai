"""Audio format conversion utilities."""
from typing import Tuple
import numpy as np

from audio.wav import WavUtil
from audio.mp3 import Mp3Util
from runtime.exceptions import AudioError
from audio.ffmpeg import FFmpegUtil


class AudioConverter:
    """Convert between audio formats."""

    @staticmethod
    def convert(data: bytes, from_format: str, to_format: str, sample_rate: int = 22050, channels: int = 1) -> bytes:
        """Convert audio between formats."""
        from_format = from_format.lower()
        to_format = to_format.lower()

        if from_format == to_format:
            return data

        # Formats that require FFmpeg (common browser/container formats)
        FFMPEG_FORMATS = {"webm", "ogg", "flac", "aac", "m4a", "opus"}

        # Decode to PCM first
        if from_format == "pcm":

            pcm = data
            sr = sample_rate
            ch = channels

        elif from_format == "wav":

            pcm = WavUtil.extract_pcm(data)
            sr, ch, _ = WavUtil.parse_header(data)

        elif from_format == "mp3":

            pcm, sr, ch = Mp3Util.decode(data)

        elif from_format in FFMPEG_FORMATS:

            if not FFmpegUtil.available():
                raise AudioError(
                    f"Cannot decode '{from_format}' audio: FFmpeg is not installed. "
                    f"Install FFmpeg and ensure it is on your system PATH. "
                    f"Download from https://ffmpeg.org/download.html"
                )
            pcm, sr, ch = FFmpegUtil.decode(
                data,
                from_format,
                sample_rate,
                channels,
            )

        else:

            if not FFmpegUtil.available():
                raise AudioError(
                    f"Unsupported source format: {from_format}. "
                    f"FFmpeg is not installed, which is required for non-WAV/MP3 formats."
                )
            pcm, sr, ch = FFmpegUtil.decode(
                data,
                from_format,
                sample_rate,
                channels,
            )

        # Encode to target
        if to_format == "wav":
            return WavUtil.build_wav(pcm, sr, ch)
        elif to_format == "mp3":
            return Mp3Util.encode(pcm, sr, ch)
        elif to_format == "pcm":
            return pcm
        else:
            raise AudioError(f"Unsupported target format: {to_format}")

    @staticmethod
    def to_numpy(data: bytes, format: str, bit_depth: int = 16) -> np.ndarray:
        """Convert audio bytes to numpy array."""
        if format == "wav":

            pcm = WavUtil.extract_pcm(data)

        elif format == "pcm":

            pcm = data

        else:

            pcm, _, _ = FFmpegUtil.decode(
                data,
                format,
            )

        return WavUtil.pcm_to_numpy(
            pcm,
            bit_depth,
        )