"""Comprehensive test suite for Google Drive-style Folder & Share backend.

Covers:
- Admin RBAC (anon 401, customer 403)
- Folder CRUD, solar_handover 5-section preset, hierarchy depth <= 5, cycle prevention, tree, reorder
- Customer merge/delete FK hygiene with Folder
- Streaming upload, Pillow WebP thumbnail generation, magic-byte & dangerous-ext rejection, path traversal guards
- Chunked upload (init -> chunk -> complete) with SHA-256 & magic-byte validation
- Batch document attach + deduplication + safe cascade delete (never deletes Document rows, GCs orphan Drive assets)
- Public share security invariants:
  - Cross-folder IDOR -> 404 (root_id + ancestor walk + include_subfolders=False)
  - Passcode lock (zero leakage) + 5-fail/15-min brute-force -> 429 + HttpOnly cookie invalidation on passcode change
  - Revoke / expire / max_views -> 410 Gone
  - view_only permission & allow_zip_download / allow_neac_verify enforcement
- HTTP Range 206 Partial Content on MP4 video streaming + Accept-Ranges + X-Accel-Buffering
- Disk-backed streaming ZIP integrity (ZIP_STORED vs ZIP_DEFLATED, arcname sanitization, temp file cleanup)
- QR SVG valid XML, pyHanko/NEAC verify + rate limit, HMAC telemetry nonce + replay rejection + CSV access logs
- /share/folder/{token} 302 redirect, CSP headers on /d/{token}, and backward compatibility of legacy /s/{token}
"""
from __future__ import annotations

import hashlib
import io
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import drive as drive_mod
from app import storage, storage_drive
from app.config import get_settings
from app.db import Customer, Document, Folder, FolderShare, User, get_session
from app.main import app
from app.security import hash_password
from tests.test_api import PDF, _login, _sign_one


def _make_png(width: int = 800, height: int = 600, color=(12, 118, 92)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=color)
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg(width: int = 640, height: int = 480) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(30, 60, 120))
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_mp4(payload_size: int = 24 * 1024) -> bytes:
    # Valid ISO BMFF ftyp box + mdat box with deterministic payload for Range & SHA-256 verification
    ftyp = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41"
    body = bytes((i % 251 for i in range(payload_size)))
    mdat_size = (8 + len(body)).to_bytes(4, "big")
    return ftyp + mdat_size + b"mdat" + body


def _make_docx_zip() -> bytes:
    import docx

    d = docx.Document()
    d.add_paragraph("Biên bản nghiệm thu 16 trạm VNPT NMS — Việt Hùng Power")
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_drive_caches():
    drive_mod.reset_runtime_caches_for_tests()
    yield
    drive_mod.reset_runtime_caches_for_tests()


def _anon() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. RBAC & Authentication
# ---------------------------------------------------------------------------
def test_drive_admin_rbac(client):
    anon = _anon()
    assert anon.get("/api/drive/folders").status_code == 401
    assert anon.post("/api/drive/folders", json={"name": "Blocked"}).status_code == 401

    # Customer user -> 403 on admin Drive endpoints
    gen = get_session()
    db = next(gen)
    try:
        db.add(
            User(
                username="drive_cust",
                password_hash=hash_password("CustPass!2026"),
                role="customer",
                must_change_password=False,
            )
        )
        db.commit()
    finally:
        gen.close()

    cust = _anon()
    assert cust.post("/api/login", json={"username": "drive_cust", "password": "CustPass!2026"}).status_code == 200
    assert cust.get("/api/drive/folders").status_code == 403
    assert cust.post("/api/drive/folders", json={"name": "Nope"}).status_code == 403


