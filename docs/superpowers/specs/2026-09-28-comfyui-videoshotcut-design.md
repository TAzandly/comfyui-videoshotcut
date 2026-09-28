# comfyui-videoshotcut Design Spec

Date: 2026-09-28  
Plugin name: `comfyui-videoshotcut`  
Install path: `custom_nodes/comfyui-videoshotcut`

## Goal

A ComfyUI custom node that splits a video into multiple frame-accurate `.mp4` segments (with audio). Users edit cut points on an in-node timeline (drag markers, right-click auto-split, manual add). Dragging the playhead or a marker shows the current frame preview on the node. Queue exports segment files to ComfyUI `output/` and returns their paths.

## Non-goals (v1)

- Outputting ComfyUI `VIDEO` tensors for downstream nodes
- Stream-copy / keyframe-approximate cuts
- Full NLE features (transitions, trim handles, multi-track audio mix)
- Whole-video mandatory frame dump before every edit session

## Approach

Custom frontend timeline widget + backend preview/detect APIs + execute-time frame-accurate export via ffmpeg re-encode.

Internal cut points are stored as **frame indices** (integers). The UI may display timecode derived from fps.

## Architecture

Three layers inside the plugin package:

| Layer | Responsibility |
|---|---|
| Node | `VideoShotCut`: resolve video source, read `split_points`, export segments, return path list |
| Server | HTTP routes under `/videoshotcut/`: media info, frame preview, scene/interval detect |
| Frontend | `WEB_DIRECTORY` JS: timeline, markers, context menu, preview image, write widget state |

### Data flow

1. User selects a file on the node and/or connects upstream `VIDEO`.
2. Frontend loads media info; playhead/marker drag requests a preview frame.
3. Right-click auto-split or manual add/drag updates `split_points` widget (persisted in workflow JSON).
4. On Queue: backend validates cuts → extracts frames per segment → cuts aligned audio → ffmpeg muxes each `.mp4` → returns paths.

Priority when both inputs present: **upstream `VIDEO` wins** over `video_file`.

## Repository layout

```
comfyui-videoshotcut/
├── __init__.py
├── pyproject.toml
├── requirements.txt
├── README.md
├── LICENSE
├── nodes/
│   └── video_shotcut.py
├── server/
│   └── routes.py
├── core/
│   ├── media.py
│   ├── frames.py
│   ├── detect.py
│   └── export.py
├── js/
│   └── videoshotcut.js
├── example_workflows/
│   └── shotcut_basic.json
└── docs/superpowers/specs/
    └── 2026-09-28-comfyui-videoshotcut-design.md
```

## Node I/O: `VideoShotCut`

### Inputs

| Name | Type | Notes |
|---|---|---|
| `video` | `VIDEO` (optional) | Upstream video; preferred when connected |
| `video_file` | combo + upload | Local select/upload when no upstream video |
| `split_points` | `STRING` | JSON written by UI; see schema below |
| `filename_prefix` | `STRING` | Default `shotcut` |

### Outputs

| Name | Type | Notes |
|---|---|---|
| `file_paths` | `STRING` | One absolute or Comfy-relative path per line, in segment order |

### Output files

- Directory: ComfyUI `output/`
- Pattern: `{filename_prefix}_{index:03d}.mp4` with **0-based** index (`000`, `001`, …)
- Each file includes video + audio when the source has an audio track; video-only sources produce video-only mp4.

### `split_points` JSON schema

```json
{
  "version": 1,
  "fps": 24.0,
  "total_frames": 1200,
  "points": [120, 480, 900]
}
```

- `points`: sorted unique frame indices strictly in `(0, total_frames)`.
- Markers at `0` or `total_frames` are not stored; segment boundaries always include start/end implicitly.
- N cut points produce N+1 segments: `[0, p0)`, `[p0, p1)`, …, `[pN-1, total_frames)`.

## Timeline UI

- Horizontal timeline with zoom; playhead scrubbing.
- Split markers as vertical lines; drag snaps to integer frames.
- **Double-click** empty timeline area: add a split at that frame.
- **Right-click** menu:
  - Auto scene split (sensitivity: low / medium / high)
  - Split by fixed duration (prompt for seconds)
  - Clear all splits
  - Delete marker (when right-clicking a marker)
- Preview image above the timeline updates while dragging playhead or markers (server frame API).
- All marker edits write through to the `split_points` widget immediately.

## Server API

Prefix: `/videoshotcut/`

| Method | Path | Purpose |
|---|---|---|
| GET | `/info` | fps, total_frames, duration, has_audio, source id |
| GET | `/frame` | `source` + `frame_index` → JPEG/PNG preview |
| POST | `/detect/scenes` | scene detection → frame index list |
| POST | `/detect/interval` | fixed-duration splits → frame index list |

### Path safety

Resolved media paths must stay inside ComfyUI `input`, `output`, `temp`, or an already-validated path from a loaded `VIDEO` source. Reject path traversal and arbitrary filesystem reads.

## Export pipeline (Queue)

1. Resolve source path from `video` or `video_file`.
2. Parse and validate `split_points`.
3. **If `points` is empty: fail execution with message `请至少添加一个切点`.**
4. Sort/dedupe points; drop out-of-range indices.
5. For each segment frame range: extract those frames (on-demand; no mandatory full-film dump in v1).
6. Cut audio for the same time range (frame-aligned timestamps using fps).
7. ffmpeg re-encode/mux to `.mp4` (strict frame accuracy; no stream copy).
8. Return newline-joined `file_paths`.

### Cache (v1)

- Preview: single-frame on demand.
- Export: per-segment extraction.
- Optional full-video frame cache is out of scope for v1 unless needed for performance later.

## Dependencies

- System **ffmpeg** (and ffprobe) required; document in README.
- Python: use existing ComfyUI / torch / opencv where already available when practical; add only minimal extra deps if scene detection needs them (prefer a light frame-diff detector to avoid heavy new packages).
- Do not add internet/telemetry code.

## Error handling

| Case | Behavior |
|---|---|
| No video source | Fail with clear error |
| Invalid / unsafe path | Fail with clear error |
| Empty split points | Fail: `请至少添加一个切点` |
| ffmpeg missing | Fail with install hint on export (and mention in README) |
| Scene detect failure | Keep existing markers; show frontend error; do not clear |
| Preview API failure | Timeline remains editable; preview shows placeholder |

## Testing

- Unit: point normalize/dedupe, segment ranges, filename pattern, empty-points error.
- Manual: short clip with/without audio; drag preview; scene split; interval split; Queue multi-mp4 A/V sync.
- Ship `example_workflows/shotcut_basic.json`.

## GitHub and ComfyUI Manager

1. Plugin is its **own** git repository (not part of ComfyUI core; `custom_nodes/` is gitignored by ComfyUI).
2. Push to GitHub as `comfyui-videoshotcut`.
3. Root `pyproject.toml` includes name, description, version, and Publisher metadata expected by Comfy Registry.
4. Publish via [Comfy Registry](https://registry.comfy.org/) so Manager can search/install `comfyui-videoshotcut`.
5. README: ffmpeg dependency, install via Manager or git clone, usage, screenshots.

## Success criteria

- User can load video via upload or upstream `VIDEO`.
- Timeline supports manual markers, drag, and right-click auto/interval split.
- Playhead/marker drag shows current-frame preview on the node.
- Queue writes multiple accurate `.mp4` files with audio when present and returns paths.
- Empty cuts block export with `请至少添加一个切点`.
- Repo is installable via ComfyUI Manager after registry publish.
