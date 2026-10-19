"""Vietnamese Text-to-Speech (TTS) & BLE Speaker Gateway Integration.

Hỗ trợ chuỗi tổng hợp giọng nói Tiếng Việt đa tầng (Multi-Provider Fallback):
1. Tier 1 (Primary): Kokoro Speech (`https://kokoro.p2p.inut.io.vn/hmi/tts/v5`) - WAV 24kHz mono.
2. Tier 2 (Secondary): VNMap Kokoro TTS (`https://vnmap-tts.a.inut.vn/hmi/tts/v5`) - WAV 24kHz mono.
3. Tier 3 (Fallback 1): AppHub 9Router Google TTS (`POST /v1/audio/speech`, model `google-tts/vi`) - MP3.
4. Tier 4 (Fallback 2): AppHub 9Router Microsoft Edge Neural TTS (`POST /v1/audio/speech`, model `edge-tts/vi-VN-HoaiMyNeural`) - MP3.

Tích hợp phát trực tiếp ra loa Bluetooth G-10 tại Gateway `77.88.207.23:8080` (`~/ble-speaker`)
và tự động đọc thông báo khi có tin nhắn/cảnh báo Telegram mới.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import Settings, get_settings

logger = logging.getLogger("ksp_pdfsign.tts")

KOKORO_VOICES: dict[str, str] = {
    "diem_trinh": "Diễm Trinh (Nữ chuẩn - Mặc định)",
    "hung_thinh": "Hưng Thịnh (Nam)",
    "mai_linh": "Mai Linh (Nữ)",
    "mai_loan": "Mai Loan (Nữ)",
    "manh_dung": "Mạnh Dũng (Nam)",
    "my_yen": "Mỹ Yến (Nữ)",
    "ngoc_huyen": "Ngọc Huyền (Nữ)",
    "phat_tai": "Phát Tài (Nam)",
    "thanh_dat": "Thành Đạt (Nam)",
    "thuc_trinh": "Thục Trinh (Nữ)",
    "tuan_ngoc": "Tuấn Ngọc (Nam)",
    "storyvert": "Storyvert (Kể chuyện)",
    "duc_an": "Đức An (Nam)",
    "duc_duy": "Đức Duy (Nam)",
}

MICROSOFT_VOICES: dict[str, str] = {
    "edge-tts/vi-VN-HoaiMyNeural": "Microsoft Hoài My Neural (Nữ)",
    "edge-tts/vi-VN-NamMinhNeural": "Microsoft Nam Minh Neural (Nam)",
}

GOOGLE_VOICES: dict[str, str] = {
    "google-tts/vi": "Chị Google Tiếng Việt (vi)",
}

_tts_executor: ThreadPoolExecutor | None = None
_tts_executor_lock = threading.Lock()
_recent_spoken_lock = threading.Lock()
_recent_spoken_until: dict[str, float] = {}
_SPEAK_DEDUPE_SECONDS = 12.0


class TtsError(RuntimeError):
    """Lỗi khi tổng hợp giọng nói hoặc phát ra loa BLE."""


@dataclass
class TtsSynthesisResult:
    audio_bytes: bytes
    audio_format: str  # "wav" | "mp3"
    content_type: str  # "audio/wav" | "audio/mpeg"
    provider: str      # "kokoro" | "vnmap-tts" | "9router-google" | "9router-microsoft"
    voice: str
    text: str
    request_id: str = ""
    async_url: str = ""
    fallback_errors: list[str] = field(default_factory=list)


def clean_text_for_tts(raw: str, max_chars: int = 800) -> str:
    """Làm sạch văn bản (bỏ link, markdown, ký tự trang trí) để đọc tiếng Việt tự nhiên."""
    if not raw:
        return ""
    text = str(raw).strip()
    # Bỏ các dòng chỉ chứa link hoặc ID kỹ thuật trong thông báo Messenger/KSP
    filtered_lines: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        low = s.lower()
        if any(
            low.startswith(prefix)
            for prefix in (
                "mở trang:",
                "mở cuộc trò chuyện:",
                "mở business inbox:",
                "mở ksp:",
                "page id:",
                "psid:",
            )
        ):
            continue
        filtered_lines.append(s)
    text = ". ".join(filtered_lines)

    # Bỏ URL http/https
    text = re.sub(r"https?://\S+", "", text)
    # Bỏ ký tự markdown & khung trang trí
    text = re.sub(r"[`*_#~>|━─═]+", " ", text)
    # Bỏ các chuỗi emoji trang trí lặp lại nhưng giữ chữ/số/dấu câu tiếng Việt
    text = re.sub(r"[\U00010000-\U0010ffff]", " ", text)
    text = re.sub(r"[✅❌⚠️🚨📢🔔💬📄🔗⬇️🖨️🧾🏛️📜🚚✦◈◉◆□◇⚙⌘▱⌕✍️⏳👮📲🎯]+", " ", text)
    # Chuẩn hóa khoảng trắng và dấu chấm câu
    text = re.sub(r"\s*\.\s*\.\s*", ". ", text)
    text = re.sub(r"\s+", " ", text).strip(" .-;:")
    if not text:
        return ""
    if max_chars and len(text) > max_chars:
        cut = text[:max_chars]
        last_space = cut.rfind(" ")
        if last_space > max_chars // 2:
            cut = cut[:last_space]
        text = cut.rstrip(" ,;:-") + "."
    # Kokoro yêu cầu tối thiểu 3 ký tự
    if len(text) < 3:
        text = text + "..."
    return text


def matches_telegram_tts_filter(
    raw_message: str,
    settings: Settings | None = None,
    *,
    custom_regex: str | None = None,
    filter_enabled: bool | None = None,
) -> dict[str, Any]:
    """Kiểm tra tin nhắn Telegram có khớp bộ lọc Regex (mặc định `RK\\s*Burner`) để báo động loa BLE không."""
    cfg = settings or get_settings()
    text = str(raw_message or "").strip()
    if not text:
        return {
            "matched": False,
            "filter_enabled": True,
            "regex": "",
            "matched_text": "",
            "reason": "empty_message",
        }
    enabled = cfg.telegram_tts_filter_enabled if filter_enabled is None else bool(filter_enabled)
    pattern = (cfg.telegram_tts_regex if custom_regex is None else str(custom_regex)).strip()
    if not enabled or not pattern:
        return {
            "matched": True,
            "filter_enabled": enabled,
            "regex": pattern,
            "matched_text": text[:60],
            "reason": "filter_disabled_or_all",
        }
    try:
        m = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        return {
            "matched": m is not None,
            "filter_enabled": enabled,
            "regex": pattern,
            "matched_text": m.group(0) if m else "",
            "reason": "regex_matched" if m else "regex_not_matched",
        }
    except re.error as exc:
        # Nếu người dùng nhập regex lỗi cú pháp, fallback tìm chuỗi con không phân biệt hoa thường
        sub_match = pattern.lower() in text.lower()
        return {
            "matched": sub_match,
            "filter_enabled": enabled,
            "regex": pattern,
            "matched_text": pattern if sub_match else "",
            "reason": f"invalid_regex_fallback ({exc})",
        }


def resolve_telegram_alarm_sound(raw_message: str, configured_sound: str = "auto") -> str:
    """Tự động chọn âm hiệu theo trạng thái tin nhắn khi `configured_sound == 'auto'`:
    - Nếu tin báo lỗi / thất bại (`failed`, `partial_failed`, `thất bại`, `lỗi`, `❌`, `🚨`, `⚠️`) -> `'alarm'`
    - Nếu tin báo hoàn tất / thành công (`✅`, `succeeded`, `hoàn tất`, `thành công`, `đã an toàn`) -> `'success'`
    - Còn lại -> `'notification'`
    """
    cfg_snd = str(configured_sound or "auto").strip().lower()
    if cfg_snd and cfg_snd != "auto":
        return "none" if cfg_snd in ("none", "off", "false") else cfg_snd
    text = str(raw_message or "").strip()
    if re.search(
        r"(?:❌|🚨|⚠️|\bpartial_failed\b|\bfailed\b|\bfail\b|\berror\b|thất\s+bại|gặp\s+lỗi|bị\s+lỗi|ngắt\s+kết\s+nối|không\s+thành\s+công)",
        text,
        flags=re.IGNORECASE,
    ):
        return "alarm"
    if re.search(
        r"(?:✅|🎉|\bsucceeded\b|\bsuccess\b|hoàn\s+tất|thành\s+công|đã\s+an\s+toàn)",
        text,
        flags=re.IGNORECASE,
    ):
        return "success"
    return "notification"

def format_telegram_tts_text(raw: str, max_chars: int = 500) -> str:
    """Chuyển đổi nội dung tin nhắn Telegram (đặc biệt là RK Burner) thành câu thông báo đọc loa rõ ràng."""
    if not raw or not str(raw).strip():
        return ""
    text = str(raw).strip()

    # Chuẩn hóa phát âm cho thông báo RK Burner
    if re.search(r"RK\s*Burner", text, flags=re.IGNORECASE):
        spoken = text
        spoken = re.sub(r"rkdeveloptool\s+rd", "rờ ca đờ vê lốp tun rờ đê", spoken, flags=re.IGNORECASE)
        spoken = re.sub(r"\bburn\s+image\b", "nạp i mịch", spoken, flags=re.IGNORECASE)
        spoken = re.sub(r"\bsucceeded\b", "thành công", spoken, flags=re.IGNORECASE)
        spoken = re.sub(r"\bpartial_failed\b", "lỗi một phần", spoken, flags=re.IGNORECASE)
        spoken = re.sub(r"\bfailed\b", "thất bại", spoken, flags=re.IGNORECASE)
        spoken = re.sub(r"\breboot_complete\b", "khởi động lại hoàn tất", spoken, flags=re.IGNORECASE)
        cleaned_rk = clean_text_for_tts(spoken, max_chars=max_chars)
        if not cleaned_rk.lower().startswith(("cảnh báo", "thông báo")):
            cleaned_rk = f"Thông báo RK Burner: {cleaned_rk}"
        return clean_text_for_tts(cleaned_rk, max_chars=max_chars)

    if "Tin nhắn Messenger mới" in text:
        sender = ""
        page = ""
        msg_preview = ""
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("Trang:"):
                page = s.split(":", 1)[1].strip()
            elif s.startswith("Khách Facebook:"):
                sender = s.split(":", 1)[1].strip()
            elif s.startswith("Tin nhắn:"):
                msg_preview = s.split(":", 1)[1].strip()
        parts = ["Thông báo Telegram: Có tin nhắn khách hàng mới"]
        if sender:
            parts.append(f"từ {sender}")
        if page:
            parts.append(f"trên trang {page}")
        spoken = " ".join(parts) + "."
        if msg_preview:
            spoken += f" Nội dung: {msg_preview}"
        return clean_text_for_tts(spoken, max_chars=max_chars)

    cleaned = clean_text_for_tts(text, max_chars=max_chars)
    if not cleaned:
        return ""
    if not cleaned.lower().startswith("thông báo"):
        cleaned = f"Thông báo Telegram: {cleaned}"
    return clean_text_for_tts(cleaned, max_chars=max_chars)

def _synthesize_kokoro_instance(
    base_url: str,
    api_key: str,
    text: str,
    *,
    provider_name: str,
    voice: str = "diem_trinh",
    speed: int = 0,
    timeout: float = 15.0,
    poll_timeout: float = 12.0,
    poll_interval: float = 0.35,
    http_client: httpx.Client | None = None,
) -> TtsSynthesisResult:
    """Gọi Kokoro Speech API (`POST /hmi/tts/v5`) và chờ tải file WAV từ link `async`."""
    clean_base = str(base_url or "").strip().rstrip("/")
    key = str(api_key or "").strip()
    if not clean_base or not key:
        raise TtsError(f"{provider_name}: Chưa cấu hình base_url hoặc api_key")

    kokoro_voice = voice if voice in KOKORO_VOICES else "diem_trinh"
    clamped_speed = max(-3, min(3, int(speed)))
    headers = {
        "api-key": key,
        "voice": kokoro_voice,
        "speed": str(clamped_speed),
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "ksp-pdfsign-tts/1.0",
    }

    own_client = http_client is None
    client = http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        try:
            resp = client.post(
                f"{clean_base}/hmi/tts/v5",
                content=text.encode("utf-8"),
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise TtsError(f"{provider_name}: Lỗi kết nối POST /hmi/tts/v5 ({exc})") from exc

        try:
            data = resp.json()
        except ValueError as exc:
            raise TtsError(f"{provider_name}: Phản hồi không phải JSON (HTTP {resp.status_code})") from exc

        if resp.status_code >= 400 or not isinstance(data, dict) or data.get("error", -1) != 0:
            msg = data.get("message") if isinstance(data, dict) else f"HTTP {resp.status_code}"
            raise TtsError(f"{provider_name}: {msg}")

        async_url = str(data.get("async") or "").strip()
        request_id = str(data.get("request_id") or resp.headers.get("X-Request-ID") or "").strip()
        if not async_url:
            raise TtsError(f"{provider_name}: Không trả về link async WAV")

        deadline = time.monotonic() + max(1.0, float(poll_timeout))
        last_status = 0
        while True:
            try:
                wav_resp = client.get(async_url, headers={"User-Agent": "ksp-pdfsign-tts/1.0"})
                last_status = wav_resp.status_code
                if wav_resp.status_code == 200 and len(wav_resp.content) > 100 and wav_resp.content[:4] == b"RIFF":
                    return TtsSynthesisResult(
                        audio_bytes=wav_resp.content,
                        audio_format="wav",
                        content_type="audio/wav",
                        provider=provider_name,
                        voice=kokoro_voice,
                        text=text,
                        request_id=request_id,
                        async_url=async_url,
                    )
            except httpx.HTTPError:
                pass

            if time.monotonic() >= deadline:
                break
            time.sleep(max(0.05, float(poll_interval)))

        raise TtsError(f"{provider_name}: Quá thời gian chờ file WAV ({async_url}, last HTTP {last_status})")
    finally:
        if own_client:
            client.close()


def _synthesize_9router(
    base_url: str,
    api_key: str,
    text: str,
    *,
    model: str,
    provider_name: str,
    timeout: float = 15.0,
    http_client: httpx.Client | None = None,
) -> TtsSynthesisResult:
    """Gọi AppHub 9Router OpenAI-compatible TTS (`POST /v1/audio/speech`) cho Google / Microsoft fallback."""
    clean_base = str(base_url or "").strip().rstrip("/")
    if not clean_base:
        raise TtsError(f"{provider_name}: Chưa cấu hình 9Router base_url")
    if not clean_base.endswith("/v1"):
        clean_base = f"{clean_base}/v1"

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "ksp-pdfsign-tts/1.0",
    }
    key = str(api_key or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"

    own_client = http_client is None
    client = http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        try:
            resp = client.post(
                f"{clean_base}/audio/speech",
                json={"model": model, "input": text},
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise TtsError(f"{provider_name}: Lỗi kết nối 9Router ({exc})") from exc

        if resp.status_code >= 400 or len(resp.content) < 100:
            err_detail = resp.text[:200] if resp.status_code >= 400 else "Empty audio"
            raise TtsError(f"{provider_name} ({model}): HTTP {resp.status_code} - {err_detail}")

        is_wav = resp.content[:4] == b"RIFF"
        return TtsSynthesisResult(
            audio_bytes=resp.content,
            audio_format="wav" if is_wav else "mp3",
            content_type="audio/wav" if is_wav else "audio/mpeg",
            provider=provider_name,
            voice=model,
            text=text,
        )
    finally:
        if own_client:
            client.close()


def synthesize_vietnamese_tts(
    text: str,
    settings: Settings | None = None,
    *,
    voice: str | None = None,
    speed: int | None = None,
    provider: str = "auto",
    max_chars: int = 800,
    poll_timeout: float = 12.0,
    poll_interval: float = 0.35,
    http_client: httpx.Client | None = None,
) -> TtsSynthesisResult:
    """Tổng hợp giọng nói Tiếng Việt theo chuỗi ưu tiên:
    Kokoro (`kokoro.p2p.inut.io.vn`) -> VNMap TTS (`vnmap-tts.a.inut.vn`)
    -> 9Router Google (`google-tts/vi`) -> 9Router Microsoft (`edge-tts/vi-VN-HoaiMyNeural`).
    """
    cfg = settings or get_settings()
    cleaned = clean_text_for_tts(text, max_chars=max_chars)
    if not cleaned:
        raise TtsError("Nội dung cần đọc đang trống")

    selected_voice = (voice or cfg.tts_default_voice or "diem_trinh").strip()
    selected_speed = cfg.tts_default_speed if speed is None else int(speed)
    router_base = (cfg.tts_9router_base_url or cfg.ai_base_url or "http://127.0.0.1:20128/v1").strip()
    router_key = (cfg.tts_9router_api_key or cfg.ai_api_key or "").strip()

    prov = (provider or "auto").strip().lower()
    errors: list[str] = []

    def try_kokoro() -> TtsSynthesisResult:
        return _synthesize_kokoro_instance(
            cfg.tts_kokoro_base_url,
            cfg.tts_kokoro_api_key,
            cleaned,
            provider_name="kokoro",
            voice=selected_voice,
            speed=selected_speed,
            poll_timeout=poll_timeout,
            poll_interval=poll_interval,
            http_client=http_client,
        )

    def try_vnmap() -> TtsSynthesisResult:
        return _synthesize_kokoro_instance(
            cfg.tts_vnmap_base_url,
            cfg.tts_vnmap_api_key,
            cleaned,
            provider_name="vnmap-tts",
            voice=selected_voice,
            speed=selected_speed,
            poll_timeout=poll_timeout,
            poll_interval=poll_interval,
            http_client=http_client,
        )

    def try_google() -> TtsSynthesisResult:
        model = selected_voice if selected_voice.startswith("google-tts/") else (cfg.tts_google_model or "google-tts/vi")
        return _synthesize_9router(
            router_base,
            router_key,
            cleaned,
            model=model,
            provider_name="9router-google",
            http_client=http_client,
        )

    def try_microsoft() -> TtsSynthesisResult:
        model = selected_voice if selected_voice.startswith("edge-tts/") else (cfg.tts_microsoft_model or "edge-tts/vi-VN-HoaiMyNeural")
        return _synthesize_9router(
            router_base,
            router_key,
            cleaned,
            model=model,
            provider_name="9router-microsoft",
            http_client=http_client,
        )

    chain_map = {
        "kokoro": [try_kokoro],
        "vnmap": [try_vnmap],
        "vnmap-tts": [try_vnmap],
        "google": [try_google],
        "google-tts": [try_google],
        "9router-google": [try_google],
        "microsoft": [try_microsoft],
        "edge": [try_microsoft],
        "edge-tts": [try_microsoft],
        "9router-microsoft": [try_microsoft],
        "auto": [try_kokoro, try_vnmap, try_google, try_microsoft],
    }
    steps = chain_map.get(prov, chain_map["auto"])

    for step in steps:
        try:
            res = step()
            res.fallback_errors = errors
            return res
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            logger.warning("TTS step failed: %s", exc)

    raise TtsError("Tất cả nguồn TTS đều lỗi: " + " | ".join(errors))


def get_ble_speaker_status(
    settings: Settings | None = None,
    *,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Lấy trạng thái loa Bluetooth G-10 tại `77.88.207.23:8080/api/status`."""
    cfg = settings or get_settings()
    base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
    try:
        resp = client.get(f"{base}/api/status", headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {"ok": False, "error": "Invalid status JSON"}
    except Exception as exc:  # noqa: BLE001
        raise TtsError(f"Không kết nối được BLE Speaker ({base}): {exc}") from exc
    finally:
        if own_client:
            client.close()


def set_ble_speaker_volume(
    level: int,
    settings: Settings | None = None,
    *,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Chỉnh âm lượng loa Bluetooth (0 - 100%)."""
    cfg = settings or get_settings()
    base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
    vol = max(0, min(100, int(level)))
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
    try:
        resp = client.post(f"{base}/api/volume", json={"volume": vol})
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TtsError(f"Không chỉnh được âm lượng BLE Speaker: {exc}") from exc
    finally:
        if own_client:
            client.close()


def stop_ble_speaker(
    settings: Settings | None = None,
    *,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Dừng phát âm thanh trên loa Bluetooth."""
    cfg = settings or get_settings()
    base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
    try:
        resp = client.post(f"{base}/api/stop", json={})
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TtsError(f"Không dừng được BLE Speaker: {exc}") from exc
    finally:
        if own_client:
            client.close()


def play_ble_speaker_sound(
    sound: str = "notification",
    settings: Settings | None = None,
    *,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Phát âm thanh mẫu có sẵn trên loa (`chime`, `notification`, `success`, `beep`, `alarm`)."""
    cfg = settings or get_settings()
    base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
    try:
        resp = client.post(f"{base}/api/play", json={"sound": sound})
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TtsError(f"Không phát được âm thanh '{sound}' trên BLE Speaker: {exc}") from exc
    finally:
        if own_client:
            client.close()


def play_audio_on_ble_speaker(
    audio_bytes: bytes,
    audio_format: str = "wav",
    settings: Settings | None = None,
    *,
    async_url: str = "",
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Đẩy dữ liệu âm thanh WAV/MP3 sang `77.88.207.23:8080/api/upload` để phát ra loa G-10."""
    cfg = settings or get_settings()
    base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
    if not audio_bytes:
        raise TtsError("Dữ liệu âm thanh rỗng")

    fmt = "wav" if audio_bytes[:4] == b"RIFF" or audio_format.lower() == "wav" else "mp3"
    ctype = "audio/wav" if fmt == "wav" else "audio/mpeg"

    own_client = http_client is None
    client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
    try:
        try:
            resp = client.post(
                f"{base}/api/upload?format={fmt}",
                content=audio_bytes,
                headers={"Content-Type": ctype, "X-Audio-Format": fmt},
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("ok"):
                return data
        except Exception as upload_exc:  # noqa: BLE001
            if async_url:
                resp2 = client.post(f"{base}/api/play", json={"url": async_url})
                resp2.raise_for_status()
                data2 = resp2.json()
                if isinstance(data2, dict) and data2.get("ok"):
                    return data2
            raise TtsError(f"Lỗi gửi âm thanh tới BLE Speaker ({base}): {upload_exc}") from upload_exc
        raise TtsError(f"BLE Speaker từ chối phát: {data}")
    finally:
        if own_client:
            client.close()


def speak_on_ble_speaker(
    text: str,
    settings: Settings | None = None,
    *,
    voice: str | None = None,
    speed: int | None = None,
    provider: str | None = None,
    alarm_sound: str | None = None,
    alarm_delay_sec: float = 1.6,
    max_chars: int = 600,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Tổng hợp giọng nói Tiếng Việt (Kokoro -> VNMap -> Google -> Microsoft) và phát ra loa BLE 77.88.207.23.
    Nếu `alarm_sound` được bật (`alarm`, `chime`, `notification`, `success`, `beep`), phát còi báo trước khi đọc.
    Nếu toàn bộ nguồn TTS cloud đều lỗi, fallback gọi trực tiếp `/api/speak` trên 77.88.207.23.
    """
    cfg = settings or get_settings()
    cleaned = clean_text_for_tts(text, max_chars=max_chars)
    if not cleaned:
        raise TtsError("Nội dung cần đọc đang trống")

    eff_provider = (provider or cfg.tts_default_provider or "auto").strip()
    eff_alarm = resolve_telegram_alarm_sound(text, alarm_sound if alarm_sound is not None else cfg.telegram_tts_alarm_sound)
    try:
        tts_res = synthesize_vietnamese_tts(
            cleaned,
            cfg,
            voice=voice,
            speed=speed,
            provider=eff_provider,
            max_chars=max_chars,
            http_client=http_client,
        )
        if eff_alarm and eff_alarm not in ("none", "off", "false"):
            try:
                play_ble_speaker_sound(eff_alarm, cfg, http_client=http_client)
                if http_client is None and alarm_delay_sec > 0:
                    time.sleep(alarm_delay_sec)
            except Exception as alarm_exc:  # noqa: BLE001
                logger.warning("Không phát được âm báo '%s' trước TTS: %s", eff_alarm, alarm_exc)

        play_res = play_audio_on_ble_speaker(
            tts_res.audio_bytes,
            tts_res.audio_format,
            cfg,
            async_url=tts_res.async_url,
            http_client=http_client,
        )
        return {
            "ok": True,
            "text": tts_res.text,
            "provider": tts_res.provider,
            "voice": tts_res.voice,
            "alarm_sound": eff_alarm or "none",
            "audio_format": tts_res.audio_format,
            "audio_bytes_len": len(tts_res.audio_bytes),
            "request_id": tts_res.request_id,
            "async_url": tts_res.async_url,
            "fallback_errors": tts_res.fallback_errors,
            "speaker_response": play_res,
        }
    except Exception as tts_exc:  # noqa: BLE001
        # Fallback cuối cùng: gọi trực tiếp /api/speak trên ble-speaker (77.88.207.23:8080)
        base = str(cfg.ble_speaker_base_url or "http://77.88.207.23:8080").strip().rstrip("/")
        own_client = http_client is None
        client = http_client or httpx.Client(timeout=cfg.ble_speaker_timeout, follow_redirects=True)
        try:
            resp = client.post(f"{base}/api/speak", json={"text": cleaned, "lang": "vi"})
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("ok"):
                return {
                    "ok": True,
                    "text": cleaned,
                    "provider": "ble-speaker-local",
                    "voice": "espeak-ng-vi",
                    "alarm_sound": eff_alarm or "none",
                    "audio_format": "wav",
                    "audio_bytes_len": 0,
                    "request_id": "",
                    "async_url": "",
                    "fallback_errors": [str(tts_exc)],
                    "speaker_response": data,
                }
        except Exception:  # noqa: BLE001
            pass
        finally:
            if own_client:
                client.close()
        raise TtsError(str(tts_exc)) from tts_exc


def _should_speak_deduped(text: str, now: float | None = None) -> bool:
    """Chống đọc lặp lại cùng một nội dung thông báo khi gửi cho nhiều chat_id liên tiếp."""
    current = time.monotonic() if now is None else now
    key = text.strip()
    with _recent_spoken_lock:
        for old_k, exp in list(_recent_spoken_until.items()):
            if exp <= current:
                _recent_spoken_until.pop(old_k, None)
        if _recent_spoken_until.get(key, 0.0) > current:
            return False
        _recent_spoken_until[key] = current + _SPEAK_DEDUPE_SECONDS
        return True


def enqueue_telegram_tts_announcement(
    raw_message: str,
    settings: Settings | None = None,
) -> bool:
    """Kiểm tra tin nhắn Telegram có khớp bộ lọc Regex (mặc định `RK\\s*Burner`) không;
    nếu khớp thì phát còi báo động (`telegram_tts_alarm_sound`) và đọc TTS Tiếng Việt ra loa BLE 77.88.207.23.
    """
    cfg = settings or get_settings()
    if not (cfg.tts_enabled and cfg.ble_speaker_enabled and cfg.telegram_tts_speaker_enabled):
        return False
    match_info = matches_telegram_tts_filter(raw_message, cfg)
    if not match_info.get("matched"):
        return False
    spoken_text = format_telegram_tts_text(raw_message)
    if not spoken_text:
        return False
    if not _should_speak_deduped(spoken_text):
        return False

    global _tts_executor
    with _tts_executor_lock:
        if _tts_executor is None:
            _tts_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="telegram-tts-speaker")

    resolved_alarm = resolve_telegram_alarm_sound(raw_message, cfg.telegram_tts_alarm_sound)

    def _job() -> None:
        try:
            speak_on_ble_speaker(
                spoken_text,
                cfg,
                voice=cfg.tts_default_voice,
                speed=cfg.tts_default_speed,
                provider=cfg.tts_default_provider,
                alarm_sound=resolved_alarm,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không phát được TTS thông báo Telegram ra loa BLE: %s", exc)

    _tts_executor.submit(_job)
    return True
