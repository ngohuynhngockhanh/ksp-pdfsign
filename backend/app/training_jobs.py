"""Short-lived background jobs for Training answers that may outlive HTTP proxies."""
from __future__ import annotations

import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from . import training
from .config import Settings


@dataclass
class _Job:
    owner: str
    started_at: float
    status: str = "running"
    result: dict[str, Any] | None = None
    error: str = ""


_jobs: dict[str, _Job] = {}
_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inut-training")
_ttl_seconds = 30 * 60


def start(owner: str, settings: Settings, question: str, session_id: str = "") -> str:
    question = question.strip()
    if not question or len(question) > 2000:
        raise training.TrainingError("Cau hoi phai tu 1 den 2000 ky tu")
    job_id = secrets.token_urlsafe(24)
    with _lock:
        _cleanup_locked(time.monotonic())
        _jobs[job_id] = _Job(owner=owner, started_at=time.monotonic())
    _executor.submit(_run, job_id, settings, question, session_id)
    return job_id


def get(owner: str, job_id: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _lock:
        _cleanup_locked(now)
        job = _jobs.get(job_id)
        if job is None or job.owner != owner:
            return None
        payload: dict[str, Any] = {"status": job.status, "stage": _stage(job, now)}
        if job.result is not None:
            payload["result"] = job.result
        if job.error:
            payload["error"] = job.error
        return payload


def _run(job_id: str, settings: Settings, question: str, session_id: str) -> None:
    try:
        result = training.ask(settings, question, session_id)
    except training.TrainingError:
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job.status = "failed"
                job.error = "Hermes Training khong tra loi duoc"
        return
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "done"
            job.result = result


def _stage(job: _Job, now: float) -> str:
    if job.status == "done":
        return "Hoàn tất câu trả lời có nguồn"
    if job.status == "failed":
        return "Không thể hoàn tất"
    elapsed = now - job.started_at
    if elapsed < 8:
        return "Đang tìm trong kho iNut"
    if elapsed < 25:
        return "Đang đọc tài liệu và video liên quan"
    return "Đang tổng hợp câu trả lời và trích nguồn"


def _cleanup_locked(now: float) -> None:
    expired = [job_id for job_id, job in _jobs.items() if now-job.started_at > _ttl_seconds]
    for job_id in expired:
        del _jobs[job_id]
