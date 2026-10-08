from core.detect import interval_points


def test_interval_points_every_1s_at_24fps():
    # 5 seconds, 24fps -> frames 24,48,72,96 inside (0,120)
    assert interval_points(total_frames=120, fps=24.0, interval_sec=1.0) == [24, 48, 72, 96]
