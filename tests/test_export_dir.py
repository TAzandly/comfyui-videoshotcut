import os
from core.export import resolve_export_dir


def test_resolve_export_dir_groups_under_videoshotcut(tmp_path, monkeypatch):
    monkeypatch.setattr("core.export.folder_paths.get_output_directory", lambda: str(tmp_path))

    d1, stem1 = resolve_export_dir("shotcut")
    assert stem1 == "shotcut"
    assert os.path.basename(d1) == "shotcut_00001"
    assert os.path.basename(os.path.dirname(d1)) == "videoshotcut"
    assert os.path.isdir(d1)

    d2, _ = resolve_export_dir("shotcut")
    assert os.path.basename(d2) == "shotcut_00002"

    d3, stem3 = resolve_export_dir("jobs/clip")
    assert stem3 == "clip"
    assert os.path.basename(os.path.dirname(d3)) == "jobs"
    assert os.path.basename(d3) == "clip_00001"
