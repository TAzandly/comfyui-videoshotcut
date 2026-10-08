import logging
import os
import re
import shutil
import subprocess
import tempfile

import comfy.utils
import folder_paths

from .ffmpeg_util import require_ffmpeg
from .frames import extract_frame_range_dir
from .points import segment_ranges

_PREFIX_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_SUB_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_log = logging.getLogger("videoshotcut")


def resolve_export_dir(filename_prefix: str) -> tuple[str, str]:
    """
    Create a unique run folder under output/ and return (run_dir, stem).
    Default layout: output/videoshotcut/{stem}_{#####}/
    Prefix may include one subfolder path, e.g. "myjob/clip".
    """
    output_dir = folder_paths.get_output_directory()
    prefix = (filename_prefix or "shotcut").replace("\\", "/").strip("/")
    if not prefix:
        prefix = "shotcut"
    if "/" not in prefix:
        prefix = f"videoshotcut/{prefix}"

    parts = [p for p in prefix.split("/") if p]
    if not parts:
        raise ValueError("Invalid export prefix")
    stem = parts[-1]
    sub_parts = parts[:-1]
    if not _PREFIX_RE.fullmatch(stem):
        raise ValueError("Invalid export prefix: use only letters, digits, underscore, and hyphen")
    for p in sub_parts:
        if p in (".", "..") or not _SUB_RE.fullmatch(p):
            raise ValueError("Invalid export subfolder in prefix")

    base = os.path.join(output_dir, *sub_parts) if sub_parts else output_dir
    if not folder_paths.is_within_directory(output_dir, base):
        raise ValueError("Export path escapes output directory")
    os.makedirs(base, exist_ok=True)

    counter = 1
    try:
        for entry in os.listdir(base):
            m = re.fullmatch(rf"{re.escape(stem)}_(\d+)", entry)
            if m and os.path.isdir(os.path.join(base, entry)):
                counter = max(counter, int(m.group(1)) + 1)
    except FileNotFoundError:
        pass

    run_dir = os.path.join(base, f"{stem}_{counter:05}")
    os.makedirs(run_dir, exist_ok=True)
    return run_dir, stem


def export_segments(
    path: str,
    points: list[int],
    total_frames: int,
    fps: float,
    has_audio: bool,
    output_dir: str,
    prefix: str,
    source_fps: float | None = None,
    source_total_frames: int = 0,
    export_first_frame: bool = False,
) -> tuple[list[str], list[str]]:
    if fps <= 0:
        raise ValueError("fps must be positive to export segments")
    if os.path.sep in prefix or "/" in prefix or "\\" in prefix or ".." in prefix:
        raise ValueError("Invalid export prefix: must not contain path separators or '..'")
    if not _PREFIX_RE.fullmatch(prefix or ""):
        raise ValueError("Invalid export prefix: use only letters, digits, underscore, and hyphen")
    os.makedirs(output_dir, exist_ok=True)
    ffmpeg, _ = require_ffmpeg()
    src_fps = float(source_fps) if source_fps and source_fps > 0 else float(fps)
    ranges = segment_ranges(points, total_frames)
    n = len(ranges)
    # Two steps per segment: extract frames + mux/encode
    pbar = comfy.utils.ProgressBar(max(1, n * 2))
    videos: list[str] = []
    first_frames: list[str] = []
    for i, (start, end) in enumerate(ranges):
        start_t = start / fps
        dur = (end - start) / fps
        out_path = os.path.join(output_dir, f"{prefix}_{i:03d}.mp4")
        _log.info(
            "videoshotcut: segment %d/%d frames [%d,%d) -> %s",
            i + 1, n, start, end, os.path.basename(out_path),
        )
        print(f"[videoshotcut] ({i + 1}/{n}) extracting frames {start}-{end}...")
        with tempfile.TemporaryDirectory() as td:
            frames_dir = extract_frame_range_dir(
                path, start, end, fps, os.path.join(td, "frames"),
                source_fps=src_fps,
                source_total_frames=source_total_frames,
            )
            pbar.update(1)
            if export_first_frame:
                src_png = os.path.join(frames_dir, "000001.png")
                if os.path.isfile(src_png):
                    png_path = os.path.join(output_dir, f"{prefix}_{i:03d}.png")
                    shutil.copyfile(src_png, png_path)
                    first_frames.append(png_path)
                    print(f"[videoshotcut] ({i + 1}/{n}) first frame: {os.path.basename(png_path)}")
            pattern = os.path.join(frames_dir, "%06d.png")
            print(f"[videoshotcut] ({i + 1}/{n}) encoding {os.path.basename(out_path)}...")
            cmd = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", str(fps), "-i", pattern,
            ]
            if has_audio:
                cmd += ["-ss", f"{start_t:.6f}", "-t", f"{dur:.6f}", "-i", path]
                cmd += [
                    "-map", "0:v:0", "-map", "1:a:0?",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", out_path,
                ]
            else:
                cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", out_path]
            subprocess.check_call(cmd)
            pbar.update(1)
        videos.append(out_path)
        print(f"[videoshotcut] ({i + 1}/{n}) done: {out_path}")
    return videos, first_frames
