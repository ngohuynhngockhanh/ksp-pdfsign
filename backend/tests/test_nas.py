"""Test cac ham thuan cua nas (khong can NAS that)."""
from __future__ import annotations

import pytest

pytest.importorskip("smbclient")

from app import nas  # noqa: E402
from app.config import get_settings  # noqa: E402


def test_sanitize():
    assert nas._sanitize("CÔNG TY / INUT") == "CÔNG TY _ INUT"
    assert nas._sanitize("") == "_chua-phan-loai"
    assert nas._sanitize("  a.b.  ") == "a.b"
    assert nas._sanitize('x:*?"<>|y') == "x_______y"


def test_remote_path(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_HOST", "1.2.3.4")
    monkeypatch.setenv("NAS_SHARE", "inut")
    monkeypatch.setenv("NAS_BASE_PATH", "ho-so")
    get_settings.cache_clear()
    s = get_settings()
    p = nas.remote_path(s, "Cong ty A", "hd.pdf")
    assert p == r"\\1.2.3.4\inut\ho-so\Cong ty A\hd.pdf"
    # chua phan loai
    p2 = nas.remote_path(s, "", "x.pdf")
    assert r"\_chua-phan-loai\x.pdf" in p2
