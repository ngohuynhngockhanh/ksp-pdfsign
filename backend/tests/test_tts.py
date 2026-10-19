"""Unit and integration tests for Vietnamese TTS (Kokoro / VNMap / 9Router Google & Microsoft) and BLE Speaker."""
from __future__ import annotations

import json
import httpx
from fastapi.testclient import TestClient

from app import tts
from app.config import Settings, get_settings
from app.main import app


def _wav_bytes() -> bytes:
    return b"RIFF" + (120).to_bytes(4, "little") + b"WAVEfmt " + b"\x00" * 120


def _mp3_bytes() -> bytes:
    return b"ID3\x04\x00\x00" + b"\xff\xfb\x90\x64" * 40


def test_clean_and_format_telegram_tts_text():
    raw_messenger = "\n".join([
        "Tin nhắn Messenger mới",
        "Trang: INUT JSC - IoT and Edge Computing",
        "Page ID: 1698631723787176",
        "Mở trang: https://www.facebook.com/1698631723787176",
        "",
        "Khách Facebook: Anh Tài Merap",
        "PSID: 99887766",
        "Mở cuộc trò chuyện: https://www.facebook.com/messages/t/99887766",
        "",
        "Tin nhắn: Cho mình hỏi giá bộ Data Logger v1.1 nhé!",
        "",
        "Mở KSP: https://ksp-pdf-signer.p2p.inut.io.vn/messenger",
    ])
    formatted = tts.format_telegram_tts_text(raw_messenger)
    assert "Thông báo Telegram: Có tin nhắn khách hàng mới" in formatted
    assert "Anh Tài Merap" in formatted
    assert "Cho mình hỏi giá bộ Data Logger v1.1 nhé" in formatted
    assert "https://" not in formatted
    assert "99887766" not in formatted

    # Short text should be padded to >= 3 chars for Kokoro v5 compatibility
    assert len(tts.clean_text_for_tts("OK")) >= 3


def test_synthesize_fallback_chain_kokoro_to_vnmap_to_google_to_microsoft():
    cfg = Settings(
        tts_enabled=True,
        tts_kokoro_base_url="https://kokoro.p2p.inut.io.vn",
        tts_kokoro_api_key="kokoro-key-123",
        tts_vnmap_base_url="https://vnmap-tts.a.inut.vn",
        tts_vnmap_api_key="vnmap-key-456",
        tts_9router_base_url="http://127.0.0.1:20128/v1",
        tts_9router_api_key="sk-9router-test",
        tts_google_model="google-tts/vi",
        tts_microsoft_model="edge-tts/vi-VN-HoaiMyNeural",
    )

    # Case 1: Kokoro primary succeeds
    def handler_kokoro_ok(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://kokoro.p2p.inut.io.vn/hmi/tts/v5":
            assert request.headers.get("api-key") == "kokoro-key-123"
            assert request.headers.get("voice") == "diem_trinh"
            return httpx.Response(
                200,
                json={
                    "error": 0,
                    "async": "https://kokoro-cdn.p2p.inut.io.vn/req111.wav",
                    "request_id": "req111",
                },
            )
        if url == "https://kokoro-cdn.p2p.inut.io.vn/req111.wav":
            return httpx.Response(200, content=_wav_bytes())
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler_kokoro_ok)) as hc:
        res1 = tts.synthesize_vietnamese_tts("Xin chào hệ thống KSP", cfg, poll_interval=0.01, http_client=hc)
        assert res1.provider == "kokoro"
        assert res1.audio_format == "wav"
        assert res1.request_id == "req111"
        assert res1.audio_bytes.startswith(b"RIFF")

    # Case 2: Kokoro fails -> VNMap TTS succeeds
    def handler_vnmap_ok(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://kokoro.p2p.inut.io.vn/hmi/tts/v5":
            return httpx.Response(503, json={"error": 6, "message": "Queue full"})
        if url == "https://vnmap-tts.a.inut.vn/hmi/tts/v5":
            assert request.headers.get("api-key") == "vnmap-key-456"
            return httpx.Response(
                200,
                json={
                    "error": 0,
                    "async": "https://vnmap-tts-cdn.a.inut.vn/req222.wav",
                    "request_id": "req222",
                },
            )
        if url == "https://vnmap-tts-cdn.a.inut.vn/req222.wav":
            return httpx.Response(200, content=_wav_bytes())
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler_vnmap_ok)) as hc:
        res2 = tts.synthesize_vietnamese_tts("Xin chào hệ thống KSP", cfg, poll_interval=0.01, http_client=hc)
        assert res2.provider == "vnmap-tts"
        assert res2.audio_format == "wav"
        assert len(res2.fallback_errors) == 1

    # Case 3: Kokoro & VNMap fail -> 9Router Google succeeds
    def handler_google_ok(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/hmi/tts/v5" in url:
            return httpx.Response(502, text="Bad gateway")
        if url == "http://127.0.0.1:20128/v1/audio/speech":
            body = json.loads(request.content.decode("utf-8"))
            assert request.headers.get("authorization") == "Bearer sk-9router-test"
            if body["model"] == "google-tts/vi":
                return httpx.Response(200, content=_mp3_bytes(), headers={"Content-Type": "audio/mp3"})
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler_google_ok)) as hc:
        res3 = tts.synthesize_vietnamese_tts("Xin chào hệ thống KSP", cfg, poll_interval=0.01, http_client=hc)
        assert res3.provider == "9router-google"
        assert res3.voice == "google-tts/vi"
        assert res3.audio_format == "mp3"
        assert len(res3.fallback_errors) == 2

    # Case 4: Kokoro, VNMap, and Google fail -> 9Router Microsoft Edge succeeds
    def handler_microsoft_ok(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/hmi/tts/v5" in url:
            return httpx.Response(502, text="Bad gateway")
        if url == "http://127.0.0.1:20128/v1/audio/speech":
            body = json.loads(request.content.decode("utf-8"))
            if body["model"] == "google-tts/vi":
                return httpx.Response(503, json={"error": "Google rate limited"})
            if body["model"] == "edge-tts/vi-VN-HoaiMyNeural":
                return httpx.Response(200, content=_mp3_bytes(), headers={"Content-Type": "audio/mp3"})
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler_microsoft_ok)) as hc:
        res4 = tts.synthesize_vietnamese_tts("Xin chào hệ thống KSP", cfg, poll_interval=0.01, http_client=hc)
        assert res4.provider == "9router-microsoft"
        assert res4.voice == "edge-tts/vi-VN-HoaiMyNeural"
        assert res4.audio_format == "mp3"
        assert len(res4.fallback_errors) == 3


