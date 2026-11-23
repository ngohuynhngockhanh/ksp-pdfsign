"""Global pytest configuration and strict live-DB isolation guard.

All tests MUST execute against a temporary DATA_DIR strictly outside the
repository's live backend/data directory. Any test attempting to point
DATA_DIR at production backend/data/ksp.db is immediately aborted.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FORBIDDEN_DATA_DIRS = (
    (_REPO_ROOT / "backend" / "data").resolve(),
    (_REPO_ROOT / "data").resolve(),
)

# Provision a process-wide temporary DATA_DIR BEFORE any app module imports
# read settings or initialize SQLAlchemy engines.
_SESSION_TMP_DATA_DIR = Path(tempfile.mkdtemp(prefix="ksp_pytest_data_")).resolve()
os.environ["DATA_DIR"] = str(_SESSION_TMP_DATA_DIR)
os.environ.setdefault("APP_ADMIN_PASSWORD", "NhapHang123@")
os.environ.setdefault("AGENT_ADMIN_PASSWORD", "NhapHang123")
os.environ.setdefault("NAS_ENABLED", "false")

pytest_plugins = ["tests.test_api"]


def _assert_safe_data_dir() -> None:
    raw = os.environ.get("DATA_DIR", "").strip()
    if not raw:
        raise RuntimeError(
            "SAFETY ABORT: DATA_DIR is unset during pytest; refusing to risk touching live backend/data/ksp.db."
        )
    resolved = Path(raw).resolve()
    for forbidden in _FORBIDDEN_DATA_DIRS:
        if resolved == forbidden or forbidden in resolved.parents:
            raise RuntimeError(
                f"SAFETY ABORT: DATA_DIR={resolved} targets production data directory {forbidden}!"
            )


@pytest.fixture(scope="session", autouse=True)
def _guard_session_data_dir():
    """Session-wide safety rail guaranteeing no test touches production backend/data/ksp.db."""
    _assert_safe_data_dir()
    yield
    shutil.rmtree(_SESSION_TMP_DATA_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def _guard_per_test_data_dir():
    """Verify before and after every test that DATA_DIR stayed isolated outside backend/data."""
    _assert_safe_data_dir()
    yield
    _assert_safe_data_dir()
