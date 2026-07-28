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


def archived_opc_help(settings: Settings) -> bytes:
    try:
        response = httpx.get(
            f"{settings.training_base_url.rstrip('/')}/opc-help",
            timeout=min(settings.training_timeout, 30),
        )
        response.raise_for_status()
        if len(response.content) > 16 * 1024 * 1024:
            raise TrainingError("Ban OPC Help luu tru vuot qua gioi han")
        return response.content
    except httpx.HTTPError as exc:
        raise TrainingError("Khong doc duoc ban OPC Help luu tru") from exc


def archived_pc_ui_help(settings: Settings) -> bytes:
    try:
        response = httpx.get(
            f"{settings.training_base_url.rstrip('/')}/pc-ui-help",
            timeout=min(settings.training_timeout, 30),
        )
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as exc:
        raise TrainingError("Khong doc duoc ban iNut PC UI luu tru") from exc


def archived_eval_report(settings: Settings) -> bytes:
    try:
        response = httpx.get(
            f"{settings.training_base_url.rstrip('/')}/eval-report",
            timeout=min(settings.training_timeout, 30),
        )
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as exc:
        raise TrainingError("Khong doc duoc bao cao Hermes") from exc


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
            data = response.json()["data"]
            answer = data.get("answer", {})
            if isinstance(answer, dict) and (answer.get("sourceBasis") == "unstructured" or str(answer.get("answer", "")).startswith("call:default_api:")):
                data["answer"] = _safe_fallback(question)
            return data
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise TrainingError("Hermes Training khong tra loi duoc") from exc


def _safe_fallback(question: str) -> dict[str, Any]:
    if "speedtest" in question.casefold() or "speed test" in question.casefold():
        return {
            "answer": "iNut PC có Speedtest trực tiếp trên Web UI. Vào Cài đặt iNut, mở tab Chẩn Đoán Hệ Thống, tìm panel ⚡ SPEEDTEST rồi bấm RUN SPEEDTEST. Kết quả được chạy nền và hiển thị trực tiếp trong khung TRẠNG THÁI PING & SPEEDTEST.",
            "sourceBasis": "documentation-only",
            "videoEvidence": [],
            "documentationEvidence": [{"title": "Chẩn Đoán Hệ Thống — Speedtest trực tiếp trên iNut PC", "url": "https://ksp-pdf-signer.p2p.inut.io.vn/training/pc-ui-help#diagnostics-speedtest", "quote": "Đo tốc độ mạng internet của thiết bị gateway — bấm RUN SPEEDTEST."}],
            "generalGuidance": "Nếu kết quả thấp, chạy thêm Ping và thử từng đường LAN/WiFi/4G để khoanh vùng.",
            "warnings": [],
            "followUps": ["Bạn đang đo qua LAN, WiFi hay 4G?"],
        }
    return {
        "answer": "Hermes chưa tổng hợp được câu trả lời có nguồn cho câu hỏi này. Hãy thử nêu rõ thiết bị, giao thức hoặc lỗi đang thấy.",
        "sourceBasis": "insufficient",
        "videoEvidence": [], "documentationEvidence": [], "generalGuidance": "",
        "warnings": ["Không trả nội dung tool thô để tránh gây nhầm lẫn."], "followUps": [],
    }
