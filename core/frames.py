import os
import shutil
import subprocess
import tempfile
from .ffmpeg_util import require_ffmpeg
from .timeline import timeline_to_source_frame


def extract_frame_jpeg(
    path: str,
    frame_index: int,
    fps: float,
    source_fps: float | None = None,
    source_total_frames: int = 0,
    scale_max: int = 640,
) -> bytes:
    """
    Frame-accurate preview: decode with select=eq(n,SRC) on the source bitstream.
    Do not use input -ss here — after a seek, filter n resets and the same frame
    index would map to different pictures.
    """
    ffmpeg, _ = require_ffmpeg()
    src_fps = float(source_fps) if source_fps and source_fps > 0 else float(fps or 0)
    src_n = timeline_to_source_frame(
        int(frame_index), float(fps or 0), src_fps, int(source_total_frames or 0),
    )
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "f.jpg")
        vf = f"select=eq(n\\,{src_n})"
        if scale_max and scale_max > 0:
            vf = f"{vf},scale='min({int(scale_max)}\\,iw)':-2"
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error",
            "-i", path,
            "-vf", vf,
            "-vsync", "0",
            "-vframes", "1",
            "-q:v", "3",
            out,
        ]
        subprocess.check_call(cmd)
        with open(out, "rb") as f:
            return f.read()


def extract_frame_range_dir(
    path: str,
    start: int,
    end: int,
    fps: float,
    out_dir: str,
    source_fps: float | None = None,
    source_total_frames: int = 0,
) -> str:
    """
    Write working-timeline frames [start, end) as 000001.png...
    Maps each timeline frame to a source frame (duplicate/drop when fps differs).
    """
    os.makedirs(out_dir, exist_ok=True)
    if end <= start:
        return out_dir

    ffmpeg, _ = require_ffmpeg()
    src_fps = float(source_fps) if source_fps and source_fps > 0 else float(fps or 0)
    src_start = timeline_to_source_frame(start, fps, src_fps, source_total_frames)
    src_end_inclusive = timeline_to_source_frame(max(start, end - 1), fps, src_fps, source_total_frames)
    if src_end_inclusive < src_start:
        src_end_inclusive = src_start

    tmp_src = os.path.join(out_dir, "_src")
    os.makedirs(tmp_src, exist_ok=True)
    vf = f"select=between(n\\,{src_start}\\,{src_end_inclusive}),setpts=N/FRAME_RATE/TB"
    pattern = os.path.join(tmp_src, "%06d.png")
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-i", path, "-vf", vf, "-vsync", "0", pattern,
    ]
    subprocess.check_call(cmd)

    out_i = 1
    for t_frame in range(start, end):
        src_n = timeline_to_source_frame(t_frame, fps, src_fps, source_total_frames)
        rel = src_n - src_start  # 0-based within extracted span
        src_file = os.path.join(tmp_src, f"{rel + 1:06d}.png")
        if not os.path.isfile(src_file):
            alt = os.path.join(tmp_src, f"{rel:06d}.png")
            if os.path.isfile(alt):
                src_file = alt
        dest = os.path.join(out_dir, f"{out_i:06d}.png")
        if os.path.isfile(src_file):
            shutil.copyfile(src_file, dest)
        out_i += 1

    shutil.rmtree(tmp_src, ignore_errors=True)
    return out_dir
