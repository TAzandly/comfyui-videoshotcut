# ComfyUI-VideoShotCut

å¨ ComfyUI éå**å¸§ç²¾ç¡®**è§é¢éå¤´ååï¼èç¹åæ¶é´è½´é¢è§ãæå¨/èªå¨åç¹ï¼Queue åå¯¼åºå¸¦é³è½¨ç MP4 çæ®µï¼å¯éå¯¼åºæ¯éå¤´é¦å¸§ PNGï¼ã

Frame-accurate video shot cutting inside ComfyUI: in-node timeline, manual/auto cuts, export MP4 segments with audio (optional first-frame PNGs).

## Features / åè½

- Load video from `input/` (**choose file to upload**) or connect upstream **VIDEO**
- Timeline: scrub playhead, double-click to add cuts, drag markers, zoom, play with audio
- Right-click: scene detect (low/mid/high), fixed-interval splits, delete / clear cuts
- Export each Queue run into one folder: `output/videoshotcut/{prefix}_#####/`
- Optional **export_first_frame** â `{prefix}_000.png`, `_001.png`, â¦ next to the MP4s
- Outputs: **file_paths**, **first_frame_paths** (one path per line)
- Progress bar + console logs while exporting (frame-accurate export can take a while)

## Requirements / ç¯å¢

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- **ffmpeg** and **ffprobe** on system `PATH`  
  - Windows: [ffmpeg.org](https://ffmpeg.org/download.html) or `winget install Gyan.FFmpeg`
- No mandatory Python packages (`requirements.txt` is empty for v1)

## Install / å®è£

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/TAzandly/comfyui-videoshotcut.git
```

Restart ComfyUI fully. Node menu: **video/shotcut** â **Video Shot Cut**.

### ComfyUI Manager

After registry publish, search **ComfyUI-VideoShotCut** / `comfyui-videoshotcut`.

## Usage / ä½¿ç¨

1. Put a video in ComfyUI **input**, or use **choose file to upload**, or connect **VIDEO**.
2. Edit cuts on the timeline:
   - **Double-click** track â add cut at playhead
   - **Drag** orange markers / white playhead
   - **Right-click** â auto scene / interval / delete / clear
   - Mouse wheel â zoom timeline; **Fit** resets zoom
3. Set **filename_prefix** (default folder `output/videoshotcut/{prefix}_#####/`).
4. Turn on **export_first_frame** if you need each shotâs first frame as PNG.
5. **Queue Prompt**. Watch progress; results appear in **file_paths** / **first_frame_paths**.

> At least one cut point is required, or the node raises: `è¯·è³å°æ·»å ä¸ä¸ªåç¹`.

### Example workflow

Load [`example_workflows/shotcut_basic.json`](example_workflows/shotcut_basic.json), pick a **video_file**, add cuts, then Queue.

### Tips

| Topic | Note |
|--------|------|
| **fps** `0` | Use source fps. Set e.g. `24` to edit/export on a 24fps timeline. |
| Preview vs Queue | Timeline preview uses **video_file**. Queue can still use connected **VIDEO**. |
| Slow export | Frame-accurate path decodes with filters; long clips need time â progress is shown. |
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

## Development / å¼å

```bash
cd comfyui-videoshotcut
pytest -q
```

## License

[MIT](LICENSE)
