from core.detect import scene_points
import subprocess


def test_scene_points_uses_pts_time_not_output_n(monkeypatch):
    class Fake:
        stderr = (
            "[Parsed_showinfo_1 @ x] n:   0 pts:  24576 pts_time:2.000000 duration: 512\n"
            "[Parsed_showinfo_1 @ x] n:   1 pts:  49152 pts_time:4.500000 duration: 512\n"
        )
        stdout = ""
        returncode = 0

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Fake())
    monkeypatch.setattr(
        "core.detect.require_ffmpeg",
        lambda: ("ffmpeg", "ffprobe"),
    )
    pts = scene_points("dummy.mp4", total_frames=240, fps=24.0, sensitivity="medium")
    # Old bug used n: → [0,1] (invalid/wrong). Correct is pts_time * fps.
    assert pts == [48, 108]
