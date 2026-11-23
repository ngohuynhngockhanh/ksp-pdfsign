"""Test upload, rename, xem truoc HTML/PDF va chia se cong khai cho tai lieu Word (.docx)."""
from __future__ import annotations

import io
from docx import Document as CreateDocx
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import RGBColor

from tests.test_api import _login


def _make_sample_docx_bytes() -> bytes:
    doc = CreateDocx()
    h = doc.add_paragraph()
    run = h.add_run("HỒ SƠ ĐÁNH GIÁ NHÀ MÁY VNMAP AI ONE")
    run.bold = True
    run.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)

    doc.add_paragraph("Bo mạch chủ Rockchip RK3518 do INUT JSC cung cấp; màn hình BOE / Tomko / Hoshenda.")

    tbl = doc.add_table(rows=2, cols=3)
    tbl.cell(0, 0).text = "Mã hạng mục"
    tbl.cell(0, 1).text = "Thông số kỹ thuật"
    tbl.cell(0, 1).merge(tbl.cell(0, 2))
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="1E3A8A"/>')
    tbl.cell(0, 0)._tc.get_or_add_tcPr().append(shd)

    tbl.cell(1, 0).text = "RK3518-MAIN"
    tbl.cell(1, 1).text = "INUT JSC"
    tbl.cell(1, 2).text = "ĐẠT 100%"

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_docx_upload_preview_rename_and_public_share(client):
    _login(client)
    docx_bytes = _make_sample_docx_bytes()

    res = client.post(
        "/api/documents/upload",
        files={
            "file": (
                "Ho_so_Nha_may_TTP.docx",
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"doc_type": "hop_dong", "note": "Bản Word v3"},
    )
    assert res.status_code == 200, res.text
    created = res.json()
    doc_pk = created["id"]
    assert created["filename"] == "Ho_so_Nha_may_TTP.docx"
    assert created["view_url"] == f"/api/documents/{doc_pk}/view"
    assert created["download_url"] == f"/api/documents/{doc_pk}/download"

    # Đổi tên không ghi đuôi vẫn phải giữ nguyên phần mở rộng .docx (không bị ép sang .pdf)
    ren = client.post(f"/api/documents/{doc_pk}/rename", json={"filename": "Bo_06_Nha_May_VNMAP_v3"})
    assert ren.status_code == 200, ren.text
    assert ren.json()["filename"] == "Bo_06_Nha_May_VNMAP_v3.docx"

    # Xem trước HTML chuẩn trang A4 giữ được nội dung, màu nền ô bảng và gộp cột colspan
    view_html = client.get(f"/api/documents/{doc_pk}/view")
    assert view_html.status_code == 200
    assert "text/html" in view_html.headers["content-type"]
    assert "HỒ SƠ ĐÁNH GIÁ NHÀ MÁY VNMAP AI ONE" in view_html.text
    assert "Rockchip RK3518" in view_html.text
    assert 'colspan="2"' in view_html.text
    assert "#1E3A8A" in view_html.text.upper()

    # Chế độ kết xuất PDF từ DOCX hoạt động cho nút "Bản in PDF"
    view_pdf = client.get(f"/api/documents/{doc_pk}/view?format=pdf")
    assert view_pdf.status_code == 200
    assert view_pdf.headers["content-type"].startswith("application/pdf")
    assert view_pdf.content.startswith(b"%PDF")

    # Tải xuống trả đúng file gốc .docx
    dl = client.get(f"/api/documents/{doc_pk}/download")
    assert dl.status_code == 200
    assert dl.content == docx_bytes
    assert "Bo_06_Nha_May_VNMAP_v3.docx" in dl.headers.get("content-disposition", "")

    # Tạo link chia sẻ công khai /s/{token} (không cần đăng nhập)
    sh = client.post(f"/api/documents/{doc_pk}/share", json={"days": 30})
    assert sh.status_code == 200
    token = sh.json()["token"]

    client.cookies.clear()

    landing = client.get(f"/s/{token}")
    assert landing.status_code == 200
    assert "Tải file Word (.docx)" in landing.text
    assert f"/api/share/{token}/view" in landing.text
    # File .docx chưa ký số PAdES nên không hiển thị nút thẩm định NEAC trên thanh công cụ
    assert 'onclick="openNeacVerify()"' not in landing.text

    pub_html = client.get(f"/api/share/{token}/view")
    assert pub_html.status_code == 200
    assert "INUT JSC" in pub_html.text

    pub_pdf = client.get(f"/api/share/{token}/view?format=pdf")
    assert pub_pdf.status_code == 200
    assert pub_pdf.content.startswith(b"%PDF")

    pub_dl = client.get(f"/api/share/{token}/download")
    assert pub_dl.status_code == 200
    assert pub_dl.content == docx_bytes


def test_docx_upload_rejects_corrupt_archive_and_verify_guards_non_pdf(client):
    _login(client)

    bad = client.post(
        "/api/documents/upload",
        files={"file": ("gia_mao.docx", b"not-a-valid-ooxml-zip", "application/octet-stream")},
    )
    assert bad.status_code == 400

    unsupported = client.post(
        "/api/documents/upload",
        files={"file": ("script.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert unsupported.status_code == 400

    # Upload 1 file DOCX hợp lệ rồi thử gọi /api/documents/{id}/verify -> trả lỗi 400 thay vì crash 500
    ok = client.post(
        "/api/documents/upload",
        files={"file": ("valid.docx", _make_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert ok.status_code == 200
    ver = client.get(f"/api/documents/{ok.json()['id']}/verify")
    assert ver.status_code == 400
