"""Proxy an toan toi iNut Training; CRM user khong can dang nhap lan hai."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import httpx

from .config import Settings


class TrainingError(RuntimeError):
    pass


def _transport() -> httpx.BaseTransport | None:
    """Hook nho de test proxy ma khong goi mang that."""
    return None


def _origin(base_url: str) -> str:
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise TrainingError("TRAINING_BASE_URL khong hop le")
    return f"{parsed.scheme}://{parsed.netloc}"


def search(settings: Settings, query: str) -> list[dict[str, Any]]:
    query = query.strip()
    if not query or len(query) > 300:
        raise TrainingError("Cau tra cuu phai tu 1 den 300 ky tu")
    try:
        response = httpx.get(
            f"{settings.training_base_url.rstrip('/')}/api/search",
            params={"q": query}, timeout=min(settings.training_timeout, 30),
        )
        response.raise_for_status()
        return response.json()["data"]["results"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise TrainingError("Khong ket noi duoc kho Training") from exc


def archived_help(settings: Settings) -> bytes:
    try:
        response = httpx.get(
            f"{settings.training_base_url.rstrip('/')}/help",
            timeout=min(settings.training_timeout, 30),
        )
        response.raise_for_status()
        if len(response.content) > 16 * 1024 * 1024:
            raise TrainingError("Ban Help luu tru vuot qua gioi han")
        return response.content
    except httpx.HTTPError as exc:
        raise TrainingError("Khong doc duoc ban Help luu tru") from exc


def ask(settings: Settings, question: str, session_id: str = "") -> dict[str, Any]:
    question = question.strip()
    if not question or len(question) > 2000:
        raise TrainingError("Cau hoi phai tu 1 den 2000 ky tu")
    if not settings.training_password:
        raise TrainingError("TRAINING_PASSWORD chua duoc cau hinh")
    base = settings.training_base_url.rstrip("/")
    origin = _origin(base)
    try:
        with httpx.Client(timeout=settings.training_timeout, transport=_transport()) as client:
            login = client.post(
                f"{base}/api/auth/login",
                headers={"Origin": origin},
                json={"password": settings.training_password},
            )
            login.raise_for_status()
            response = client.post(
                f"{base}/api/chat",
                headers={"Origin": origin},
                json={"sessionId": session_id, "message": question},
            )
            response.raise_for_status()
            return response.json()["data"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise TrainingError("Hermes Training khong tra loi duoc") from exc
