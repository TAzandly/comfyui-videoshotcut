import re
import subprocess
from .ffmpeg_util import require_ffmpeg
from .points import normalize_points

_SCENE_THR = {"low": 0.4, "medium": 0.3, "high": 0.2}


def interval_points(total_frames: int, fps: float, interval_sec: float) -> list[int]:
    if fps <= 0 or interval_sec <= 0:
        return []
    step = max(1, int(round(interval_sec * fps)))
    return [i for i in range(step, total_frames, step)]


def scene_points(path: str, total_frames: int, fps: float, sensitivity: str = "medium") -> list[int]:
    """Detect scene cuts. Use pts_time (not showinfo n:) — n is renumbered after select."""
    if fps <= 0 or total_frames <= 0:
        return []
    thr = _SCENE_THR.get(sensitivity, 0.3)
    ffmpeg, _ = require_ffmpeg()
    cmd = [
        ffmpeg, "-hide_banner", "-i", path,
        "-filter:v", f"select='gt(scene,{thr})',showinfo",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    frames = []
    # showinfo n: is the output index after select (0,1,2...), not the source frame.
    # pts_time is the original presentation timestamp — convert to frame index.
    for m in re.finditer(r"pts_time:(?P<t>[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", proc.stderr or ""):
        t = float(m.group("t"))
        if t < 0:
            continue
        frames.append(int(round(t * fps)))
    return normalize_points(frames, total_frames)
