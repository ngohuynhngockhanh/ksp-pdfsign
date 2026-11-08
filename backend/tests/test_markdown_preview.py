"""Test upload, rename, xem truoc HTML/PDF, chia se cong khai va route /md/{slug} cho tai lieu Markdown (.md)."""
from __future__ import annotations

from tests.test_api import _login


def _make_sample_md_bytes() -> bytes:
    return """# Đặc Tả Giao Thức Xiongmai DVRIP 34567

> Tài liệu kiểm thử tích hợp đầu ghi **Xiongmai** vào `ksp-camera-auto`.

## 1. Bảng Cổng Dịch Vụ

| Cổng | Giao Thức | Chức Năng |
| :---: | :--- | :--- |
| `34567` | Sofia DVRIP | Điều khiển nhị phân 20-byte header |
| `80` | HTTP CGI + WS | `/cgi-bin/login.cgi` & `/websocket-bin/Type=HttpPlayBack` |

## 2. Sơ Đồ Bắt Tay

```mermaid
sequenceDiagram
    autonumber
    participant KC as kspcam
    participant NVR as Xiongmai (:80)
    Note over KC,NVR: Đăng nhập RSA + AES-128-CBC
    KC->>NVR: POST /cgi-bin/login.cgi {"Name":"GetSalt"}
    NVR-->>KC: {"Ret":100, "Salt":"Ho9mICnr"}
```

## 3. Thuật Toán `MD5_8`

```go
func MD5_8(input string) string {
    return "6QNMIQGe"
}
```
""".encode("utf-8")


def test_markdown_upload_preview_pdf_and_public_share(client):
    _login(client)
    md_bytes = _make_sample_md_bytes()

    res = client.post(
        "/api/documents/upload",
        files={
            "file": (
                "PROTOCOL-XIONGMAI-DVRIP.md",
                md_bytes,
                "text/markdown",
            )
        },
        data={"doc_type": "khac", "note": "Đặc tả Xiongmai DVRIP"},
    )
    assert res.status_code == 200, res.text
    created = res.json()
    doc_pk = created["id"]
    assert created["filename"] == "PROTOCOL-XIONGMAI-DVRIP.md"

    # Đổi tên vẫn giữ nguyên hậu tố .md
    ren = client.post(f"/api/documents/{doc_pk}/rename", json={"filename": "PROTOCOL-XIONGMAI-DVRIP-KSPCAM"})
    assert ren.status_code == 200, ren.text
    assert ren.json()["filename"] == "PROTOCOL-XIONGMAI-DVRIP-KSPCAM.md"

    # Xem trước HTML có bảng, mục lục, sơ đồ SVG mermaid và tô màu cú pháp Go
    view_html = client.get(f"/api/documents/{doc_pk}/view")
    assert view_html.status_code == 200
    assert "text/html" in view_html.headers["content-type"]
    assert "MARKDOWN · MD" in view_html.text
    assert "Sofia DVRIP" in view_html.text
    assert "<svg" in view_html.text
    assert "6QNMIQGe" in view_html.text

    # Xuất PDF từ Markdown qua WeasyPrint
    view_pdf = client.get(f"/api/documents/{doc_pk}/view?format=pdf")
    assert view_pdf.status_code == 200
    assert view_pdf.headers["content-type"].startswith("application/pdf")
    assert view_pdf.content.startswith(b"%PDF")

    # Tải xuống trả đúng file gốc .md
    dl = client.get(f"/api/documents/{doc_pk}/download")
    assert dl.status_code == 200
    assert dl.content == md_bytes

    # Chia sẻ công khai qua /s/{token}
    sh = client.post(f"/api/documents/{doc_pk}/share", json={"days": 30})
    assert sh.status_code == 200
    token = sh.json()["token"]

    client.cookies.clear()

    landing = client.get(f"/s/{token}")
    assert landing.status_code == 200
    assert "Tải file Markdown (.md)" in landing.text
    assert f"/api/share/{token}/view" in landing.text

    pub_html = client.get(f"/api/share/{token}/view")
    assert pub_html.status_code == 200
    assert "Sofia DVRIP" in pub_html.text

    pub_pdf = client.get(f"/api/share/{token}/view?format=pdf")
    assert pub_pdf.status_code == 200
    assert pub_pdf.content.startswith(b"%PDF")

    pub_dl = client.get(f"/api/share/{token}/download")
    assert pub_dl.status_code == 200
    assert pub_dl.content == md_bytes


def test_public_md_viewer_route_for_repo_docs(client):
    r = client.get("/md/PROTOCOL-XIONGMAI-DVRIP-KSPCAM.md")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "Hangzhou Xiongmai Technology" in r.text
    assert "ev_1ce203f282f0495660fe05f7c0fe3335b5d40a15a2f2e497cd77fa983e76a5dc" in r.text

    r_raw = client.get("/md/PROTOCOL-XIONGMAI-DVRIP-KSPCAM.md?raw=1")
    assert r_raw.status_code == 200
    assert "text/markdown" in r_raw.headers["content-type"]
    assert b"/tmp/xm_re/ocx_extracted/Web/plugin/class.js" in r_raw.content
