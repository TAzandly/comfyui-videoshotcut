import os
import shutil


def find_bin(name: str) -> str | None:
    env = os.environ.get(name.upper() + "_PATH") or os.environ.get(name.upper())
    if env and os.path.isfile(env):
        return env
    return shutil.which(name)


def require_ffmpeg() -> tuple[str, str]:
    ffmpeg = find_bin("ffmpeg")
    ffprobe = find_bin("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("ffmpeg/ffprobe not found. Install ffmpeg and ensure it is on PATH.")
    return ffmpeg, ffprobe
