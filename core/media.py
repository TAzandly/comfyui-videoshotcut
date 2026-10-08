import json
import subprocess
from .ffmpeg_util import require_ffmpeg


def probe_media(path: str) -> dict:
    ffmpeg, ffprobe = require_ffmpeg()
    cmd = [
        ffprobe, "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ]
    out = subprocess.check_output(cmd)
    data = json.loads(out)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video:
        raise ValueError("No video stream")
    rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1"
    fps = 0.0
    if isinstance(rate, str) and "/" in rate:
        num_s, den_s = rate.split("/", 1)
        try:
            den = float(den_s)
            fps = float(num_s) / den if den else 0.0
        except ValueError:
            fps = 0.0
    else:
        try:
            fps = float(rate) if rate is not None else 0.0
        except (ValueError, TypeError):
            fps = 0.0
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    nb = video.get("nb_frames")
    total_frames = int(nb) if nb and str(nb).isdigit() else int(round(duration * fps)) if fps else 0
    return {
        "path": path,
        "fps": fps,
        "duration": duration,
        "total_frames": total_frames,
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "has_audio": audio is not None,
    }
