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
