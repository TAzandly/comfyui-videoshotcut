"""Timeline fps / frame-count resolution and source-frame mapping."""


def resolve_timeline(info: dict, fps_override: float = 0.0) -> dict:
    """
    fps_override <= 0 → use source fps / frame count from probe.
    fps_override > 0 → working timeline at that fps; total_frames from duration.
    """
    source_fps = float(info.get("fps") or 0.0)
    duration = float(info.get("duration") or 0.0)
    source_total = int(info.get("total_frames") or 0)

    if fps_override and float(fps_override) > 0:
        eff = float(fps_override)
        if duration > 0:
            total = int(round(duration * eff))
        elif source_fps > 0 and source_total > 0:
            total = int(round(source_total * eff / source_fps))
        else:
            total = source_total
    else:
        eff = source_fps
        total = source_total
        if total <= 0 and duration > 0 and eff > 0:
            total = int(round(duration * eff))

    return {
        "fps": eff,
        "total_frames": max(0, total),
        "source_fps": source_fps,
        "source_total_frames": max(0, source_total),
        "duration": duration,
        "has_audio": bool(info.get("has_audio")),
        "path": info.get("path"),
        "width": int(info.get("width") or 0),
        "height": int(info.get("height") or 0),
    }


def timeline_to_source_frame(
    frame_index: int,
    effective_fps: float,
    source_fps: float,
    source_total_frames: int = 0,
) -> int:
    """Map a working-timeline frame index to a source bitstream frame index."""
    idx = int(frame_index)
    if effective_fps <= 0:
        src = idx
    elif source_fps <= 0 or abs(source_fps - effective_fps) < 1e-6:
        src = idx
    else:
        src = int(round(idx * source_fps / effective_fps))
    if source_total_frames > 0:
        src = max(0, min(source_total_frames - 1, src))
    else:
        src = max(0, src)
    return src
