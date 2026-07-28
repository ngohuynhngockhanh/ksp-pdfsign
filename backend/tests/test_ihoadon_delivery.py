from __future__ import annotations

import io
import zipfile

import pypdfium2 as pdfium
from weasyprint import HTML

from app import ihoadon_delivery


def _text(pdf: bytes) -> str:
    doc = pdfium.PdfDocument(pdf)
    return "\n".join(doc[i].get_textpage().get_text_bounded() for i in range(len(doc)))


def test_build_delivery_bundle_stamps_date_and_keeps_original():
    source = HTML(string="<h1>Hóa đơn nháp</h1><p>7.300.800 đồng</p>").write_pdf()

    bundle = ihoadon_delivery.build_delivery_bundle(
        source,
        expected_issue_date="2026-07-28",
        basename="hoa-don-nhap-baotoantech-2026-07-28",
    )

    assert bundle.pdf.startswith(b"%PDF")
    assert "BẢN NHÁP" in _text(bundle.pdf)
    assert "28/07/2026" in _text(bundle.pdf)
    with zipfile.ZipFile(io.BytesIO(bundle.zip_bytes)) as packed:
        assert packed.namelist() == [
            "hoa-don-nhap-baotoantech-2026-07-28.pdf",
            "hoa-don-nhap-baotoantech-2026-07-28-ihoadon-goc.pdf",
        ]
        assert packed.read(packed.namelist()[0]) == bundle.pdf
        assert packed.read(packed.namelist()[1]) == source


def test_build_delivery_bundle_rejects_invalid_input():
    try:
        ihoadon_delivery.build_delivery_bundle(
            b"not-a-pdf", expected_issue_date="28/07/2026", basename="draft"
        )
    except ValueError as exc:
        assert "PDF" in str(exc)
    else:
        raise AssertionError("invalid source must be rejected")


def test_delivery_endpoint_creates_share_and_zip(client, monkeypatch):
    login = client.post(
        "/api/login", json={"username": "admin", "password": "NhapHang123@"}
    )
    assert login.status_code == 200
    customer = client.post(
        "/api/customers",
        json={
            "name": "CÔNG TY BẢO TOÀN",
            "tax_code": "0314360282",
            "email": "baotoan@example.test",
        },
    ).json()
    source = HTML(string="<h1>Hóa đơn iHOADON</h1><p>7.300.800 đồng</p>").write_pdf()
    calls = []

    class FakeIhoadon:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def create_draft(self, invoice):
            calls.append(invoice)
            return {
                "id": "draft-baotoan-1",
                "status": "GHI_TAM",
                "template_code": "1",
                "invoice_series": "C26TPK",
                "web_url": "https://example.test/system/vat-invoice",
            }

        def invoice_pdf(self, invoice_id):
            assert invoice_id == "draft-baotoan-1"
            return "ihoadon-draft.pdf", source

    from app import inv_api

    monkeypatch.setattr(inv_api, "_ihoadon_client", lambda _settings: FakeIhoadon())
    response = client.post(
        "/api/inv/ihoadon/drafts/deliver",
        json={
            "customer_name": "CÔNG TY BẢO TOÀN",
            "buyer_tax_code": "0314360282",
            "buyer_email": "baotoan@example.test",
            "buyer_address": "TP.HCM",
            "payment_method_name": "TM/CK",
            "note": "",
            "expected_issue_date": "2026-07-28",
            "share_days": 7,
            "lines": [
                {
                    "ten": "iNut Smartcity - Data Logger",
                    "dvt": "Bộ",
                    "so_luong": 2,
                    "don_gia": 3_380_000,
                    "thanh_tien": 6_760_000,
                    "vat_name": "8%",
                    "tien_thue": 540_800,
                    "is_dich_vu": False,
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["draft_id"] == "draft-baotoan-1"
    assert result["status"] == "GHI_TAM"
    assert result["document_id"] > 0
    assert result["customer_id"] == customer["id"]
    assert result["share_url"].endswith(result["share_token"])
    assert "28/07/2026" in calls[0]["note"]
    assert calls[0]["invoice_products"][0]["quantity"] == 2

    share_path = "/api/share/" + result["share_token"] + "/download"
    shared = client.get(share_path)
    assert shared.status_code == 200
    assert "BẢN NHÁP" in _text(shared.content)
    packed = client.get(result["zip_url"])
    assert packed.status_code == 200
    with zipfile.ZipFile(io.BytesIO(packed.content)) as archive:
        assert len(archive.namelist()) == 2
