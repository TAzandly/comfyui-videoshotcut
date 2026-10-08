# ComfyUI-VideoShotCut

Frame-accurate video shot cutting inside ComfyUI: in-node timeline preview, manual/auto cut points, and MP4 segment export with audio (optional first-frame PNGs).

## Features

- Load video from `input/` (**choose file to upload**) or connect upstream **VIDEO**
- Timeline: scrub playhead, double-click to add cuts, drag markers, zoom, play with audio
- Right-click: scene detect (low/mid/high), fixed-interval splits, delete / clear cuts
- Each Queue run exports into one folder: `output/videoshotcut/{prefix}_#####/`
- Optional **export_first_frame** writes `{prefix}_000.png`, `_001.png`, … next to the MP4s
- Outputs: **file_paths**, **first_frame_paths** (one path per line)
- Progress bar and console logs while exporting (frame-accurate export can take a while)

## Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- **ffmpeg** and **ffprobe** on system `PATH`
  - Windows: [ffmpeg.org](https://ffmpeg.org/download.html) or `winget install Gyan.FFmpeg`
- No mandatory Python packages (`requirements.txt` is empty for v1)

## Install

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/TAzandly/comfyui-videoshotcut.git
```

Restart ComfyUI fully. Node menu: **video/shotcut** → **Video Shot Cut**.

### ComfyUI Manager / Extensions

Search **ComfyUI-VideoShotCut** / `comfyui-videoshotcut` in Extensions after Registry publish.

## Usage

1. Put a video in ComfyUI **input**, or use **choose file to upload**, or connect **VIDEO**.
2. Edit cuts on the timeline:
   - **Double-click** the track to add a cut at the playhead
   - **Drag** orange markers / white playhead
   - **Right-click** for auto scene / interval / delete / clear
   - Mouse wheel to zoom; **Fit** resets zoom
3. Set **filename_prefix** (default folder `output/videoshotcut/{prefix}_#####/`).
4. Enable **export_first_frame** if you need each shot's first frame as PNG.
5. **Queue Prompt**. Watch progress; results appear in **file_paths** / **first_frame_paths**.

> At least one cut point is required, or the node raises: `请至少添加一个切点` (Please add at least one cut point).

### Example workflow

Load [`example_workflows/shotcut_basic.json`](example_workflows/shotcut_basic.json), pick a **video_file**, add cuts, then Queue.

### Tips

| Topic | Note |
|--------|------|
| **fps** `0` | Use source fps. Set e.g. `24` to edit/export on a 24fps timeline. |
| Preview vs Queue | Timeline preview uses **video_file**. Queue can still use connected **VIDEO**. |
| Slow export | Frame-accurate path decodes with filters; long clips need time — progress is shown. |
| Prefix | Letters, digits, `_`, `-`. Optional subpath: `jobs/clip`. |

## Node I/O

| Input | Type | Description |
|--------|------|-------------|
| `video_file` | combo + upload | File under `input/` |
| `video` | VIDEO (optional) | Preferred when connected |
| `split_points` | STRING (hidden UI) | Timeline JSON managed by the widget |
| `filename_prefix` | STRING | Output name / subfolder stem |
| `fps` | FLOAT | `0` = source fps |
| `export_first_frame` | BOOLEAN | Also write first-frame PNGs |

| Output | Type | Description |
|---------|------|-------------|
| `file_paths` | STRING | Exported MP4 paths, one per line |
| `first_frame_paths` | STRING | PNG paths (empty if disabled) |

## Development

```bash
cd comfyui-videoshotcut
pytest -q
```

## License

[MIT](LICENSE)
