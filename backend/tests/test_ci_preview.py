"""Tests for 7-day auto-purging CI preview publisher & public `/d/{token}` review links."""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from PIL import Image

from app import drive as drive_mod
from app import main as main_mod
from app import storage_drive, telegram
from app.config import get_settings
from app.db import Folder, FolderItem, get_session


def _anon() -> TestClient:
    return TestClient(main_mod.app)


def _login_admin(client: TestClient) -> None:
    s = get_settings()
    r = client.post(
        "/api/login",
        json={"username": s.app_admin_username, "password": s.app_admin_password},
    )
    assert r.status_code == 200, r.text


def _make_png(width: int = 320, height: int = 240) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(14, 165, 233))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_mp4(payload_size: int = 16 * 1024) -> bytes:
    ftyp = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41"
    body = bytes((i % 251 for i in range(payload_size)))
    mdat_size = (8 + len(body)).to_bytes(4, "big")
    return ftyp + mdat_size + b"mdat" + body


def test_ci_preview_auth_publish_telegram_and_auto_purge(client, monkeypatch):
    anon = _anon()
    png_bytes = _make_png()
    mp4_bytes = _make_mp4()
    md_bytes = b"# Visual E2E Summary\n\n- Commit: `adaadd7`\n- Verdict: **PASS**\n"

    # 1. Unauthenticated must fail with 401
    r_unauth = anon.post(
        "/api/ci-preview/publish",
        data={"repo": "inut-p2p", "commit": "adaadd7"},
        files=[("files", ("REPORT.md", md_bytes, "text/markdown"))],
    )
    assert r_unauth.status_code == 401

    _login_admin(client)

    # Create a mail:send key -> must fail with 403 on ci-preview endpoints
    r_mail_key = client.post(
        "/api/service-keys",
        json={"name": "mail-only-ci-test", "scopes": ["mail:send"]},
    )
    assert r_mail_key.status_code == 200, r_mail_key.text
    mail_key = r_mail_key.json()["api_key"]

    r_forbidden = anon.post(
        "/api/ci-preview/publish",
        headers={"X-API-Key": mail_key},
        data={"repo": "inut-p2p", "commit": "adaadd7"},
        files=[("files", ("REPORT.md", md_bytes, "text/markdown"))],
    )
    assert r_forbidden.status_code == 403, r_forbidden.text

    # Create dedicated ci:publish key
    r_ci_key = client.post(
        "/api/service-keys",
        json={"name": "ci-preview-publisher-test", "scopes": ["ci:publish"]},
    )
    assert r_ci_key.status_code == 200, r_ci_key.text
    ci_key = r_ci_key.json()["api_key"]
    assert set(r_ci_key.json()["key"]["scopes"]) == {"ci:publish"}

    # Mock Telegram delivery
    tg_calls: list[tuple[str, str, bool]] = []

    class FakeTGClient:
        def __init__(self, settings):
            pass

        def send_message(self, chat_id, text, *, speak_tts=True, parse_mode=""):
            tg_calls.append((chat_id, text, speak_tts))
            return {"message_id": 101}

        def close(self):
            pass

    monkeypatch.setattr(telegram, "is_configured", lambda _s: True)
    monkeypatch.setattr(telegram, "admin_chat_ids", lambda _db: ["987654321"])
    monkeypatch.setattr(telegram, "TelegramClient", FakeTGClient)

    # 2. Seed a normal customer folder to prove purge NEVER touches non-ephemeral folders
    r_cust_folder = client.post(
        "/api/drive/folders",
        json={"name": "Ho_So_Khach_Hang_That", "project_code": "KH-001"},
    )
    assert r_cust_folder.status_code == 200, r_cust_folder.text
    cust_folder_id = r_cust_folder.json()["folder"]["id"]
    r_cust_up = client.post(
        f"/api/drive/folders/{cust_folder_id}/upload",
        files=[("files", ("anh_nghiem_thu.png", png_bytes, "image/png"))],
    )
    assert r_cust_up.status_code == 200, r_cust_up.text
    cust_item_id = r_cust_up.json()["items"][0]["id"]
    gen = get_session()
    db = next(gen)
    try:
        cust_item = db.get(FolderItem, cust_item_id)
        assert cust_item is not None
        cust_asset_id = cust_item.storage_doc_id
    finally:
        gen.close()
    assert storage_drive.find_asset_path(cust_asset_id, ".png") is not None

    # 3. Publish CI preview with REPORT.md + MP4 + PNG using X-API-Key
    r_pub = anon.post(
        "/api/ci-preview/publish",
        headers={"X-API-Key": ci_key},
        data={
            "repo": "inut-p2p",
            "commit": "adaadd7",
            "branch": "main",
            "verdict": "PASS",
            "summary": "10/10 flows PASS · 0 consoleErrors · 0 overflow",
            "ttl_days": "7",
            "notify_telegram": "true",
        },
        files=[
            ("files", ("screenshot.png", png_bytes, "image/png")),
            ("files", ("desktop-flow.mp4", mp4_bytes, "video/mp4")),
            ("files", ("REPORT.md", md_bytes, "text/markdown")),
        ],
    )
    assert r_pub.status_code == 200, r_pub.text
    pub = r_pub.json()
    assert pub["ok"] is True
    assert pub["short_path"].startswith("/d/")
    assert pub["token"]
    assert pub["files_uploaded"] == 3
    assert pub["mp4_count"] == 1
    assert pub["image_count"] == 1
    assert pub["report_count"] == 1
    assert pub["telegram_sent"] == 1

    # Verify Telegram message sent once silently (speak_tts=False) containing link + verdict
    assert len(tg_calls) == 1
    assert tg_calls[0][0] == "987654321"
    assert tg_calls[0][2] is False
    assert pub["share_url"] in tg_calls[0][1]
    assert "PASS" in tg_calls[0][1]

    # 4. Verify public access works without passcode, X-Robots-Tag set, sorted REPORT -> MP4 -> PNG, Range 206 OK
    token = pub["token"]
    r_get = anon.get(f"/api/public/drive/{token}")
    assert r_get.status_code == 200, r_get.text
    assert r_get.headers.get("X-Robots-Tag") == "noindex, nofollow"
    payload = r_get.json()
    assert payload["locked"] is False
    assert payload["has_passcode"] is False
    names = [it["display_name"] for it in payload["items"]]
    assert names == ["REPORT.md", "desktop-flow.mp4", "screenshot.png"]

    mp4_item = payload["items"][1]
    r_range = anon.get(
        f"/api/public/drive/{token}/items/{mp4_item['id']}/view",
        headers={"Range": "bytes=0-1023"},
    )
    assert r_range.status_code == 206, r_range.text
    assert r_range.headers.get("content-type") == "video/mp4"
    assert r_range.headers.get("X-Robots-Tag") == "noindex, nofollow"

    # Record asset IDs for disk GC verification
    ci_folder_id = pub["folder_id"]
    gen = get_session()
    db = next(gen)
    try:
        ci_items = list(db.query(FolderItem).filter(FolderItem.folder_id == ci_folder_id).all())
        ci_assets = [(it.storage_doc_id, it.thumb_doc_id, it.file_ext) for it in ci_items]
        for s_id, _, ext in ci_assets:
            assert storage_drive.find_asset_path(s_id, ext) is not None

        # Backdate CI folder's auto_delete_at to past (1h ago) while normal folder stays NULL
        ci_folder = db.get(Folder, ci_folder_id)
        cust_folder = db.get(Folder, cust_folder_id)
        assert ci_folder is not None and ci_folder.auto_delete_at is not None
        assert cust_folder is not None and cust_folder.auto_delete_at is None
        ci_folder.auto_delete_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
        db.commit()
    finally:
        gen.close()

    # 5. Trigger auto-purge -> CI folder, share & disk assets deleted; normal customer folder completely intact
    r_purge = anon.post("/api/ci-preview/purge", headers={"X-API-Key": ci_key})
    assert r_purge.status_code == 200, r_purge.text
    purge_body = r_purge.json()
    assert purge_body["folders_deleted"] == 1
    assert purge_body["items_deleted"] == 3
    assert purge_body["assets_gc"] >= 3

    assert anon.get(f"/api/public/drive/{token}").status_code == 404
    for s_id, t_id, ext in ci_assets:
        assert storage_drive.find_asset_path(s_id, ext) is None
        if t_id:
            assert storage_drive.find_thumb_path(t_id) is None

    # Normal customer folder + root CI container must remain untouched
    gen = get_session()
    db = next(gen)
    try:
        assert db.get(Folder, cust_folder_id) is not None
        root_ci = drive_mod.get_or_create_ci_preview_root(db)
        assert root_ci is not None
        assert root_ci.auto_delete_at is None
    finally:
        gen.close()
    assert storage_drive.find_asset_path(cust_asset_id, ".png") is not None