# ---------------------------------------------------------------------------
# 2. Folder CRUD, Preset solar_handover, Max Depth 5, Cycle Check, Customer Merge/Delete
# ---------------------------------------------------------------------------
def test_folder_preset_hierarchy_cycle_depth_and_customer_fk(client):
    _login(client)
    c1 = client.post("/api/customers", json={"name": "CÔNG TY CỔ PHẦN VIỆT HÙNG POWER", "tax_code": "2802975029"}).json()
    c2 = client.post("/api/customers", json={"name": "Việt Hùng Power Old", "tax_code": ""}).json()

    # Create with solar_handover preset -> 5 exact clean sections
    res = client.post(
        "/api/drive/folders",
        json={
            "name": "Việt Hùng Power — Hồ sơ nghiệm thu 16 trạm",
            "customer_id": c2["id"],
            "project_code": "VH-SOLAR-16TRAM-2026",
            "preset": "solar_handover",
        },
    )
    assert res.status_code == 200, res.text
    detail = res.json()
    root_id = detail["folder"]["id"]
    assert detail["folder"]["root_id"] == root_id
    sub_names = [s["name"] for s in detail["subfolders"]]
    assert sub_names == [
        "01_Hop_Dong_Va_Phap_Ly",
        "02_Bao_Cao_Va_Bien_Ban_Nghiem_Thu_16_Tram",
        "03_Minh_Chung_16_Tram_VNPT_NMS",
        "04_Video_Nghiem_Thu",
        "05_Tai_Lieu_Huong_Dan",
    ]

    # Tree endpoint
    tree = client.get(f"/api/drive/folders/{root_id}/tree").json()
    assert tree["id"] == root_id
    assert len(tree["children"]) == 5

    # Reorder subfolders
    reversed_ids = [s["id"] for s in reversed(detail["subfolders"])]
    assert client.post(f"/api/drive/folders/{root_id}/reorder", json={"subfolder_ids": reversed_ids}).status_code == 200
    reloaded = client.get(f"/api/drive/folders/{root_id}").json()
    assert [s["id"] for s in reloaded["subfolders"]] == reversed_ids

    # Depth limit = 5: root(1) -> d2 -> d3 -> d4 -> d5 OK, d6 -> 400
    d2 = detail["subfolders"][0]["id"]
    d3 = client.post("/api/drive/folders", json={"name": "Level 3", "parent_id": d2}).json()["folder"]["id"]
    d4 = client.post("/api/drive/folders", json={"name": "Level 4", "parent_id": d3}).json()["folder"]["id"]
    d5 = client.post("/api/drive/folders", json={"name": "Level 5", "parent_id": d4}).json()["folder"]["id"]
    d6_resp = client.post("/api/drive/folders", json={"name": "Level 6", "parent_id": d5})
    assert d6_resp.status_code == 400

    # Cycle prevention: moving root into d3 or self -> 400
    assert client.patch(f"/api/drive/folders/{root_id}", json={"parent_id": root_id}).status_code == 400
    assert client.patch(f"/api/drive/folders/{root_id}", json={"parent_id": d3}).status_code == 400

    # Moving a 2-level subtree under d4 would create depth 6 -> 400
    other = client.post("/api/drive/folders", json={"name": "Other Root"}).json()["folder"]["id"]
    other_child = client.post("/api/drive/folders", json={"name": "Other Child", "parent_id": other}).json()["folder"]["id"]
    assert client.patch(f"/api/drive/folders/{other}", json={"parent_id": d4}).status_code == 400

    # Moving a 2-level subtree under d3 creates depth 5 -> OK and updates root_id on descendant!
    mv_ok = client.patch(f"/api/drive/folders/{other}", json={"parent_id": d3})
    assert mv_ok.status_code == 200, mv_ok.text
    assert mv_ok.json()["root_id"] == root_id
    child_after = client.get(f"/api/drive/folders/{other_child}").json()["folder"]
    assert child_after["root_id"] == root_id

    # Merge c2 -> c1 transfers Folder.customer_id
    merge = client.post("/api/customers/merge", json={"source_id": c2["id"], "target_id": c1["id"]})
    assert merge.status_code == 200, merge.text
    f_after_merge = client.get(f"/api/drive/folders/{root_id}").json()["folder"]
    assert f_after_merge["customer_id"] == c1["id"]
    assert f_after_merge["customer_name"] == "CÔNG TY CỔ PHẦN VIỆT HÙNG POWER"

    # Delete c1 detaches Folder.customer_id cleanly without deleting folder
    del_c1 = client.delete(f"/api/customers/{c1['id']}")
    assert del_c1.status_code == 200, del_c1.text
    f_after_del = client.get(f"/api/drive/folders/{root_id}").json()["folder"]
    assert f_after_del["customer_id"] is None


