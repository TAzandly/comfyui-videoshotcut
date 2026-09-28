import os
import pytest
from core.paths import resolve_safe_media_path


def test_rejects_traversal(tmp_path, monkeypatch):
    root = tmp_path / "input"
    root.mkdir()
    monkeypatch.setattr("core.paths.get_allowed_roots", lambda: [str(root)])
    with pytest.raises(ValueError):
        resolve_safe_media_path(str(tmp_path / "secret.mp4"))


def test_accepts_file_inside_root(tmp_path, monkeypatch):
    root = tmp_path / "input"
    root.mkdir()
    f = root / "a.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr("core.paths.get_allowed_roots", lambda: [str(root)])
    assert resolve_safe_media_path(str(f)) == os.path.abspath(str(f))
