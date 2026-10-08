import json

EMPTY_POINTS_MSG = "Please add at least one cut point"


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
