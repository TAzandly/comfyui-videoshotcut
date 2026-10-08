from core.timeline import resolve_timeline, timeline_to_source_frame


def test_resolve_timeline_native():
    info = {"fps": 30.0, "duration": 2.0, "total_frames": 60, "has_audio": True}
    tl = resolve_timeline(info, 0)
    assert tl["fps"] == 30.0
    assert tl["total_frames"] == 60
    assert tl["source_fps"] == 30.0


def test_resolve_timeline_override_24():
    info = {"fps": 30.0, "duration": 2.0, "total_frames": 60, "has_audio": False}
    tl = resolve_timeline(info, 24)
    assert tl["fps"] == 24.0
    assert tl["total_frames"] == 48  # 2s * 24
    assert tl["source_fps"] == 30.0


def test_timeline_to_source_frame_identity():
    assert timeline_to_source_frame(10, 30, 30, 100) == 10


def test_timeline_to_source_frame_24_from_30():
    # working frame 24 at 24fps → t=1.0s → source frame 30 at 30fps
    assert timeline_to_source_frame(24, 24.0, 30.0, 300) == 30
