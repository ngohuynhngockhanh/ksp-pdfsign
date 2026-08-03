"""Job runner cho câu hỏi công khai, tách owner theo session token."""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import public_training, training
from .config import Settings
from .db import TrainingPublicQuery, get_session


@dataclass
class _Job:
    owner_hash: str
    started_at: float
    status: str = "running"
    result: dict[str, Any] | None = None
    error: str = ""


_jobs: dict[str, _Job] = {}
_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inut-public-training")
_ttl_seconds = 30 * 60


def start(*, job_id: str, owner_token: str, settings: Settings, question: str, hermes_session_id: str = "") -> str:
    question = question.strip()
    if not question or len(question) > 2000:
        raise training.TrainingError("Câu hỏi phải từ 1 đến 2000 ký tự")
    owner_hash = public_training.public_training_token_hash(owner_token)
    with _lock:
        _cleanup_locked(time.monotonic())
        _jobs[job_id] = _Job(owner_hash=owner_hash, started_at=time.monotonic())
    _executor.submit(_run, job_id, owner_hash, owner_token, settings, question, hermes_session_id)
    return job_id


def get(owner_token: str, job_id: str) -> dict[str, Any] | None:
    now = time.monotonic()
    owner_hash = public_training.public_training_token_hash(owner_token)
    with _lock:
        _cleanup_locked(now)
        job = _jobs.get(job_id)
        if job is None or job.owner_hash != owner_hash:
            return None
        payload: dict[str, Any] = {"status": job.status, "stage": _stage(job, now)}
        if job.result is not None:
            payload["result"] = job.result
        if job.error:
            payload["error"] = job.error
        return payload


def public_training_token_hash(token: str) -> str:
    return public_training.public_training_token_hash(token)


def _run(job_id: str, owner_hash: str, owner_token: str, settings: Settings, question: str, hermes_session_id: str) -> None:
    started = time.monotonic()
    try:
        result = training.ask(settings, question, hermes_session_id or f"public-{owner_hash[:16]}")
        result = public_training.sanitize_public_result(result, settings)
    except training.TrainingError:
        _finish_db(job_id, "failed", {}, started)
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job.status = "failed"
                job.error = "Hermes Training chưa thể trả lời"
        return
    except Exception:  # noqa: BLE001
        _finish_db(job_id, "failed", {}, started)
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job.status = "failed"
                job.error = "Hermes Training chưa thể trả lời"
        return
    _finish_db(job_id, "done", result, started)
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.status = "done"
            job.result = result


def _finish_db(job_id: str, status: str, result: dict[str, Any], started: float) -> None:
    gen = get_session()
    db = next(gen)
    try:
        row = db.query(TrainingPublicQuery).filter(TrainingPublicQuery.job_id == job_id).first()
        if row is not None:
            now = time.time()
            row.status = status
            row.stage = "Hoàn tất câu trả lời có nguồn" if status == "done" else "Không thể hoàn tất"
            row.answer_json = json.dumps(result, ensure_ascii=False)
            row.completed_at = datetime.now(timezone.utc)
            row.duration_ms = max(0, int((time.monotonic() - started) * 1000))
            db.commit()
    finally:
        gen.close()


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
    expired = [job_id for job_id, job in _jobs.items() if now - job.started_at > _ttl_seconds]
    for job_id in expired:
        del _jobs[job_id]