def test_speak_on_ble_speaker_uploads_audio():
    cfg = Settings(
        tts_kokoro_base_url="https://kokoro.p2p.inut.io.vn",
        tts_kokoro_api_key="kokoro-key-123",
        ble_speaker_base_url="http://77.88.207.23:8080",
    )
    uploaded_formats: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://kokoro.p2p.inut.io.vn/hmi/tts/v5":
            return httpx.Response(
                200,
                json={"error": 0, "async": "https://kokoro-cdn.p2p.inut.io.vn/a1.wav", "request_id": "a1"},
            )
        if url == "https://kokoro-cdn.p2p.inut.io.vn/a1.wav":
            return httpx.Response(200, content=_wav_bytes())
        if url.startswith("http://77.88.207.23:8080/api/upload"):
            uploaded_formats.append(request.headers.get("X-Audio-Format", ""))
            return httpx.Response(200, json={"ok": True, "file": "/tmp/ble_speaker_uploads/upload_1.wav"})
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler)) as hc:
        out = tts.speak_on_ble_speaker("Có tin nhắn Telegram mới", cfg, http_client=hc)
        assert out["ok"] is True
        assert out["provider"] == "kokoro"
        assert uploaded_formats == ["wav"]


def test_speak_deduplication_window():
    with tts._recent_spoken_lock:
        tts._recent_spoken_until.clear()
    assert tts._should_speak_deduped("Thông báo A", now=100.0) is True
    assert tts._should_speak_deduped("Thông báo A", now=105.0) is False
    assert tts._should_speak_deduped("Thông báo B", now=105.0) is True
    assert tts._should_speak_deduped("Thông báo A", now=113.0) is True