# ---------------------------------------------------------------------------
# 3. Magic-Byte Security, Blocked Extensions, Path Traversal, Thumbnails & Asset GC
# ---------------------------------------------------------------------------
def test_upload_magic_bytes_blocklist_thumbnails_and_gc(client):
    _login(client)
    fid = client.post("/api/drive/folders", json={"name": "Security Upload Test"}).json()["folder"]["id"]

    # Hard-blocked extensions
    for bad_name, bad_bytes in [
        ("xss.html", b"<html><script>alert(1)</script></html>"),
        ("xss.htm", b"<html>hi</html>"),
        ("vector.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        ("payload.js", b"alert(1);"),
        ("malware.exe", b"MZ\x90\x00"),
        ("shell.sh", b"#!/bin/sh\nrm -rf /"),
    ]:
        r = client.post(f"/api/drive/folders/{fid}/upload", files={"files": (bad_name, bad_bytes, "application/octet-stream")})
        assert r.status_code == 400, f"Expected 400 for {bad_name}, got {r.status_code}"

    # Disguised payloads (magic-byte mismatch)
    for fake_name, fake_bytes in [
        ("fake.pdf", b"<html><script>alert(1)</script></html>"),
        ("fake.png", b"<svg onload=alert(1)></svg>"),
        ("fake.jpg", b"console.log('pwned')"),
        ("fake.webp", b"RIFF1234AVI "),
        ("fake.mp4", b"<html>not a video</html>"),
        ("fake.docx", b"<html>not a zip</html>"),
        ("evil.xml", b"<!DOCTYPE x [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><x>&xxe;</x>"),
        ("svg_as.xml", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        ("html_as.md", b"<!DOCTYPE html><html><script>alert(1)</script></html>"),
        ("corrupt.png", b"\x89PNG\r\n\x1a\n" + b"not-real-png-chunks"),
    ]:
        r = client.post(f"/api/drive/folders/{fid}/upload", files={"files": (fake_name, fake_bytes, "application/octet-stream")})
        assert r.status_code == 400, f"Expected 400 for disguised {fake_name}, got {r.status_code}"

    # Path traversal guards in storage_drive
    with pytest.raises(ValueError):
        storage_drive.asset_path_for("../etc/passwd", ".pdf")
    with pytest.raises(ValueError):
        storage_drive.thumb_path_for("../../evil")

    # Valid PNG + JPEG + PDF + MD upload
    png_bytes = _make_png(1200, 800)
    jpg_bytes = _make_jpeg(640, 480)
    up = client.post(
        f"/api/drive/folders/{fid}/upload",
        files=[
            ("files", ("Tram_7_162_Realtime.png", png_bytes, "image/png")),
            ("files", ("Tram_7_164_Chart.jpg", jpg_bytes, "image/jpeg")),
            ("files", ("BaoCao.pdf", PDF, "application/pdf")),
            ("files", ("README_NghiemThu.md", b"# Nghiem thu\n16/16 tram OK\n", "text/markdown")),
        ],
        data={"section_tag": "03_Minh_Chung_16_Tram_VNPT_NMS"},
    )
    assert up.status_code == 200, up.text
    items = up.json()["items"]
    assert len(items) == 4

    png_item = next(i for i in items if i["file_ext"] == ".png")
    assert png_item["sha256"] == hashlib.sha256(png_bytes).hexdigest()
    assert png_item["file_size"] == len(png_bytes)
    assert png_item["media_meta"]["width"] == 1200
    assert png_item["media_meta"]["height"] == 800
    assert png_item["has_thumb"] is True

    # Thumbnail served as real WebP <= 480px
    th = client.get(f"/api/drive/items/{png_item['id']}/thumb")
    assert th.status_code == 200
    assert th.headers["content-type"].startswith("image/webp")
    assert th.content[:4] == b"RIFF" and th.content[8:12] == b"WEBP"
    with Image.open(io.BytesIO(th.content)) as im:
        assert max(im.size) <= 480

    # Check physical files exist, then delete folder and confirm GC removed assets & thumbs
    drive_files_before = list((get_settings().data_path / "drive").glob("*"))
    thumb_files_before = list((get_settings().data_path / "drive_thumbs").glob("*.webp"))
    assert len(drive_files_before) == 4
    assert len(thumb_files_before) == 2

    del_res = client.delete(f"/api/drive/folders/{fid}")
    assert del_res.status_code == 200
    assert del_res.json()["gc_assets"] == 4
    assert list((get_settings().data_path / "drive").glob("*")) == []
    assert list((get_settings().data_path / "drive_thumbs").glob("*.webp")) == []


# ---------------------------------------------------------------------------
# 4. Chunked Upload Assembly (MP4) + HTTP Range 206 Streaming
# ---------------------------------------------------------------------------
def test_chunked_upload_mp4_and_http_range_206(client):
    _login(client)
    fid = client.post("/api/drive/folders", json={"name": "Video Folder"}).json()["folder"]["id"]
    mp4_bytes = _make_mp4(36 * 1024)
    full_sha = hashlib.sha256(mp4_bytes).hexdigest()
    chunk_size = 12 * 1024  # 3 chunks

    init = client.post(
        "/api/drive/uploads/init",
        json={
            "folder_id": fid,
            "filename": "Nghiem_Thu_16_Tram.mp4",
            "file_size": len(mp4_bytes),
            "mime_type": "video/mp4",
            "chunk_size": chunk_size,
            "section_tag": "04_Video_Nghiem_Thu",
        },
    )
    assert init.status_code == 200, init.text
    uid = init.json()["upload_id"]
    total_chunks = init.json()["total_chunks"]
    assert total_chunks == 4 or total_chunks == 3

    # Upload chunks (mix raw bytes & multipart to confirm both work)
    for idx in range(total_chunks):
        part = mp4_bytes[idx * chunk_size : (idx + 1) * chunk_size]
        if idx == 1:
            r = client.put(
                f"/api/drive/uploads/{uid}/chunk?index={idx}",
                files={"file": (f"chunk_{idx}", part, "application/octet-stream")},
            )
        else:
            r = client.put(
                f"/api/drive/uploads/{uid}/chunk?index={idx}",
                content=part,
                headers={"Content-Type": "application/octet-stream"},
            )
        assert r.status_code == 200, r.text
        assert r.json()["bytes_received"] == len(part)

    # Wrong SHA-256 fails cleanly without deleting session
    bad_comp = client.post(f"/api/drive/uploads/{uid}/complete", json={"sha256": "0" * 64})
    assert bad_comp.status_code == 400

    # Correct SHA-256 stitches atomically & cleans up drive_tmp/{uid}
    comp = client.post(f"/api/drive/uploads/{uid}/complete", json={"sha256": full_sha})
    assert comp.status_code == 200, comp.text
    item = comp.json()
    assert item["file_ext"] == ".mp4"
    assert item["file_category"] == "video"
    assert item["file_size"] == len(mp4_bytes)
    assert item["sha256"] == full_sha
    assert not (get_settings().data_path / "drive_tmp" / uid).exists()

    # Share publicly and test HTTP Range 206 Partial Content
    sh = client.post(f"/api/drive/folders/{fid}/shares", json={"label": "Video Test"}).json()
    token = sh["token"]
    anon = _anon()

    r_range1 = anon.get(
        f"/api/public/drive/{token}/items/{item['id']}/view",
        headers={"Range": "bytes=0-1023"},
    )
    assert r_range1.status_code == 206
    assert r_range1.headers.get("accept-ranges") == "bytes"
    assert r_range1.headers.get("x-accel-buffering") == "no"
    assert r_range1.headers.get("content-range") == f"bytes 0-1023/{len(mp4_bytes)}"
    assert r_range1.content == mp4_bytes[:1024]

    r_range2 = anon.get(
        f"/api/public/drive/{token}/items/{item['id']}/view",
        headers={"Range": "bytes=2048-4095"},
    )
    assert r_range2.status_code == 206
    assert r_range2.content == mp4_bytes[2048:4096]

    # Admin /file also supports Range 206
    r_adm_range = client.get(
        f"/api/drive/items/{item['id']}/file",
        headers={"Range": "bytes=0-511"},
    )
    assert r_adm_range.status_code == 206
    assert r_adm_range.content == mp4_bytes[:512]


# ---------------------------------------------------------------------------
# 5. Batch Attach Deduplication, Never Delete Document Rows, Recursive Stats & Streaming ZIP
# ---------------------------------------------------------------------------
def test_batch_attach_dedupe_stats_and_streaming_zip(client):
    _login(client)
    # Create 1 signed PDF + 1 unsigned PDF in vault
    s_resp = _sign_one(client)
    assert s_resp.status_code == 200, s_resp.text
    up_doc = client.post("/api/documents/upload", files={"file": ("unsigned.pdf", PDF, "application/pdf")})
    assert up_doc.status_code == 200
    unsigned_pk = up_doc.json()["id"]

    docs_list = client.get("/api/documents").json()["items"]
    signed_doc = next(d for d in docs_list if d["signed"])
    signed_pk = signed_doc["id"]

    # Create root + child subfolder
    root = client.post("/api/drive/folders", json={"name": "VH Power Pack", "preset": "solar_handover"}).json()
    root_id = root["folder"]["id"]
    sec1_id = root["subfolders"][0]["id"]
    sec3_id = root["subfolders"][2]["id"]
    sec4_id = root["subfolders"][3]["id"]
    sec5_id = root["subfolders"][4]["id"]

    # Attach both docs to section 1
    att1 = client.post(
        f"/api/drive/folders/{sec1_id}/attach-documents",
        json={"document_ids": [signed_pk, unsigned_pk, signed_pk], "section_tag": "01_Hop_Dong"},
    )
    assert att1.status_code == 200, att1.text
    assert att1.json()["total_attached"] == 2
    assert len(att1.json()["attached"]) == 2
    signed_item = next(x for x in att1.json()["attached"] if x["document_id"] == signed_pk)
    assert signed_item["signed"] is True
    assert signed_item["file_size"] > 0

    # Re-attaching same docs deduplicates cleanly
    att2 = client.post(
        f"/api/drive/folders/{sec1_id}/attach-documents",
        json={"document_ids": [signed_pk, unsigned_pk]},
    )
    assert att2.status_code == 200
    assert att2.json()["total_attached"] == 0
    assert set(att2.json()["skipped_document_ids"]) == {signed_pk, unsigned_pk}

    # Upload PNG, MP4, MD into child folders
    png_data = _make_png(400, 300)
    mp4_data = _make_mp4(8192)
    md_data = b"# Huong dan\nNoi dung huong dan sach 100%\n"
    assert client.post(f"/api/drive/folders/{sec3_id}/upload", files={"files": ("Tram_01.png", png_data, "image/png")}).status_code == 200
    assert client.post(f"/api/drive/folders/{sec4_id}/upload", files={"files": ("Video_Demo.mp4", mp4_data, "video/mp4")}).status_code == 200
    assert client.post(f"/api/drive/folders/{sec5_id}/upload", files={"files": ("HDSD.md", md_data, "text/markdown")}).status_code == 200

    # Verify recursive stats on root folder
    root_detail = client.get(f"/api/drive/folders/{root_id}").json()
    st = root_detail["folder"]["stats"]
    assert st["total_items"] == 5
    assert st["pdfs"] == 2
    assert st["signed_pdfs"] == 1
    assert st["images"] == 1
    assert st["videos"] == 1
    assert st["others"] == 1
    assert st["subfolder_count"] == 5
    assert st["total_bytes"] >= len(png_data) + len(mp4_data) + len(md_data)

    # Share publicly & download streaming ZIP
    sh = client.post(f"/api/drive/folders/{root_id}/shares", json={"label": "Full Pack"}).json()
    token = sh["token"]
    anon = _anon()
    z_resp = anon.get(f"/api/public/drive/{token}/download.zip")
    assert z_resp.status_code == 200, z_resp.text
    assert z_resp.headers["content-type"] == "application/zip"
    assert z_resp.headers.get("x-accel-buffering") == "no"

    with zipfile.ZipFile(io.BytesIO(z_resp.content)) as zf:
        infos = {zi.filename: zi for zi in zf.infolist()}
        assert len(infos) == 5
        for name in infos:
            assert not name.startswith("/")
            assert ".." not in name.split("/")
        # Verify compression strategy: ZIP_STORED for mp4/png/pdf, ZIP_DEFLATED for md
        mp4_arc = next(n for n in infos if n.endswith(".mp4"))
        png_arc = next(n for n in infos if n.endswith(".png"))
        md_arc = next(n for n in infos if n.endswith(".md"))
        assert infos[mp4_arc].compress_type == zipfile.ZIP_STORED
        assert infos[png_arc].compress_type == zipfile.ZIP_STORED
        assert infos[md_arc].compress_type == zipfile.ZIP_DEFLATED
        assert zf.read(mp4_arc) == mp4_data
        assert zf.read(png_arc) == png_data
        assert zf.read(md_arc) == md_data

    # Temp ZIP file must be cleaned up by BackgroundTask!
    assert list((get_settings().data_path / "drive_tmp").glob("zip_*.zip")) == []

    # Deleting folder NEVER deletes underlying Document rows or vault PDF files!
    assert client.delete(f"/api/drive/folders/{root_id}").status_code == 200
    assert client.get(f"/api/documents/{signed_pk}/download").status_code == 200
    assert client.get(f"/api/documents/{unsigned_pk}/download").status_code == 200


# ---------------------------------------------------------------------------
# 6. Public Share Security: IDOR 404, Passcode Gate + 429 + Cookie Invalidation, Revoke/Expire/MaxViews 410
# ---------------------------------------------------------------------------
def test_public_idor_isolation(client):
    _login(client)
    # Tree A: Parent P -> Shared S -> Child C; plus Sibling S2 under P
    p_id = client.post("/api/drive/folders", json={"name": "Parent P"}).json()["folder"]["id"]
    s_id = client.post("/api/drive/folders", json={"name": "Shared S", "parent_id": p_id}).json()["folder"]["id"]
    s2_id = client.post("/api/drive/folders", json={"name": "Sibling S2", "parent_id": p_id}).json()["folder"]["id"]
    c_id = client.post("/api/drive/folders", json={"name": "Child C", "parent_id": s_id}).json()["folder"]["id"]

    # Tree B: completely separate root
    b_id = client.post("/api/drive/folders", json={"name": "Secret Tree B"}).json()["folder"]["id"]

    # Upload 1 file in each folder
    item_p = client.post(f"/api/drive/folders/{p_id}/upload", files={"files": ("p.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]
    item_s = client.post(f"/api/drive/folders/{s_id}/upload", files={"files": ("s.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]
    item_s2 = client.post(f"/api/drive/folders/{s2_id}/upload", files={"files": ("s2.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]
    item_c = client.post(f"/api/drive/folders/{c_id}/upload", files={"files": ("c.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]
    item_b = client.post(f"/api/drive/folders/{b_id}/upload", files={"files": ("b.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]

    sh = client.post(f"/api/drive/folders/{s_id}/shares", json={"include_subfolders": True}).json()
    tok = sh["token"]
    anon = _anon()

    # Authorized: S and C + their items
    r_root = anon.get(f"/api/public/drive/{tok}")
    assert r_root.status_code == 200
    # Breadcrumbs MUST stop at Shared S (never leak Parent P!)
    assert [bc["id"] for bc in r_root.json()["breadcrumbs"]] == [s_id]
    r_child = anon.get(f"/api/public/drive/{tok}/folders/{c_id}")
    assert r_child.status_code == 200
    assert [bc["id"] for bc in r_child.json()["breadcrumbs"]] == [s_id, c_id]
    assert anon.get(f"/api/public/drive/{tok}/items/{item_s}/view").status_code == 200
    assert anon.get(f"/api/public/drive/{tok}/items/{item_c}/view").status_code == 200

    # IDOR attempts -> ALL MUST return 404!
    for forbidden_folder in (p_id, s2_id, b_id):
        assert anon.get(f"/api/public/drive/{tok}/folders/{forbidden_folder}").status_code == 404
        assert anon.get(f"/api/public/drive/{tok}/download.zip", params={"subfolder_id": forbidden_folder}).status_code == 404
    for forbidden_item in (item_p, item_s2, item_b):
        assert anon.get(f"/api/public/drive/{tok}/items/{forbidden_item}/view").status_code == 404
        assert anon.get(f"/api/public/drive/{tok}/items/{forbidden_item}/download").status_code == 404
        assert anon.get(f"/api/public/drive/{tok}/items/{forbidden_item}/thumb").status_code == 404

    # When include_subfolders=False -> Child C & item_c also become 404!
    sh_no_sub = client.post(f"/api/drive/folders/{s_id}/shares", json={"include_subfolders": False}).json()
    tok2 = sh_no_sub["token"]
    assert anon.get(f"/api/public/drive/{tok2}/folders/{c_id}").status_code == 404
    assert anon.get(f"/api/public/drive/{tok2}/items/{item_c}/view").status_code == 404
    assert anon.get(f"/api/public/drive/{tok2}/items/{item_s}/view").status_code == 200


def test_passcode_lock_bruteforce_429_and_cookie_invalidation(client):
    _login(client)
    fid = client.post("/api/drive/folders", json={"name": "Confidential Folder"}).json()["folder"]["id"]
    item_id = client.post(f"/api/drive/folders/{fid}/upload", files={"files": ("secret.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]

    sh = client.post(
        f"/api/drive/folders/{fid}/shares",
        json={"label": "PIN Protected", "passcode": "VHP2026!"},
    ).json()
    share_id = sh["id"]
    tok = sh["token"]
    assert sh["has_passcode"] is True
    assert "passcode_hash" not in sh

    # 1. Locked response leaks ZERO file list / subfolders / nonce
    anon1 = _anon()
    r_locked = anon1.get(f"/api/public/drive/{tok}")
    assert r_locked.status_code == 200
    body = r_locked.json()
    assert body["locked"] is True
    assert body["has_passcode"] is True
    assert body["folder_name"] == "Confidential Folder"
    assert "items" not in body
    assert "subfolders" not in body
    assert "telemetry_nonce" not in body
    assert anon1.get(f"/api/public/drive/{tok}/items/{item_id}/view").status_code == 401
    assert anon1.get(f"/api/public/drive/{tok}/download.zip").status_code == 401

    # 2. Brute force: 5 wrong passcodes -> 401, 6th -> 429 (even with correct passcode!)
    for attempt in range(5):
        r_bad = anon1.post(f"/api/public/drive/{tok}/unlock", json={"passcode": f"wrong-{attempt}"})
        assert r_bad.status_code == 401
        assert r_bad.json()["remaining_attempts"] == 4 - attempt

    r_lockout = anon1.post(f"/api/public/drive/{tok}/unlock", json={"passcode": "VHP2026!"})
    assert r_lockout.status_code == 429
    assert int(r_lockout.headers.get("retry-after", "0")) > 0

    # 3. Clear rate limit cache (simulating fresh IP/window), unlock with right passcode -> HttpOnly cookie
    drive_mod.reset_runtime_caches_for_tests()
    anon2 = _anon()
    r_ok = anon2.post(f"/api/public/drive/{tok}/unlock", json={"passcode": "VHP2026!"})
    assert r_ok.status_code == 200
    set_cookie = r_ok.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
    assert drive_mod.drive_cookie_name(tok) in set_cookie

    r_open = anon2.get(f"/api/public/drive/{tok}")
    assert r_open.status_code == 200
    assert r_open.json()["locked"] is False
    assert len(r_open.json()["items"]) == 1
    assert anon2.get(f"/api/public/drive/{tok}/items/{item_id}/view").status_code == 200

    # 4. Admin rotates passcode -> previous cookie MUST immediately fail!
    assert client.patch(f"/api/drive/shares/{share_id}", json={"passcode": "NEWPIN999"}).status_code == 200
    r_recheck = anon2.get(f"/api/public/drive/{tok}")
    assert r_recheck.status_code == 200
    assert r_recheck.json()["locked"] is True
    assert anon2.get(f"/api/public/drive/{tok}/items/{item_id}/view").status_code == 401


def test_share_revoke_expire_max_views_and_permissions(client):
    _login(client)
    fid = client.post("/api/drive/folders", json={"name": "Lifecycle Folder"}).json()["folder"]["id"]
    item_id = client.post(f"/api/drive/folders/{fid}/upload", files={"files": ("doc.pdf", PDF, "application/pdf")}).json()["items"][0]["id"]

    # Revoke -> 410
    sh1 = client.post(f"/api/drive/folders/{fid}/shares", json={"label": "To Revoke"}).json()
    assert _anon().get(f"/api/public/drive/{sh1['token']}").status_code == 200
    assert client.delete(f"/api/drive/shares/{sh1['id']}").status_code == 200
    assert _anon().get(f"/api/public/drive/{sh1['token']}").status_code == 410

    # Expired -> 410
    past_iso = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    sh2 = client.post(f"/api/drive/folders/{fid}/shares", json={"expires_at": past_iso}).json()
    assert _anon().get(f"/api/public/drive/{sh2['token']}").status_code == 410

    # Max views = 1 -> 1st OK + item view OK, 2nd root GET -> 410
    sh3 = client.post(f"/api/drive/folders/{fid}/shares", json={"max_views": 1}).json()
    a3 = _anon()
    assert a3.get(f"/api/public/drive/{sh3['token']}").status_code == 200
    assert a3.get(f"/api/public/drive/{sh3['token']}/items/{item_id}/view").status_code == 200
    assert a3.get(f"/api/public/drive/{sh3['token']}").status_code == 410

    # view_only permission -> view OK, download & ZIP 403, download_url is None
    sh4 = client.post(
        f"/api/drive/folders/{fid}/shares",
        json={"permission": "view_only", "allow_zip_download": True, "allow_neac_verify": False},
    ).json()
    a4 = _anon()
    data4 = a4.get(f"/api/public/drive/{sh4['token']}").json()
    assert data4["items"][0]["download_url"] is None
    assert data4["items"][0]["verify_neac_url"] is None
    assert a4.get(f"/api/public/drive/{sh4['token']}/items/{item_id}/view").status_code == 200
    assert a4.get(f"/api/public/drive/{sh4['token']}/items/{item_id}/download").status_code == 403
    assert a4.get(f"/api/public/drive/{sh4['token']}/download.zip").status_code == 403
    assert a4.get(f"/api/public/drive/{sh4['token']}/items/{item_id}/verify-neac").status_code == 403


# ---------------------------------------------------------------------------
# 7. QR SVG, NEAC Verify + Rate Limit, Telemetry Nonce + Access Logs CSV, Redirect & CSP, Legacy /s/{token}
# ---------------------------------------------------------------------------
def test_qr_neac_telemetry_csv_redirect_csp_and_legacy_compat(client, monkeypatch):
    _login(client)
    # Sign a PDF and attach to folder
    assert _sign_one(client).status_code == 200
    signed_doc = next(d for d in client.get("/api/documents").json()["items"] if d["signed"])

    fid = client.post("/api/drive/folders", json={"name": "NEAC & Telemetry"}).json()["folder"]["id"]
    att = client.post(f"/api/drive/folders/{fid}/attach-documents", json={"document_ids": [signed_doc["id"]]}).json()
    pdf_item_id = att["attached"][0]["id"]

    # Also upload DOCX to check Office preview inside Drive
    docx_item_id = client.post(
        f"/api/drive/folders/{fid}/upload",
        files={"files": ("BienBan.docx", _make_docx_zip(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["items"][0]["id"]

    sh = client.post(f"/api/drive/folders/{fid}/shares", json={"label": "BGĐ Việt Hùng"}).json()
    share_id = sh["id"]
    tok = sh["token"]

    # 1. QR SVG is valid XML containing <svg>
    qr_resp = client.get(f"/api/drive/shares/{share_id}/qr.svg")
    assert qr_resp.status_code == 200
    assert "image/svg+xml" in qr_resp.headers["content-type"]
    root_el = ET.fromstring(qr_resp.content)
    assert root_el.tag.endswith("svg")

    # 2. /share/folder/{token} 302 redirect -> /d/{token}
    anon = _anon()
    redir = anon.get(f"/share/folder/{tok}", follow_redirects=False)
    assert redir.status_code == 302
    assert redir.headers["location"] == f"/d/{tok}"

    # 3. CSP on /d/{token} allows media-src + ipwho.is + 1.1.1.1
    spa_d = anon.get(f"/d/{tok}")
    csp = spa_d.headers.get("content-security-policy", "")
    assert "media-src 'self' blob:" in csp
    assert "https://ipwho.is" in csp
    assert "https://1.1.1.1" in csp

    # 4. DOCX inline preview works with CSP nonce
    docx_view = anon.get(f"/api/public/drive/{tok}/items/{docx_item_id}/view")
    assert docx_view.status_code == 200
    assert "text/html" in docx_view.headers["content-type"]

    # 5. NEAC verify (mock external httpx so test stays offline & fast) + rate limit 5/min -> 6th 429
    import httpx

    class _FakeHttpxClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

        def post(self, *a, **kw):
            class _R:
                status_code = 200

                def json(self):
                    return {"status": "ok", "source": "mock_neac"}

            return _R()

    monkeypatch.setattr(httpx, "Client", _FakeHttpxClient)

    for _ in range(5):
        vn = anon.get(f"/api/public/drive/{tok}/items/{pdf_item_id}/verify-neac")
        assert vn.status_code == 200, vn.text
        body = vn.json()
        assert body["ok"] is True
        assert body["internal_verification"]["valid"] is True
        assert len(body["internal_verification"]["signatures"]) == 1
        assert body["neac_result"]["source"] == "mock_neac"

    assert anon.get(f"/api/public/drive/{tok}/items/{pdf_item_id}/verify-neac").status_code == 429

    # 6. Telemetry HMAC nonce one-time verification + replay rejection + Access Logs JSON & CSV
    opened = anon.get(f"/api/public/drive/{tok}", headers={"User-Agent": "Mozilla/5.0 iPhone"})
    assert opened.status_code == 200
    nonce = opened.json()["telemetry_nonce"]
    assert ":" in nonce

    t_ok = anon.post(
        f"/api/public/drive/{tok}/telemetry",
        json={
            "nonce": nonce,
            "action": "folder_open",
            "ip": "113.160.1.5",
            "city": "Thanh Hoa",
            "region": "Thanh Hoa",
            "isp": "VNPT",
            "country_code": "VN",
            "device_type": "mobile",
            "fingerprint": "fp123456",
        },
        headers={"User-Agent": "Mozilla/5.0 iPhone"},
    )
    assert t_ok.status_code == 200, t_ok.text
    assert t_ok.json()["ok"] is True

    # Replaying same nonce OR tampering ts+1 within same 60s window -> 403!
    t_replay = anon.post(
        f"/api/public/drive/{tok}/telemetry",
        json={"nonce": nonce, "action": "folder_open"},
        headers={"User-Agent": "Mozilla/5.0 iPhone"},
    )
    assert t_replay.status_code == 403

    mac_part, ts_part = nonce.split(":", 1)
    t_tamper = anon.post(
        f"/api/public/drive/{tok}/telemetry",
        json={"nonce": f"{mac_part}:{int(ts_part) + 1}", "action": "folder_open"},
        headers={"User-Agent": "Mozilla/5.0 iPhone"},
    )
    assert t_tamper.status_code == 403

    # verify-neac on non-PDF (e.g. MP4) rejected with 400 BEFORE reading file into RAM
    drive_mod.reset_runtime_caches_for_tests()
    mp4_id = client.post(
        f"/api/drive/folders/{fid}/upload",
        files={"files": ("big.mp4", _make_mp4(4096), "video/mp4")},
    ).json()["items"][0]["id"]
    assert anon.get(f"/api/public/drive/{tok}/items/{mp4_id}/verify-neac").status_code == 400

    # Chunked upload with <script> hidden in chunk 1 (offset > 1024, within 4096 bytes) -> 400!
    md_chunk0 = b"# Clean header\n" + (b"A" * 1200)
    md_chunk1 = b"\n<script>alert(1)</script>\n"
    init_bad = client.post(
        "/api/drive/uploads/init",
        json={
            "folder_id": fid,
            "filename": "sneaky.md",
            "file_size": len(md_chunk0) + len(md_chunk1),
            "chunk_size": len(md_chunk0),
        },
    ).json()
    assert client.put(f"/api/drive/uploads/{init_bad['upload_id']}/chunk?index=0", content=md_chunk0).status_code == 200
    assert client.put(f"/api/drive/uploads/{init_bad['upload_id']}/chunk?index=1", content=md_chunk1).status_code == 200
    assert client.post(f"/api/drive/uploads/{init_bad['upload_id']}/complete", json={}).status_code == 400

    # Customer-scoped KPI filtering on GET /api/drive/folders?customer_id=...
    c_kpi = client.post("/api/customers", json={"name": "KPI Filter Co", "tax_code": "999888777"}).json()
    client.post("/api/drive/folders", json={"name": "KPI Root", "customer_id": c_kpi["id"]})
    all_kpi = client.get("/api/drive/folders").json()["kpi"]
    cust_kpi = client.get("/api/drive/folders", params={"customer_id": c_kpi["id"]}).json()["kpi"]
    assert cust_kpi["total_folders"] == 1
    assert all_kpi["total_folders"] > cust_kpi["total_folders"]

    # Admin access logs JSON & CSV
    logs_json = client.get(f"/api/drive/folders/{fid}/access-logs").json()
    assert logs_json["total"] >= 2
    assert any(row["action"] == "folder_open" and row["city"] == "Thanh Hoa" for row in logs_json["items"])

    logs_csv = client.get(f"/api/drive/folders/{fid}/access-logs", params={"format": "csv"})
    assert logs_csv.status_code == 200
    assert "text/csv" in logs_csv.headers["content-type"]
    csv_text = logs_csv.content.decode("utf-8-sig")
    assert "Thanh Hoa" in csv_text
    assert "folder_open" in csv_text

    # 7. Backward-compatibility: existing single-file /s/{token} & /api/share/{token} still work!
    legacy = client.post(f"/api/documents/{signed_doc['id']}/share", json={"days": 7})
    assert legacy.status_code == 200
    legacy_tok = legacy.json()["token"]
    assert anon.get(f"/s/{legacy_tok}").status_code == 200
    assert anon.get(f"/api/share/{legacy_tok}/view").status_code == 200

    # And image/png Document inline viewing via view_document / _share_file
    png_doc_id = storage.save_upload(_make_png(200, 150), suffix=".png")
    gen = get_session()
    db = next(gen)
    try:
        img_doc = Document(doc_id=png_doc_id, filename="site_photo.png", doc_type="site_photo")
        db.add(img_doc)
        db.commit()
        db.refresh(img_doc)
        img_pk = img_doc.id
    finally:
        gen.close()

    img_view = client.get(f"/api/documents/{img_pk}/view")
    assert img_view.status_code == 200
    assert img_view.headers["content-type"] == "image/png"
    img_share = client.post(f"/api/documents/{img_pk}/share", json={"days": 3}).json()["token"]
    img_pub = anon.get(f"/api/share/{img_share}/view")
    assert img_pub.status_code == 200
    assert img_pub.headers["content-type"] == "image/png"
