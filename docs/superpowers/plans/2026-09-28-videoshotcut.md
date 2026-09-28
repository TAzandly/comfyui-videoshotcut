# VideoShotCut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `comfyui-videoshotcut` — a ComfyUI custom node with an in-node timeline for frame-accurate video splits (preview + auto/manual cuts) that exports multiple `.mp4` files with audio.

**Architecture:** Classic custom-node package (`NODE_CLASS_MAPPINGS` + `WEB_DIRECTORY`) with aiohttp routes under `/videoshotcut/*` for info/preview/detect, pure Python core for cut math + ffmpeg export, and a LiteGraph DOM widget for the timeline UI. Cut points are frame indices stored in a JSON string widget.

**Tech Stack:** Python 3, ffmpeg/ffprobe (CLI), aiohttp (via ComfyUI `PromptServer`), vanilla JS ComfyUI frontend extension (`app.registerExtension`), optional OpenCV only if already present — v1 scene detect uses ffmpeg frame sampling + histogram/frame-diff in numpy/PIL to avoid new heavy deps when possible.

**Spec:** `docs/superpowers/specs/2026-09-28-comfyui-videoshotcut-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `__init__.py` | Export mappings, `WEB_DIRECTORY`, register routes |
| `pyproject.toml` | Package + Comfy Registry metadata |
| `requirements.txt` | Runtime Python deps (minimal) |
| `LICENSE` | MIT |
| `README.md` | Install, ffmpeg, usage, Manager notes |
| `core/__init__.py` | Package marker |
| `core/paths.py` | Safe path resolve under input/output/temp |
| `core/points.py` | Parse/normalize split JSON, segment ranges |
| `core/media.py` | ffprobe info; resolve VIDEO / file to path |
| `core/frames.py` | Extract single preview frame; extract frame range |
| `core/detect.py` | Scene detect + fixed-interval points |
| `core/export.py` | Segment frames + audio → mp4 via ffmpeg |
| `nodes/video_shotcut.py` | `VideoShotCut` node class |
| `server/routes.py` | `/videoshotcut/info|frame|detect/*` |
| `js/videoshotcut.js` | Timeline widget + preview + context menu |
| `tests/test_points.py` | Unit tests for cut math |
| `tests/test_paths.py` | Unit tests for path safety |
| `example_workflows/shotcut_basic.json` | Minimal example (optional late) |

---

### Task 1: Package skeleton + path/points core (TDD)

**Files:**
- Create: `core/__init__.py`, `core/paths.py`, `core/points.py`
- Create: `tests/test_points.py`, `tests/test_paths.py`
- Create: `requirements.txt`, `LICENSE`, `pyproject.toml`

- [ ] **Step 1: Write failing tests for points**

Create `tests/test_points.py`:

```python
import json
import pytest
from core.points import parse_split_points, normalize_points, segment_ranges, EMPTY_POINTS_MSG


def test_empty_points_raises():
    with pytest.raises(ValueError, match=EMPTY_POINTS_MSG):
        parse_split_points('{"version":1,"fps":24,"total_frames":100,"points":[]}', require_nonempty=True)


def test_normalize_sort_dedupe_and_bounds():
    assert normalize_points([90, 10, 10, 0, 100, -1, 50], total_frames=100) == [10, 50, 90]


def test_segment_ranges():
    assert segment_ranges([10, 50], total_frames=100) == [(0, 10), (10, 50), (50, 100)]


def test_parse_roundtrip():
    raw = json.dumps({"version": 1, "fps": 30.0, "total_frames": 60, "points": [20, 40]})
    data = parse_split_points(raw, require_nonempty=True)
    assert data["fps"] == 30.0
    assert data["points"] == [20, 40]
```

- [ ] **Step 2: Write failing tests for paths**

Create `tests/test_paths.py`:

```python
import os
import pytest
from core.paths import resolve_safe_media_path


def test_rejects_traversal(tmp_path, monkeypatch):
    root = tmp_path / "input"
    root.mkdir()
    monkeypatch.setattr("core.paths.get_allowed_roots", lambda: [str(root)])
    with pytest.raises(ValueError):
        resolve_safe_media_path(str(tmp_path / "secret.mp4"))


def test_accepts_file_inside_root(tmp_path, monkeypatch):
    root = tmp_path / "input"
    root.mkdir()
    f = root / "a.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr("core.paths.get_allowed_roots", lambda: [str(root)])
    assert resolve_safe_media_path(str(f)) == os.path.abspath(str(f))
```

- [ ] **Step 3: Run tests — expect fail**

Run: `cd custom_nodes/comfyui-videoshotcut && python -m pytest tests/test_points.py tests/test_paths.py -v`  
Expected: import/collection errors (modules missing)

- [ ] **Step 4: Implement `core/points.py`**

```python
import json

EMPTY_POINTS_MSG = "请至少添加一个切点"


def normalize_points(points, total_frames: int) -> list[int]:
    out = sorted({int(p) for p in points if 0 < int(p) < int(total_frames)})
    return out


def segment_ranges(points: list[int], total_frames: int) -> list[tuple[int, int]]:
    cuts = normalize_points(points, total_frames)
    bounds = [0] + cuts + [int(total_frames)]
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1) if bounds[i] < bounds[i + 1]]


def parse_split_points(raw: str, require_nonempty: bool = False) -> dict:
    if not raw or not str(raw).strip():
        data = {"version": 1, "fps": 0.0, "total_frames": 0, "points": []}
    else:
        data = json.loads(raw)
    points = normalize_points(data.get("points") or [], int(data.get("total_frames") or 0) or 10**12)
    data["points"] = points
    data["version"] = int(data.get("version") or 1)
    data["fps"] = float(data.get("fps") or 0.0)
    data["total_frames"] = int(data.get("total_frames") or 0)
    if require_nonempty and not points:
        raise ValueError(EMPTY_POINTS_MSG)
    return data
```

- [ ] **Step 5: Implement `core/paths.py`**

```python
import os
import folder_paths


def get_allowed_roots() -> list[str]:
    return [
        os.path.abspath(folder_paths.get_input_directory()),
        os.path.abspath(folder_paths.get_output_directory()),
        os.path.abspath(folder_paths.get_temp_directory()),
    ]


def resolve_safe_media_path(path: str) -> str:
    if not path:
        raise ValueError("Empty media path")
    # Support Comfy annotated / relative input names
    if not os.path.isabs(path) and hasattr(folder_paths, "get_annotated_filepath"):
        try:
            path = folder_paths.get_annotated_filepath(path)
        except Exception:
            path = os.path.join(folder_paths.get_input_directory(), path)
    abspath = os.path.abspath(path)
    if not os.path.isfile(abspath):
        raise ValueError(f"Media file not found: {path}")
    for root in get_allowed_roots():
        try:
            if os.path.commonpath([root, abspath]) == root:
                return abspath
        except ValueError:
            continue
    raise ValueError(f"Path not allowed: {path}")
```

Create empty `core/__init__.py`.

- [ ] **Step 6: Run tests — expect pass**

For `test_paths`, if importing `folder_paths` fails outside Comfy, add `conftest.py` that stubs `folder_paths` before import, or run with `PYTHONPATH` including ComfyUI root.

Minimal `tests/conftest.py` stub when needed:

```python
import sys
import types

if "folder_paths" not in sys.modules:
    m = types.ModuleType("folder_paths")
    m.get_input_directory = lambda: "."
    m.get_output_directory = lambda: "."
    m.get_temp_directory = lambda: "."
    m.get_annotated_filepath = lambda p: p
    sys.modules["folder_paths"] = m
```

Run: `python -m pytest tests/test_points.py tests/test_paths.py -v`  
Expected: PASS

- [ ] **Step 7: Add package metadata stubs**

`requirements.txt`:

```
# System ffmpeg/ffprobe required. No mandatory PyPI deps for v1.
```

`pyproject.toml`:

```toml
[project]
name = "comfyui-videoshotcut"
description = "Timeline video shot-cut node: auto/manual splits, frame preview, export mp4 segments with audio."
version = "0.1.0"
license = { file = "LICENSE" }
dependencies = []

[project.urls]
Repository = "https://github.com/YOUR_GITHUB_USERNAME/comfyui-videoshotcut"

[tool.comfy]
PublisherId = "YOUR_PUBLISHER_ID"
DisplayName = "ComfyUI-VideoShotCut"
Icon = ""
```

`LICENSE`: MIT text with copyright year 2026.

- [ ] **Step 8: Commit**

```bash
git add core tests requirements.txt pyproject.toml LICENSE
git commit -m "Add points/paths core and package metadata"
```

---

### Task 2: Media probe + frame extract + export

**Files:**
- Create: `core/media.py`, `core/frames.py`, `core/export.py`, `core/ffmpeg_util.py`
- Create: `tests/test_segment_math.py` (pure helpers only if needed)

- [ ] **Step 1: Implement ffmpeg discovery**

`core/ffmpeg_util.py`:

```python
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
```

- [ ] **Step 2: Implement `core/media.py` probe**

```python
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
    # fps from avg_frame_rate like "30000/1001"
    rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1"
    num, den = rate.split("/")
    fps = float(num) / float(den) if float(den) else 0.0
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
```

- [ ] **Step 3: Implement preview frame extract**

`core/frames.py` — extract one JPEG to bytes or temp file using ffmpeg `-ss` + `-vframes 1` with frame-accurate seek (`-ss` after `-i` for accuracy on preview is OK; for export use frame-select filter).

```python
import os
import subprocess
import tempfile
from .ffmpeg_util import require_ffmpeg


def extract_frame_jpeg(path: str, frame_index: int, fps: float) -> bytes:
    ffmpeg, _ = require_ffmpeg()
    t = (frame_index + 0.0) / fps if fps > 0 else 0
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "f.jpg")
        # Accurate: input seek then 1 frame
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error",
            "-i", path, "-vf", f"select=eq(n\\,{int(frame_index)})",
            "-vframes", "1", "-q:v", "2", out,
        ]
        subprocess.check_call(cmd)
        with open(out, "rb") as f:
            return f.read()


def extract_frame_range_dir(path: str, start: int, end: int, fps: float, out_dir: str) -> str:
    """Write frames [start, end) as %06d.png into out_dir. Returns out_dir."""
    os.makedirs(out_dir, exist_ok=True)
    ffmpeg, _ = require_ffmpeg()
    # select between frames, reset PTS
    vf = f"select=between(n\\,{start}\\,{end - 1}),setpts=N/{fps}/TB" if fps > 0 else f"select=between(n\\,{start}\\,{end - 1}),setpts=N/FRAME_RATE/TB"
    pattern = os.path.join(out_dir, "%06d.png")
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-vf", vf, "-vsync", "0", pattern]
    subprocess.check_call(cmd)
    return out_dir
```

- [ ] **Step 4: Implement `core/export.py`**

```python
import os
import subprocess
import tempfile
from .ffmpeg_util import require_ffmpeg
from .frames import extract_frame_range_dir
from .points import segment_ranges


def export_segments(path: str, points: list[int], total_frames: int, fps: float,
                    has_audio: bool, output_dir: str, prefix: str) -> list[str]:
    ffmpeg, _ = require_ffmpeg()
    ranges = segment_ranges(points, total_frames)
    results = []
    for i, (start, end) in enumerate(ranges):
        start_t = start / fps
        dur = (end - start) / fps
        out_path = os.path.join(output_dir, f"{prefix}_{i:03d}.mp4")
        with tempfile.TemporaryDirectory() as td:
            frames_dir = extract_frame_range_dir(path, start, end, fps, os.path.join(td, "frames"))
            # Build video from PNG sequence
            pattern = os.path.join(frames_dir, "%06d.png")
            cmd = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", str(fps), "-i", pattern,
            ]
            if has_audio:
                cmd += ["-ss", str(start_t), "-t", str(dur), "-i", path]
                cmd += ["-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-shortest", out_path]
            else:
                cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", out_path]
            subprocess.check_call(cmd)
        results.append(out_path)
    return results
```

- [ ] **Step 5: Manual smoke (optional if ffmpeg available)**

Place a short mp4 under Comfy `input/`, call `probe_media` + `export_segments` with one cut in a Python REPL.  
Expected: two mp4 files with roughly correct durations.

- [ ] **Step 6: Commit**

```bash
git add core
git commit -m "Add ffmpeg media probe, frame extract, and segment export"
```

---

### Task 3: Scene / interval detection

**Files:**
- Create: `core/detect.py`
- Create: `tests/test_detect_interval.py`

- [ ] **Step 1: Failing test for interval splits**

```python
from core.detect import interval_points


def test_interval_points_every_1s_at_24fps():
    # 5 seconds, 24fps -> frames 24,48,72,96 inside (0,120)
    assert interval_points(total_frames=120, fps=24.0, interval_sec=1.0) == [24, 48, 72, 96]
```

- [ ] **Step 2: Implement interval + scene detect**

```python
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
    thr = _SCENE_THR.get(sensitivity, 0.3)
    ffmpeg, _ = require_ffmpeg()
    cmd = [
        ffmpeg, "-hide_banner", "-i", path,
        "-filter:v", f"select='gt(scene,{thr})',showinfo",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    frames = []
    for m in re.finditer(r"n:\s*(\d+)", proc.stderr or ""):
        frames.append(int(m.group(1)))
    return normalize_points(frames, total_frames)
```

Prefer ffmpeg scene filter over new Python deps.

- [ ] **Step 3: pytest + commit**

```bash
git add core/detect.py tests/test_detect_interval.py
git commit -m "Add interval and scene cut detection"
```

---

### Task 4: HTTP routes

**Files:**
- Create: `server/__init__.py`, `server/routes.py`
- Modify: (later) `__init__.py` to call `register_routes()`

- [ ] **Step 1: Implement routes**

```python
from aiohttp import web
from server import PromptServer
from ..core.paths import resolve_safe_media_path
from ..core.media import probe_media
from ..core.frames import extract_frame_jpeg
from ..core.detect import scene_points, interval_points


def register_routes():
    routes = PromptServer.instance.routes

    @routes.get("/videoshotcut/info")
    async def info(request):
        path = resolve_safe_media_path(request.rel_url.query.get("path", ""))
        return web.json_response(probe_media(path))

    @routes.get("/videoshotcut/frame")
    async def frame(request):
        q = request.rel_url.query
        path = resolve_safe_media_path(q.get("path", ""))
        idx = int(q.get("frame_index", "0"))
        info = probe_media(path)
        data = extract_frame_jpeg(path, idx, info["fps"])
        return web.Response(body=data, content_type="image/jpeg")

    @routes.post("/videoshotcut/detect/scenes")
    async def detect_scenes(request):
        body = await request.json()
        path = resolve_safe_media_path(body["path"])
        info = probe_media(path)
        pts = scene_points(path, info["total_frames"], info["fps"], body.get("sensitivity", "medium"))
        return web.json_response({"points": pts, **{k: info[k] for k in ("fps", "total_frames")}})

    @routes.post("/videoshotcut/detect/interval")
    async def detect_interval(request):
        body = await request.json()
        path = resolve_safe_media_path(body["path"])
        info = probe_media(path)
        pts = interval_points(info["total_frames"], info["fps"], float(body.get("interval_sec", 5)))
        return web.json_response({"points": pts, **{k: info[k] for k in ("fps", "total_frames")}})
```

- [ ] **Step 2: Commit**

```bash
git add server
git commit -m "Add videoshotcut HTTP preview and detect routes"
```

---

### Task 5: Node class + `__init__.py`

**Files:**
- Create: `nodes/__init__.py`, `nodes/video_shotcut.py`
- Create: `__init__.py`

- [ ] **Step 1: Implement node (classic API for VHS-like compatibility)**

```python
import json
import os
import folder_paths
from ..core.points import parse_split_points, EMPTY_POINTS_MSG
from ..core.paths import resolve_safe_media_path
from ..core.media import probe_media
from ..core.export import export_segments


def _video_to_path(video):
    # VideoFromFile exposes .get_stream_source() or similar — adapt to installed ComfyAPI
    if video is None:
        return None
    if hasattr(video, "get_stream_source"):
        src = video.get_stream_source()
        if isinstance(src, str):
            return src
    if hasattr(video, "path"):
        return video.path
    raise ValueError("Unsupported VIDEO input; use video_file")


class VideoShotCut:
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["video"]) if hasattr(folder_paths, "filter_files_content_types") else files
        return {
            "required": {
                "video_file": (sorted(files) + ["none"],),
                "split_points": ("STRING", {"default": '{"version":1,"fps":0,"total_frames":0,"points":[]}', "multiline": True}),
                "filename_prefix": ("STRING", {"default": "shotcut"}),
            },
            "optional": {
                "video": ("VIDEO",),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_paths",)
    FUNCTION = "run"
    CATEGORY = "video/shotcut"
    OUTPUT_NODE = True

    def run(self, video_file, split_points, filename_prefix, video=None):
        path = None
        if video is not None:
            path = _video_to_path(video)
        if not path and video_file and video_file != "none":
            path = folder_paths.get_annotated_filepath(video_file)
        if not path:
            raise ValueError("No video source")
        path = resolve_safe_media_path(path)
        info = probe_media(path)
        data = parse_split_points(split_points, require_nonempty=True)
        if data["total_frames"] <= 0:
            data["total_frames"] = info["total_frames"]
        if data["fps"] <= 0:
            data["fps"] = info["fps"]
        out_dir = folder_paths.get_output_directory()
        paths = export_segments(
            path, data["points"], data["total_frames"], data["fps"],
            info["has_audio"], out_dir, filename_prefix,
        )
        return ("\n".join(paths),)
```

- [ ] **Step 2: `__init__.py`**

```python
from .nodes.video_shotcut import VideoShotCut
from .server.routes import register_routes

NODE_CLASS_MAPPINGS = {
    "VideoShotCut": VideoShotCut,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "VideoShotCut": "Video Shot Cut",
}
WEB_DIRECTORY = "./js"

register_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
```

- [ ] **Step 3: Restart ComfyUI, confirm node appears under `video/shotcut`**

Expected: node loads; empty points → error `请至少添加一个切点` when queued.

- [ ] **Step 4: Commit**

```bash
git add nodes __init__.py
git commit -m "Add VideoShotCut node and package entrypoint"
```

---

### Task 6: Frontend timeline widget

**Files:**
- Create: `js/videoshotcut.js`

- [ ] **Step 1: Register extension that replaces/augments `VideoShotCut`**

Pattern (Comfy frontend):

```javascript
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
  name: "comfyui.videoshotcut",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "VideoShotCut") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      addTimelineWidget(this);
      return r;
    };
  },
});

function addTimelineWidget(node) {
  // DOM widget: preview <img>, canvas/div timeline, playhead, markers
  // Hide raw split_points multiline or keep collapsed
  // On drag: GET /videoshotcut/frame?path=...&frame_index=...
  // On double-click: insert point; write JSON into split_points widget
  // Context menu: scenes / interval / clear / delete marker
}
```

Concrete UI behaviors from spec:
- Double-click empty area → add cut
- Drag marker → update frame index + preview
- Drag playhead → preview only (does not add cut)
- Right-click → auto scene (low/med/high), fixed duration prompt, clear all, delete marker
- Persist via `widget.value = JSON.stringify({version:1,fps,total_frames,points})`

Path for API: from `video_file` widget value (input name). If only upstream VIDEO connected, show message that preview needs a file path in v1 **or** add a small API that accepts executed path — for v1 document that timeline preview uses `video_file`; upstream VIDEO still works at Queue time.

- [ ] **Step 2: Manual UI test in browser**

Load node, pick a video, scrub, add cuts, right-click interval split, Queue → multiple mp4s.

- [ ] **Step 3: Commit**

```bash
git add js
git commit -m "Add timeline widget with preview and auto-split menu"
```

---

### Task 7: README + example workflow + registry polish

**Files:**
- Create: `README.md`, `example_workflows/shotcut_basic.json`
- Modify: `pyproject.toml` (real PublisherId/Repo when known)

- [ ] **Step 1: README sections** — install (git clone into `custom_nodes`), ffmpeg requirement, usage, Manager/registry publish steps (create publisher on registry.comfy.org, fill `PublisherId`, publish).

- [ ] **Step 2: Example workflow JSON** exporting one VideoShotCut (may be minimal).

- [ ] **Step 3: Commit**

```bash
git add README.md example_workflows pyproject.toml
git commit -m "Add README, example workflow, and registry metadata notes"
```

---

### Task 8: End-to-end verification

- [ ] Restart ComfyUI, confirm no import errors for `comfyui-videoshotcut`
- [ ] Upload short clip with audio → timeline preview works
- [ ] Manual cuts + interval + scene detect
- [ ] Queue with no cuts → `请至少添加一个切点`
- [ ] Queue with cuts → `shotcut_000.mp4`, `shotcut_001.mp4`, … with audio
- [ ] Fix any bugs found; commit: `Fix ...`

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Timeline + markers + drag | 6 |
| Right-click auto scene / interval / clear / delete | 6 |
| Manual add (double-click) | 6 |
| Frame preview on scrub | 4 + 6 |
| File + VIDEO inputs | 5 |
| Output mp4 + audio to output/ | 2 + 5 |
| Empty points error message | 1 + 5 |
| Frame-index storage | 1 |
| Path safety | 1 + 4 |
| GitHub + Manager pyproject | 1 + 7 |
| No stream copy / frame-accurate | 2 |

## Notes for implementers

- Prefer classic `NODE_CLASS_MAPPINGS` (matches VHS); do not require V3 `ComfyExtension` unless needed.
- Do not add telemetry or outbound network.
- Keep ffmpeg as the only hard system dependency.
- Replace `YOUR_GITHUB_USERNAME` / `YOUR_PUBLISHER_ID` before publishing; not required for local dev.
