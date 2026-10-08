import io
import json
import os
import shutil
import uuid

import folder_paths

from ..core.export import export_segments, resolve_export_dir
from ..core.media import probe_media
from ..core.paths import resolve_safe_media_path
from ..core.points import parse_split_points
from ..core.timeline import resolve_timeline


def _ensure_allowed_path(path: str) -> str:
    try:
        return resolve_safe_media_path(path)
    except ValueError as e:
        if not str(e).startswith("Path not allowed"):
            raise
        if not os.path.isfile(path):
            raise
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        ext = os.path.splitext(path)[1] or ".mp4"
        dest = os.path.join(temp_dir, f"videoshotcut_{uuid.uuid4().hex}{ext}")
        shutil.copy2(path, dest)
        return resolve_safe_media_path(dest)


def _video_to_path(video):
    if video is None:
        return None
    if hasattr(video, "get_stream_source"):
        src = video.get_stream_source()
        if isinstance(src, str):
            return src
        if isinstance(src, io.BytesIO):
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            dest = os.path.join(temp_dir, f"videoshotcut_{uuid.uuid4().hex}.mp4")
            src.seek(0)
            with open(dest, "wb") as f:
                shutil.copyfileobj(src, f)
            return dest
    if hasattr(video, "path") and isinstance(video.path, str):
        return video.path
    raise ValueError("Unsupported VIDEO input; use video_file")


def _list_input_videos() -> list[str]:
    input_dir = folder_paths.get_input_directory()
    files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
    if hasattr(folder_paths, "filter_files_content_types"):
        files = folder_paths.filter_files_content_types(files, ["video"])
    return sorted(files)


class VideoShotCut:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_file": (_list_input_videos() + ["none"], {"video_upload": True}),
                "split_points": (
                    "STRING",
                    {
                        "default": '{"version":1,"fps":0,"total_frames":0,"points":[]}',
                        "multiline": True,
                    },
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "shotcut",
                        "tooltip": "Run folder under output/videoshotcut/{prefix}_#####/ (or use sub/path).",
                    },
                ),
                "fps": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 240.0,
                        "step": 0.01,
                        "tooltip": "0 = use source fps. Set e.g. 24 to edit/export on a 24fps timeline.",
                    },
                ),
                "export_first_frame": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Also save each shot's first frame as PNG in the same folder.",
                    },
                ),
            },
            "optional": {
                "video": ("VIDEO",),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("file_paths", "first_frame_paths")
    FUNCTION = "run"
    CATEGORY = "video/shotcut"
    OUTPUT_NODE = True

    def run(self, video_file, split_points, filename_prefix, fps=0.0, export_first_frame=False, video=None):
        path = None
        if video is not None:
            path = _video_to_path(video)
        if not path and video_file and video_file != "none":
            path = folder_paths.get_annotated_filepath(video_file)
        if not path:
            raise ValueError("No video source")

        path = _ensure_allowed_path(path)
        info = probe_media(path)
        tl = resolve_timeline(info, float(fps or 0))
        try:
            raw = json.loads(split_points) if split_points and str(split_points).strip() else {}
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid split_points JSON: {e}") from e
        if not isinstance(raw, dict):
            raw = {}
        # Node fps widget is authoritative for the working timeline
        raw["fps"] = tl["fps"]
        raw["total_frames"] = tl["total_frames"]
        data = parse_split_points(json.dumps(raw), require_nonempty=True)

        out_dir, stem = resolve_export_dir(filename_prefix)
        print(
            f"[videoshotcut] exporting {len(data['points']) + 1} segments "
            f"@ {data['fps']:.3f}fps -> {out_dir}"
        )
        paths, first_frames = export_segments(
            path,
            data["points"],
            data["total_frames"],
            data["fps"],
            tl["has_audio"],
            out_dir,
            stem,
            source_fps=tl["source_fps"],
            source_total_frames=tl["source_total_frames"],
            export_first_frame=bool(export_first_frame),
        )
        joined = "\n".join(paths)
        frames_joined = "\n".join(first_frames)
        print(
            f"[videoshotcut] finished {len(paths)} video(s)"
            + (f", {len(first_frames)} first-frame PNG(s)" if first_frames else "")
            + f" in {out_dir}"
        )
        ui_text = joined if not frames_joined else f"{joined}\n---\n{frames_joined}"
        return {"ui": {"text": [ui_text]}, "result": (joined, frames_joined)}