def test_rk_burner_regex_filter_and_phonetic_format():
    cfg = Settings(
        telegram_tts_filter_enabled=True,
        telegram_tts_regex=r"RK\s*Burner",
    )
    msg_rk = "✅ RK Burner\nJob: burn-207-194\nImage: inut-v1.1.img\nrkdeveloptool rd hoàn tất; burn image đã an toàn."
    msg_other = "Tin nhắn Messenger mới từ khách hàng hỏi báo giá"

    res_rk = tts.matches_telegram_tts_filter(msg_rk, cfg)
    assert res_rk["matched"] is True
    assert "RK Burner" in res_rk["matched_text"]

    res_other = tts.matches_telegram_tts_filter(msg_other, cfg)
    assert res_other["matched"] is False

    # Non-matching messages must be ignored by enqueue_telegram_tts_announcement
    assert tts.enqueue_telegram_tts_announcement(msg_other, cfg) is False

    spoken_rk = tts.format_telegram_tts_text(msg_rk)
    assert spoken_rk == "RK Burner: Đã nạp phần mềm hoàn tất, sẵn sàng chuyển bước tiếp theo."
    assert "burn-207-194" not in spoken_rk
    assert "inut-v1.1.img" not in spoken_rk

    spoken_step = tts.format_telegram_tts_text("🔔 RK Burner\noptional|optional_9e5e709dab204ba19d7708e776d345d1\nTrạng thái: succeeded")
    assert "optional_9e5e709dab204ba19d7708e776d345d1" not in spoken_step
    assert "Bước cài đặt mở rộng" in spoken_step
    assert "thành công" in spoken_step

    # Auto sound resolution: success -> 'success', fail -> 'alarm'
    assert tts.resolve_telegram_alarm_sound(msg_rk, "auto") == "success"
    assert tts.resolve_telegram_alarm_sound("🔔 RK Burner\nvpn|inut_207_184\nTrạng thái: succeeded", "auto") == "success"
    assert tts.resolve_telegram_alarm_sound("🔔 RK Burner\nvpn|inut_207_184\nTrạng thái: failed", "auto") == "alarm"
    assert tts.resolve_telegram_alarm_sound("🔔 RK Burner\nvpn|inut_207_184\nTrạng thái: partial_failed", "auto") == "alarm"
    assert tts.resolve_telegram_alarm_sound("❌ RK Burner: thiết bị Rockchip đã ngắt kết nối", "auto") == "alarm"

def test_tts_api_endpoints(tmp_path, monkeypatch):
    from app.db import reset_engine_for_tests

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    get_settings.cache_clear()
    reset_engine_for_tests()

    monkeypatch.setattr(
        tts,
        "get_ble_speaker_status",
        lambda _s=None, **_kw: {
            "ok": True,
            "speaker": {"name": "G-10", "mac": "C0:97:0C:E0:D9:79", "connected": True, "battery": 100, "volume": 75, "mute": False, "sink_name": "bluez"},
        },
    )
    monkeypatch.setattr(
        tts,
        "speak_on_ble_speaker",
        lambda text, _s=None, **kw: {
            "ok": True,
            "text": text,
            "provider": "kokoro" if kw.get("provider") in (None, "", "auto") else kw.get("provider"),
            "voice": kw.get("voice") or "diem_trinh",
            "audio_format": "wav",
            "audio_bytes_len": 189644,
            "request_id": "req-test",
            "async_url": "https://kokoro-cdn.p2p.inut.io.vn/req-test.wav",
            "fallback_errors": [],
        },
    )

    with TestClient(app) as client:
        login = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
        assert login.status_code == 200

        st = client.get("/api/tts/status")
        assert st.status_code == 200
        st_body = st.json()
        assert st_body["ok"] is True
        assert st_body["speaker_status"]["speaker"]["name"] == "G-10"
        assert any(v["id"] == "diem_trinh" for v in st_body["voices"]["kokoro"])

        sp = client.post("/api/tts/speak", json={"text": "Kiểm tra loa thông báo Telegram", "voice": "diem_trinh"})
        assert sp.status_code == 200
        assert sp.json()["ok"] is True
        assert sp.json()["provider"] == "kokoro"

        # Test regex evaluation endpoint
        rx_ok = client.post("/api/tts/test-regex", json={"message": "✅ RK Burner\nJob: 1\nTrạng thái: succeeded"})
        assert rx_ok.status_code == 200
        assert rx_ok.json()["matched"] is True
        assert "thành công" in rx_ok.json()["spoken_preview"]

        rx_no = client.post("/api/tts/test-regex", json={"message": "Đồng bộ thuế hoàn tất"})
        assert rx_no.status_code == 200
        assert rx_no.json()["matched"] is False

        # Test updating regex config dynamically
        cfg_put = client.put(
            "/api/tts/config",
            json={
                "telegram_tts_filter_enabled": True,
                "telegram_tts_regex": r"RK\s*Burner|Hải quan",
                "telegram_tts_alarm_sound": "chime",
            },
        )
        assert cfg_put.status_code == 200
        assert cfg_put.json()["telegram_tts_regex"] == r"RK\s*Burner|Hải quan"
        assert cfg_put.json()["telegram_tts_alarm_sound"] == "chime"

        rx_hq = client.post("/api/tts/test-regex", json={"message": "Tờ khai Hải quan đã thông quan"})
        assert rx_hq.status_code == 200
        assert rx_hq.json()["matched"] is True
