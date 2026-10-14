"""4-Tier Requirement-Driven E2E Test Suite for SPX Express Automated Auth & Authentic Label Printing.

Covers Features F1–F10 from SCOPE.md and ORIGINAL_REQUEST.md (2026-10-14):
- Tier 1: Feature Coverage (>= 50 cases)
- Tier 2: Boundary, Corner & Adversarial Cases (>= 50 cases)
- Tier 3: Cross-Feature Pairwise Combinations (>= 10 cases)
- Tier 4: Real-World End-to-End Application Scenarios (>= 5 cases)
Total >= 115 deterministic, isolated test cases.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PageObject, PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject, NameObject
from sqlalchemy import select

from app import db, spx, spx_label, storage
from app.db import AppSetting, Document, Share, SpxShipment, init_db
from app.main import app


# ---------------------------------------------------------------------------
# Test Fixtures & Specification Oracles
# ---------------------------------------------------------------------------


def _make_authentic_spx_pdf(
    width: float = 282.96,
    height: float = 141.12,
    pages: int = 1,
) -> bytes:
    """Create a genuine-dimensions SPX PDF (default 100x50mm = 282.96 x 141.12 pt) without ReportLab markers."""
    writer = PdfWriter()
    for _ in range(pages):
        page = PageObject.create_blank_page(width=width, height=height)
        stream = DecodedStreamObject()
        stream.set_data(b"q 1 0 0 1 0 0 cm Q")
        page[NameObject("/Contents")] = writer._add_object(stream)
        writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _make_shipment_row(
    session,
    tracking_no: str = "SPXVN06647830539A",
    order_code: str = "VN266915710568180Q",
    recipient_name: str = "Anh Tài",
    recipient_phone: str = "84357242389",
    recipient_address: str = "Người Nhân: Công Ty Cổ Phần Tập Đoàn Merap Đ Đ: Thôn Bá Khê",
    cod_amount: float = 0.0,
    label_doc_id: str = "",
) -> SpxShipment:
    """Insert an SpxShipment record in the isolated test DB."""
    row = SpxShipment(
        tracking_no=tracking_no,
        order_code=order_code,
        recipient_name=recipient_name,
        recipient_phone=recipient_phone,
        recipient_address=recipient_address,
        province="Hưng Yên",
        district="Huyện Văn Giang",
        ward="Xã Tân Tiến",
        cod_amount=cod_amount,
        weight_gram=1000,
        length_cm=10,
        width_cm=10,
        height_cm=10,
        item_description="Thiết bị iNut",
        note="Cho xem hàng",
        payer="sender",
        status="ready_to_ship",
        shipping_fee=22000.0,
        label_doc_id=label_doc_id,
        sender_name="Huyền Oanh",
        sender_phone="0345296757",
        sender_address="TP. Thủ Đức, TP. HCM",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


class ConfigurableSpxMock:
    """Configurable mock for SPX Express HTTP endpoints (`base_info/detail`, `address/search`, `get_order_info`, `batch_get_shipping_label`)."""

    def __init__(self) -> None:
        self.pdf_bytes: bytes = _make_authentic_spx_pdf()
        self.valid_tokens: set[str] = {"valid_tok", "fresh_tok", "tok_live", "test_token_123"}
        self.require_token_check: bool = False
        self.base_info_status: int = 200
        self.base_info_retcode: int = 0
        self.order_info_status: int = 200
        self.order_info_retcode: int = 0
        self.label_status: int = 200
        self.label_retcode: int = 0
        self.label_return_pdf: bool = True
        self.calls: list[tuple[str, dict[str, str]]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mock_self = self

        class FakeResponse:
            def __init__(self, status_code: int = 200, json_data: dict | None = None, content: bytes = b"", headers: dict | None = None):
                self.status_code = status_code
                self._json = json_data
                self.content = content
                self.text = str(json_data or "")
                self.headers = headers or {"content-type": "application/json"}

            def json(self) -> dict:
                if self._json is None:
                    raise ValueError("Not a JSON response")
                return self._json

        class FakeClient:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.cookies: dict[str, str] = dict(kwargs.get("cookies") or {})

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def close(self) -> None:
                pass

            def _is_token_expired(self) -> bool:
                if not mock_self.require_token_check:
                    return False
                tok = self.cookies.get("spx_token", "")
                return tok not in mock_self.valid_tokens

            def get(self, url: str, *args: Any, **kwargs: Any) -> FakeResponse:
                mock_self.calls.append((url, dict(self.cookies)))

                if "base_info/detail" in url:
                    if self._is_token_expired() or mock_self.base_info_status != 200 or mock_self.base_info_retcode != 0:
                        status = 401 if self._is_token_expired() else mock_self.base_info_status
                        rc = 2203 if self._is_token_expired() else mock_self.base_info_retcode
                        return FakeResponse(status, {"retcode": rc, "message": "token is invalid"})
                    return FakeResponse(
                        200,
                        {
                            "retcode": 0,
                            "message": "success",
                            "data": {"account_id": 1602803950, "phone": "0345296757"},
                        },
                    )

                if "address/search" in url:
                    if self._is_token_expired():
                        return FakeResponse(401, {"retcode": 2203, "message": "token is invalid"})
                    return FakeResponse(
                        200,
                        {
                            "retcode": 0,
                            "message": "success",
                            "data": {
                                "total": 1,
                                "list": [{"contact_name": "Huyền Oanh", "contact_phone": "84972768491"}],
                            },
                        },
                    )

                if "get_order_info" in url:
                    if self._is_token_expired() or mock_self.order_info_status != 200 or mock_self.order_info_retcode != 0:
                        status = 401 if self._is_token_expired() else mock_self.order_info_status
                        rc = 2203 if self._is_token_expired() else mock_self.order_info_retcode
                        return FakeResponse(status, {"retcode": rc, "message": "order lookup failed or token invalid"})

                    m_tn = re.search(r"spx_tn=([A-Z0-9]+)", url)
                    m_sn = re.search(r"order_sn=([A-Z0-9]+)", url)
                    code = m_tn.group(1) if m_tn else (m_sn.group(1) if m_sn else "SPXVN06647830539A")
                    if code == "SPXVN06647830539A" or code == "VN266915710568180Q":
                        spx_tn = "SPXVN06647830539A"
                        order_sn = "VN266915710568180Q"
                    else:
                        spx_tn = code if code.startswith("SPXVN") else f"SPXVN{code[-10:]}"
                        order_sn = code if (code.startswith("VN") and not code.startswith("SPXVN")) else f"VN266915{code[-6:]}Q"

                    return FakeResponse(
                        200,
                        {
                            "retcode": 0,
                            "message": "success",
                            "data": {
                                "order_info": {
                                    "order_sn": order_sn,
                                    "spx_tn": spx_tn,
                                    "sls_tn": order_sn,
                                },
                                "deliver_info": {
                                    "deliver_name": "Anh Tài",
                                    "deliver_phone": "84357242389",
                                    "deliver_detail_address": "Người Nhân: Công Ty Cổ Phần Tập Đoàn Merap Đ Đ: Thôn Bá Khê, Điện Thoại:",
                                    "deliver_state": "Hưng Yên",
                                    "deliver_city": "Huyện Văn Giang",
                                    "deliver_district": "Xã Tân Tiến",
                                },
                                "sender_info": {
                                    "sender_name": "Huyền Oanh",
                                    "sender_phone": "84972768491",
                                    "sender_detail_address": "Lavita Charm",
                                    "sender_district": "Phường Thủ Đức",
                                    "sender_state": "TP. Hồ Chí Minh",
                                },
                                "parcel_info": {
                                    "parcel_item_name": "Thiết bị quan trắc iNut",
                                    "parcel_weight": 1.2,
                                },
                                "fulfillment_info": {
                                    "cod_amount": 0,
                                },
                            },
                        },
                    )

                if "batch_get_shipping_label" in url:
                    if self._is_token_expired() or mock_self.label_status != 200 or not mock_self.label_return_pdf:
                        status = 401 if self._is_token_expired() else mock_self.label_status
                        rc = 2203 if self._is_token_expired() else mock_self.label_retcode
                        return FakeResponse(status, {"retcode": rc, "message": "label download error"})
                    return FakeResponse(
                        200,
                        content=mock_self.pdf_bytes,
                        headers={"content-type": "application/pdf"},
                    )

                return FakeResponse(404, {"retcode": -1, "message": "not found"})

        monkeypatch.setattr("httpx.Client", FakeClient)
        monkeypatch.setattr(spx, "_get_spx_proxies", lambda: [])


@pytest.fixture(scope="module")
def _module_data_dir(tmp_path_factory):
    """Create a module-scoped temporary DATA_DIR and initialize schema once."""
    import os
    from app.auth import ensure_admin_seed
    from app.config import get_settings

    d = tmp_path_factory.mktemp("spx_suite_data")
    os.environ["DATA_DIR"] = str(d)
    os.environ["APP_ADMIN_PASSWORD"] = "NhapHang123@"
    get_settings.cache_clear()
    db.reset_engine_for_tests()
    init_db()
    gen = db.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    gen.close()
    return d


@pytest.fixture(autouse=True)
def isolated_db(_module_data_dir, monkeypatch):
    """Reset SPX tables before every test while reusing the initialized temporary SQLite schema."""
    from sqlalchemy import delete
    from app.config import get_settings

    monkeypatch.setenv("DATA_DIR", str(_module_data_dir))
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    if str(get_settings().data_dir) != str(_module_data_dir):
        get_settings.cache_clear()
        db.reset_engine_for_tests()
        init_db()

    gen = db.get_session()
    s = next(gen)
    s.execute(delete(SpxShipment))
    s.execute(delete(AppSetting).where(AppSetting.key.in_(spx.SETTING_KEYS)))
    s.commit()
    gen.close()


@pytest.fixture
def db_session():
    """Provide a SQLAlchemy session bound to the temporary test database."""
    gen = db.get_session()
    session = next(gen)
    try:
        yield session
    finally:
        gen.close()


@pytest.fixture
def auth_client(_module_data_dir, monkeypatch):
    """Provide an authenticated FastAPI TestClient seeded with admin and SPX credentials."""
    from app.auth import ensure_admin_seed
    from app.config import get_settings

    gen = db.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    spx.save_spx_settings(
        s,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=valid_tok; spx_sid=valid_sid",
        },
    )
    gen.close()

    client = TestClient(app)
    res = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert res.status_code == 200
    return client

# ===========================================================================
# TIER 1: FEATURE COVERAGE (HAPPY PATHS IN ISOLATION) — 56 TEST CASES
# ===========================================================================


@pytest.mark.parametrize(
    "code,expected",
    [
        ("SPXVN06647830539A", True),
        ("spxvn06647830539a", True),
        ("  SPXVN0123456789  ", True),
        ("SPXVN999888777", True),
        ("SPXVN05123456789B", True),
        ("VN266915710568180Q", True),
        ("vn2615337004838260", True),
        ("  VN25998877665544A  ", True),
        ("VN1234567890", True),
        ("VN9876543210XYZ", True),
        ("VN-SGN-01", False),
        ("VN-internal-12345", False),
        ("CUSTOM_001", False),
        ("THI 058 601 1011", False),
        ("INTERNAL-0123456789", False),
        ("DH-2026-001", False),
        ("GHN123456789", False),
        ("VIETTELPOST12345", False),
    ],
)
def test_t1_is_official_spx_code_equivalence_classes(code: str, expected: bool):
    """Tier 1 (F5/F6): Verify official SPX tracking/order code classification across equivalence classes."""
    assert spx.is_official_spx_code(code) is expected


@pytest.mark.parametrize(
    "username,password,cookie_str,shop_id,api_token",
    [
        ("0345296757", "NhapHang123@", "spx_token=tok1; spx_sid=sid1", "SHOP_01", "API_TOK_1"),
        ("0345296757", "NhapHang123", "spx_token=tok2; spx_sid=sid2; login_status=true", "SHOP_02", "API_TOK_2"),
        ("84345296757", "NhapHang123@", "_ga=1; spx_token=abcDEF123; spx_sid=998877", "SHOP_03", "API_TOK_3"),
        ("0972768491", "CustomPass#99", "spx_token=tok_custom; spx_sid=sid_custom", "SHOP_04", "API_TOK_4"),
        (
            "0345296757",
            "NhapHang123@",
            "spx_token=gsusgrOJqbqBwpX9nf6KwcouyCLkfhCG629NKHvcpAqaqpf9t5gNXYorICPZ7Izh; spx_sid=55b2d01ee0ab03cca2b4ef56f7dd940ba35a97684e72f64be809e25805571347",
            "1602803950",
            "TOK_PROD",
        ),
    ],
)
def test_t1_save_and_get_spx_settings_encryption(
    db_session, username: str, password: str, cookie_str: str, shop_id: str, api_token: str
):
    """Tier 1 (F1): Verify Fernet encryption at rest, masked readback, and raw credential decryption."""
    masked = spx.save_spx_settings(
        db_session,
        {
            "spx_username": username,
            "spx_password": password,
            "spx_cookies": cookie_str,
            "spx_shop_id": shop_id,
            "spx_api_token": api_token,
        },
    )
    assert masked["spx_username"] == username
    assert masked["spx_shop_id"] == shop_id
    assert masked["spx_password"] == "********"
    assert masked["spx_cookies"] == "********"
    assert masked["spx_api_token"] == "********"

    # Verify DB stores ciphertext, never plaintext
    db_pw = db_session.get(AppSetting, "spx_password")
    db_ck = db_session.get(AppSetting, "spx_cookies")
    assert db_pw is not None and db_pw.value != password
    assert db_ck is not None and db_ck.value != cookie_str

    raw = spx.get_spx_raw_credentials(db_session)
    assert raw["spx_username"] == username
    assert raw["spx_password"] == password
    assert raw["spx_cookies"] == cookie_str
    assert raw["spx_api_token"] == api_token


@pytest.mark.parametrize(
    "cookie_str",
    [
        "spx_token=valid_tok; spx_sid=sid_001",
        "app_lang=vi; spx_token=valid_tok; spx_sid=sid_002; login_type=1",
        "_gcl_au=1.1; spx_token=fresh_tok; spx_sid=sid_003; nss_cid=VN",
        "spx_sid=sid_004; spx_token=tok_live",
        "  spx_token=test_token_123 ; spx_sid=sid_005  ",
    ],
)
def test_t1_validate_spx_session_happy_paths(db_session, monkeypatch, cookie_str: str):
    """Tier 1 (F2): Verify validate_spx_session returns valid=True and account_id on HTTP 200 retcode=0."""
    mock_api = ConfigurableSpxMock()
    mock_api.require_token_check = True
    mock_api.install(monkeypatch)

    res = spx.validate_spx_session(db_session, cookie_str=cookie_str)
    assert res["valid"] is True
    assert res["retcode"] == 0
    assert res["account_id"] == 1602803950


@pytest.mark.parametrize(
    "configured_pw,working_pw",
    [
        ("NhapHang123@", "NhapHang123@"),
        ("NhapHang123", "NhapHang123"),
        ("NhapHang123", "NhapHang123@"),
        ("NhapHang123@", "NhapHang123"),
        ("", "NhapHang123@"),
    ],
)
def test_t1_auto_login_spx_primary_and_fallback_passwords(
    db_session, monkeypatch, configured_pw: str, working_pw: str
):
    """Tier 1 (F3): Verify auto_login_spx succeeds with primary or fallback password and persists credentials."""
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": configured_pw},
    )

    def fake_login(u: str, p: str, timeout: int = 45) -> str:
        if p != working_pw:
            raise RuntimeError("Invalid password")
        return f"spx_token=tok_{working_pw}; spx_sid=sid_{working_pw}; login_status=true"

    monkeypatch.setattr(spx, "_run_playwright_spx_login", fake_login)
    res = spx.auto_login_spx(db_session)
    assert res["success"] is True
    assert res["username"] == "0345296757"
    assert res["spx_token"] == f"tok_{working_pw}"
    assert res["spx_sid"] == f"sid_{working_pw}"

    raw = spx.get_spx_raw_credentials(db_session)
    assert raw["spx_password"] == working_pw
    assert f"spx_token=tok_{working_pw}" in raw["spx_cookies"]


@pytest.mark.parametrize(
    "initial_cookie,force_refresh,expect_relogin",
    [
        ("spx_token=valid_tok; spx_sid=s1", False, False),
        ("spx_token=valid_tok; spx_sid=s1", True, True),
        ("", False, True),
        ("spx_token=expired_tok; spx_sid=s1", False, True),
    ],
)
def test_t1_ensure_spx_session_modes(
    db_session, monkeypatch, initial_cookie: str, force_refresh: bool, expect_relogin: bool
):
    """Tier 1 (F2/F3): Verify ensure_spx_session reuses valid session or triggers auto_login_spx when needed."""
    mock_api = ConfigurableSpxMock()
    mock_api.require_token_check = True
    mock_api.install(monkeypatch)

    spx.save_spx_settings(
        db_session,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": initial_cookie,
        },
    )
    relogin_called = {"count": 0}

    def fake_login(u: str, p: str, timeout: int = 45) -> str:
        relogin_called["count"] += 1
        return "spx_token=fresh_tok; spx_sid=fresh_sid"

    monkeypatch.setattr(spx, "_run_playwright_spx_login", fake_login)
    cookie_out = spx.ensure_spx_session(db_session, force_refresh=force_refresh)
    if expect_relogin:
        assert relogin_called["count"] == 1
        assert "spx_token=fresh_tok" in cookie_out
    else:
        assert relogin_called["count"] == 0
        assert cookie_out == initial_cookie


@pytest.mark.parametrize(
    "query_code,expected_tn,expected_sn",
    [
        ("SPXVN06647830539A", "SPXVN06647830539A", "VN266915710568180Q"),
        ("VN266915710568180Q", "SPXVN06647830539A", "VN266915710568180Q"),
        ("SPXVN0998877665", "SPXVN0998877665", "VN266915877665Q"),
        ("VN26112233445566", "SPXVN2233445566", "VN26112233445566"),
        ("  spxvn06647830539a  ", "SPXVN06647830539A", "VN266915710568180Q"),
    ],
)
def test_t1_fetch_spx_order_online_happy_paths(
    db_session, monkeypatch, query_code: str, expected_tn: str, expected_sn: str
):
    """Tier 1 (F4/F6): Verify fetch_spx_order_online resolves both SPXVN tracking numbers and VN order SNs."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )

    data = spx.fetch_spx_order_online(db_session, query_code)
    assert data is not None
    order_info = data["order_info"]
    assert order_info["spx_tn"] == expected_tn
    assert order_info["order_sn"] == expected_sn
    assert data["deliver_info"]["deliver_name"] == "Anh Tài"


@pytest.mark.parametrize(
    "online_payload,expected_name,expected_weight,expected_cod",
    [
        (
            {
                "data": {
                    "order_info": {"order_sn": "VN266915710568180Q", "spx_tn": "SPXVN06647830539A"},
                    "deliver_info": {
                        "deliver_name": "Anh Tài",
                        "deliver_phone": "84357242389",
                        "deliver_detail_address": "Công Ty Cổ Phần Tập Đoàn Merap, Thôn Bá Khê",
                        "deliver_state": "Hưng Yên",
                        "deliver_city": "Huyện Văn Giang",
                        "deliver_district": "Xã Tân Tiến",
                    },
                    "parcel_info": {"parcel_item_name": "Bộ iNut SmartCity", "parcel_weight": 1.5},
                    "fulfillment_info": {"cod_amount": 0},
                }
            },
            "Anh Tài",
            1500,
            0.0,
        ),
        (
            {
                "order_info": {"order_sn": "VN26000011112222Q", "spx_tn": "SPXVN011112222A"},
                "deliver_info": {
                    "deliver_name": "",
                    "deliver_phone": "0909123456",
                    "deliver_detail_address": "Người nhận: Công Ty TNHH Điện Tử ABC, Quận 7",
                },
                "parcel_info": {"parcel_item_name": "Cảm biến radar", "parcel_weight": 650},
                "fulfillment_info": {"cod_amount": 1250000},
            },
            "Công Ty TNHH Điện Tử ABC",
            650,
            1250000.0,
        ),
        (
            {
                "data": {
                    "order_info": {"order_sn": "VN26000033334444Q", "spx_tn": "SPXVN033334444B"},
                    "deliver_info": {
                        "deliver_name": "Chị Lan",
                        "deliver_phone": "0912345678",
                        "deliver_detail_address": "123 Trần Hưng Đạo",
                    },
                    "sender_info": {
                        "sender_name": "Shop INUT",
                        "sender_phone": "0345296757",
                        "sender_detail_address": "Lavita Charm",
                        "sender_district": "Thủ Đức",
                        "sender_state": "TP.HCM",
                    },
                    "parcel_info": {"parcel_weight": 0.5},
                    "cod_amount": 350000,
                }
            },
            "Chị Lan",
            500,
            350000.0,
        ),
        (
            {
                "data": {
                    "order_info": {"order_sn": "VN26000055556666Q", "sls_tn": "SPXVN055556666C"},
                    "deliver_info": {
                        "deliver_name": "",
                        "deliver_detail_address": "Người Nhân: Anh Hùng Kỹ Thuật; Đ/C: KCN Bắc Thăng Long",
                    },
                    "parcel_info": {"parcel_weight": 2.25},
                    "fulfillment_info": {"cod_amount": "500000"},
                }
            },
            "Anh Hùng Kỹ Thuật",
            2250,
            500000.0,
        ),
    ],
)
def test_t1_apply_online_info_to_shipment(
    db_session,
    online_payload: dict[str, Any],
    expected_name: str,
    expected_weight: int,
    expected_cod: float,
):
    """Tier 1 (F6/F10): Verify _apply_online_info_to_shipment maps nested/flat SPX fields accurately."""
    shipment = _make_shipment_row(
        db_session,
        tracking_no="SPXVN0000000000",
        order_code="SPXVN0000000000",
        recipient_name="Khách hàng SPX (0000)",
    )
    spx._apply_online_info_to_shipment(shipment, online_payload)
    assert shipment.recipient_name == expected_name
    assert shipment.weight_gram == expected_weight
    assert shipment.cod_amount == expected_cod
    assert shipment.order_code.startswith("VN26")


@pytest.mark.parametrize(
    "width,height,num_pages",
    [
        (282.96, 141.12, 1),  # Standard SPX 100x50mm label
        (297.64, 419.53, 1),  # A6 portrait
        (419.53, 297.64, 1),  # A6 landscape
        (282.96, 141.12, 2),  # Multi-page thermal label batch
        (288.0, 144.0, 1),    # 4x2 inch label
    ],
)
def test_t1_scale_pdf_golden_ratio_affine_matrix_oracle(width: float, height: float, num_pages: int):
    """Tier 1 (F8): Verify scale_pdf_golden_ratio applies exact Golden Ratio 65% right-aligned transform.

    Mathematical Oracle from SCOPE.md § 2.5:
      scale = 0.65
      tx = (w - w * 0.65) - 2.0
      ty = (h - h * 0.65) / 2.0
    """
    raw_pdf = _make_authentic_spx_pdf(width=width, height=height, pages=num_pages)
    scaled_pdf = spx.scale_pdf_golden_ratio(raw_pdf)
    assert scaled_pdf.startswith(b"%PDF")

    reader = PdfReader(io.BytesIO(scaled_pdf))
    assert len(reader.pages) == num_pages

    expected_tx = (width - width * 0.65) - 2.0
    expected_ty = (height - height * 0.65) / 2.0

    page0 = reader.pages[0]
    assert abs(float(page0.mediabox.width) - width) < 0.05
    assert abs(float(page0.mediabox.height) - height) < 0.05

    # Inspect content stream cm operator to verify exact affine matrix [0.65, 0, 0, 0.65, tx, ty]
    cs = ContentStream(page0.get_contents(), reader)
    cm_ops = [operands for operands, op in cs.operations if op == b"cm"]
    assert len(cm_ops) >= 1
    sx, b_val, c_val, sy, tx, ty = [float(x) for x in cm_ops[0]]
    assert abs(sx - 0.65) < 1e-3
    assert abs(sy - 0.65) < 1e-3
    assert abs(b_val) < 1e-4
    assert abs(c_val) < 1e-4
    assert abs(tx - expected_tx) < 1e-2
    assert abs(ty - expected_ty) < 1e-2


@pytest.mark.parametrize(
    "tracking_no,days",
    [
        ("SPXVN06647830539A", 90),
        ("SPXVN0111222333", 90),
        ("SPXVN0444555666", 30),
        ("SPXVN0777888999", 365),
    ],
)
def test_t1_store_and_share_spx_label_registration(db_session, tracking_no: str, days: int):
    """Tier 1 (F9): Verify store_and_share_spx_label creates Document (tem_van_don) and Share link with exact expiry."""
    pdf_bytes = spx.scale_pdf_golden_ratio(_make_authentic_spx_pdf())
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    info = spx.store_and_share_spx_label(db_session, tracking_no, pdf_bytes, days=days)

    assert info["doc_id"] != ""
    assert info["share_url"] == f"/s/{info['share_token']}"
    assert info["filename"] == f"SPX_Label_{tracking_no}.pdf"

    doc = db_session.get(Document, info["document_id"])
    assert doc is not None
    assert doc.doc_type == "tem_van_don"
    assert doc.source_system == "spx"
    assert doc.source_external_id == tracking_no
    assert doc.signer_name == "SPX Express"

    share = db_session.scalar(select(Share).where(Share.token == info["share_token"]))
    assert share is not None
    assert share.document_id == doc.id
    delta_days = (share.expires_at - before).total_seconds() / 86400.0
    assert (days - 0.1) <= delta_days <= (days + 0.1)


def test_t1_get_spx_order_label_official_downloads_and_scales(db_session, monkeypatch):
    """Tier 1 (F5/F8/F9): Verify get_spx_order_label downloads genuine PDF, scales 65%, and registers Document/Share."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )
    shipment = _make_shipment_row(db_session, tracking_no="SPXVN06647830539A", order_code="VN266915710568180Q")

    pdf_out = spx.get_spx_order_label(db_session, "SPXVN06647830539A")
    assert pdf_out.startswith(b"%PDF")
    assert b"ReportLab" not in pdf_out

    db_session.refresh(shipment)
    assert shipment.label_doc_id != ""
    doc = db_session.scalar(select(Document).where(Document.doc_id == shipment.label_doc_id))
    assert doc is not None
    assert doc.doc_type == "tem_van_don"


def test_t1_quick_print_by_code_official_spx_order(db_session, monkeypatch):
    """Tier 1 (F6/F10): Verify quick_print_by_code fetches authentic order info, scales PDF, and creates 90-day share."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )

    res = spx.quick_print_by_code(db_session, "SPXVN06647830539A", print_remote=False)
    assert res["success"] is True
    assert res["tracking_no"] == "SPXVN06647830539A"
    assert res["order_code"] == "VN266915710568180Q"
    assert res["recipient_name"] == "Anh Tài"
    assert res["share_url"].startswith("/s/")
    assert res["is_printed"] is True


def test_t1_sync_spx_orders_batch_populates_authentic_metadata(db_session, monkeypatch):
    """Tier 1 (F6): Verify sync_spx_orders_batch populates real SPX metadata for multiple tracking/order codes."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )

    res = spx.sync_spx_orders_batch(db_session, "SPXVN06647830539A\nSPXVN0123456789\nVN266915999999Q")
    assert res["success"] is True
    assert res["total_synced"] == 3
    row = spx.get_spx_order(db_session, "SPXVN06647830539A")
    assert row is not None
    assert row.recipient_name == "Anh Tài"
    assert row.order_code == "VN266915710568180Q"


# ===========================================================================
# TIER 2: BOUNDARY, CORNER & ADVERSARIAL CASES — 58 TEST CASES
# ===========================================================================


@pytest.mark.parametrize(
    "invalid_code",
    [
        None,
        "",
        "   ",
        "\t\n\r",
        "SPX",
        "SPXVN",
        "SPXVN1",
        "SPXVN12",
        "VN",
        "VN123",
        "VN1234567",
        "VN-1234567890",
        "VN_1234567890",
        "VNABCDEFGH",
        "VN1234567890!@#",
        "1234567890123",
        "SPX-VN06647830539A",
    ],
)
def test_t2_is_official_spx_code_boundary_rejections(invalid_code: Any):
    """Tier 2 (F5/F6): Verify boundary lengths, invalid prefixes, and non-alphanumeric strings return False."""
    assert spx.is_official_spx_code(invalid_code) is False


@pytest.mark.parametrize(
    "boundary_valid_code",
    [
        "SPXVN123",                    # Exact minimum length 8 for SPXVN prefix
        "VN12345678",                  # Exact minimum length 10 for VN prefix starting with digit
        "VN00000000",                  # All zeros after VN
        "SPXVN00000000000000000000A",  # Long tracking code
    ],
)
def test_t2_is_official_spx_code_exact_lower_bounds(boundary_valid_code: str):
    """Tier 2 (F5/F6): Verify exact lower-bound lengths (len=8 for SPXVN, len=10 for VN+digit) return True."""
    assert spx.is_official_spx_code(boundary_valid_code) is True


@pytest.mark.parametrize(
    "http_status,retcode,cookie_input",
    [
        (200, 2203, "spx_token=exp; spx_sid=s1"),
        (200, 2204, "spx_token=exp; spx_sid=s1"),
        (200, 10010, "spx_token=exp; spx_sid=s1"),
        (200, -1, "spx_token=exp; spx_sid=s1"),
        (401, 2203, "spx_token=exp; spx_sid=s1"),
        (401, 10010, "spx_token=exp; spx_sid=s1"),
        (403, 403, "spx_token=exp; spx_sid=s1"),
        (500, 500, "spx_token=exp; spx_sid=s1"),
        (502, 502, "spx_token=exp; spx_sid=s1"),
        (200, 0, ""),
        (200, 0, "   "),
    ],
)
def test_t2_validate_spx_session_expired_and_error_codes(
    db_session, monkeypatch, http_status: int, retcode: int, cookie_input: str
):
    """Tier 2 (F2): Verify validate_spx_session returns valid=False on 401, retcode 2203/2204/10010, 5xx, or empty cookie."""
    mock_api = ConfigurableSpxMock()
    mock_api.base_info_status = http_status
    mock_api.base_info_retcode = retcode
    mock_api.install(monkeypatch)

    res = spx.validate_spx_session(db_session, cookie_str=cookie_input)
    assert res["valid"] is False
    assert res["retcode"] != 0


def test_t2_validate_spx_session_network_exception(db_session, monkeypatch):
    """Tier 2 (F2): Verify validate_spx_session handles network/timeout exceptions gracefully without crashing."""
    class BrokenClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            raise RuntimeError("Connection reset by peer")

        def __exit__(self, *a):
            return False

    monkeypatch.setattr("httpx.Client", BrokenClient)
    res = spx.validate_spx_session(db_session, cookie_str="spx_token=t1; spx_sid=s1")
    assert res["valid"] is False
    assert res["retcode"] == -1


@pytest.mark.parametrize(
    "bad_cookie_output",
    [
        "",
        "   ",
        "spx_token=only_token_no_sid",
        "spx_sid=only_sid_no_token",
        "login_status=true; app_lang=vi",
        "spx_token=; spx_sid=valid_sid",
        "spx_token=valid_tok; spx_sid=",
    ],
)
def test_t2_auto_login_spx_rejects_incomplete_cookies(db_session, monkeypatch, bad_cookie_output: str):
    """Tier 2 (F3): Verify auto_login_spx raises RuntimeError when Playwright output lacks spx_token or spx_sid."""
    spx.save_spx_settings(db_session, {"spx_username": "0345296757", "spx_password": "NhapHang123@"})
    monkeypatch.setattr(spx, "_run_playwright_spx_login", lambda u, p, timeout=45: bad_cookie_output)

    with pytest.raises(RuntimeError, match="Tự động đăng nhập SPX Express thất bại"):
        spx.auto_login_spx(db_session)


@pytest.mark.parametrize(
    "username,password",
    [
        ("", "NhapHang123@"),
        ("   ", "NhapHang123@"),
        ("********", "NhapHang123@"),
        ("0999888777", ""),
        ("0999888777", "********"),
    ],
)
def test_t2_auto_login_spx_missing_credentials_raises(db_session, monkeypatch, username: str, password: str):
    """Tier 2 (F3): Verify auto_login_spx raises RuntimeError when username or password is missing."""
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Missing credentials")),
    )
    with pytest.raises(RuntimeError):
        spx.auto_login_spx(db_session, username=username, password=password)


@pytest.mark.parametrize(
    "invalid_pdf_bytes",
    [
        b"",
        b"   ",
        b"NOT_A_PDF_FILE",
        b'{"retcode": 20005, "message": "order not found"}',
        b"<html><body>401 Unauthorized</body></html>",
        b"%PDF-1.4\ncorrupted_binary_stream_without_eof",
    ],
)
def test_t2_scale_pdf_golden_ratio_rejects_corrupted_or_non_pdf(invalid_pdf_bytes: bytes):
    """Tier 2 (F8): Verify scale_pdf_golden_ratio rejects empty, JSON, HTML, or corrupted PDF bytes."""
    with pytest.raises(Exception):
        spx.scale_pdf_golden_ratio(invalid_pdf_bytes)


@pytest.mark.parametrize(
    "recipient_name,recipient_address,order_code,pdf_payload,is_official,expected_poisoned",
    [
        # 1. Placeholder recipient name variations
        ("Khách hàng SPX (30539A)", "Thôn Bá Khê", "VN266915710568180Q", None, True, True),
        ("khách hàng spx", "Thôn Bá Khê", "VN266915710568180Q", None, True, True),
        ("", "Thôn Bá Khê", "VN266915710568180Q", None, True, True),
        ("   ", "Thôn Bá Khê", "VN266915710568180Q", None, True, True),
        # 2. Placeholder recipient address
        ("Anh Tài", "Địa chỉ nhận hàng theo đơn SPX Express", "VN266915710568180Q", None, True, True),
        # 3. Missing VN order_code on official SPX shipment
        ("Anh Tài", "Thôn Bá Khê", "SPXVN06647830539A", None, True, True),
        ("Anh Tài", "Thôn Bá Khê", "", None, True, True),
        # 4. Poisoned PDF content markers
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"%PDF-1.4 ReportLab Generated PDF", True, True),
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"%PDF-1.4 SPX_AWB_12345", True, True),
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"%PDF-1.4 VN-SGN-01", True, True),
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"%PDF-1.4 fake dummy label", True, True),
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"NOT_A_PDF", True, True),
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", b"", True, True),
        # 5. Authentic scaled SPX PDF (282.96 x 141.12 pt, no fake markers) -> NOT poisoned
        ("Anh Tài", "Thôn Bá Khê", "VN266915710568180Q", "AUTHENTIC_PDF", True, False),
    ],
)
def test_t2_is_cached_label_poisoned_detection_matrix(
    db_session,
    recipient_name: str,
    recipient_address: str,
    order_code: str,
    pdf_payload: Any,
    is_official: bool,
    expected_poisoned: bool,
):
    """Tier 2 (F7): Verify _is_cached_label_poisoned catches all dummy/placeholder/ReportLab cache states."""
    shipment = _make_shipment_row(
        db_session,
        tracking_no="SPXVN06647830539A",
        order_code=order_code,
        recipient_name=recipient_name,
        recipient_address=recipient_address,
    )
    if pdf_payload == "AUTHENTIC_PDF":
        raw_bytes = spx.scale_pdf_golden_ratio(_make_authentic_spx_pdf())
    elif pdf_payload is None:
        raw_bytes = _make_authentic_spx_pdf()
    else:
        raw_bytes = pdf_payload

    assert spx._is_cached_label_poisoned(shipment, raw_bytes, is_official) is expected_poisoned


@pytest.mark.parametrize(
    "label_retcode,label_status",
    [
        (20005, 200),  # Non-PDF JSON response from batch_get_shipping_label
        (2203, 401),   # Expired token when auto-login also fails
        (2204, 401),
        (10010, 401),
        (500, 500),
    ],
)
def test_t2_zero_fake_template_invariant_when_label_download_fails(
    db_session, monkeypatch, label_retcode: int, label_status: int
):
    """Tier 2 (F5): Verify get_spx_order_label raises RuntimeError and NEVER calls generate_spx_a6_label on download failure."""
    mock_api = ConfigurableSpxMock()
    mock_api.label_return_pdf = False
    mock_api.label_status = label_status
    mock_api.label_retcode = label_retcode
    mock_api.install(monkeypatch)

    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Relogin unavailable")),
    )
    fallback_called = {"called": False}

    def forbidden_fallback(*a, **kw):
        fallback_called["called"] = True
        raise AssertionError("generate_spx_a6_label MUST NOT be called for official SPX codes!")

    monkeypatch.setattr(spx, "generate_spx_a6_label", forbidden_fallback)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )
    _make_shipment_row(db_session, tracking_no="SPXVN06647830539A", order_code="VN266915710568180Q")

    with pytest.raises(RuntimeError, match=r"(Tuyệt đối không tự chế tem mẫu|Tự động đăng nhập SPX Express thất bại)"):
        spx.get_spx_order_label(db_session, "SPXVN06647830539A")

    assert fallback_called["called"] is False


@pytest.mark.parametrize("empty_input", ["", "   ", "\n\t  "])
def test_t2_empty_whitespace_tracking_codes_rejected(db_session, empty_input: str):
    """Tier 2 (F6): Verify quick_print_by_code and sync_spx_orders_batch reject empty/whitespace inputs."""
    with pytest.raises(ValueError):
        spx.quick_print_by_code(db_session, empty_input, print_remote=False)

    with pytest.raises(ValueError):
        spx.sync_spx_orders_batch(db_session, empty_input)


def test_t2_adversarial_unicode_and_special_chars_in_recipient_metadata(db_session):
    """Tier 2 (Adversarial): Verify Unicode Vietnamese diacritics, quotes, and symbols in SPX metadata do not corrupt state."""
    shipment = _make_shipment_row(db_session, tracking_no="SPXVN06647830539A", order_code="VN266915710568180Q")
    adversarial_online = {
        "data": {
            "order_info": {"order_sn": "VN266915710568180Q", "spx_tn": "SPXVN06647830539A"},
            "deliver_info": {
                "deliver_name": "Nguyễn Thị Ánh Tuyết — Công Ty CP ĐT & PT Công Nghệ <iNut> 'A&B'",
                "deliver_phone": "+84 (035) 724-2389",
                "deliver_detail_address": "Lô B2-14, Đường số 5, KCN Hòa Khánh; P. Hòa Khánh Bắc, Q. Liên Chiểu",
            },
            "parcel_info": {"parcel_item_name": "Bộ điều khiển trung tâm 4G/RS485 (100% chính hãng)", "parcel_weight": 0.85},
            "fulfillment_info": {"cod_amount": 0},
        }
    }
    spx._apply_online_info_to_shipment(shipment, adversarial_online)
    db_session.commit()
    db_session.refresh(shipment)
    assert "Nguyễn Thị Ánh Tuyết" in shipment.recipient_name
    assert "<iNut>" in shipment.recipient_name
    assert shipment.weight_gram == 850


# ===========================================================================
# TIER 3: CROSS-FEATURE PAIRWISE COMBINATIONS — 12 TEST CASES
# ===========================================================================


@pytest.mark.parametrize(
    "expired_retcode,expired_status,configured_pw",
    [
        (2203, 401, "NhapHang123@"),
        (2203, 200, "NhapHang123@"),
        (2204, 200, "NhapHang123"),
        (10010, 401, "NhapHang123"),
    ],
)
def test_t3_expired_cookie_triggers_auto_relogin_and_fetches_order_online(
    db_session, monkeypatch, expired_retcode: int, expired_status: int, configured_pw: str
):
    """Tier 3 (F1+F3+F4): Expired cookie (401/2203/2204/10010) triggers auto_login_spx (with fallback) and retries order lookup."""
    mock_api = ConfigurableSpxMock()
    mock_api.require_token_check = True
    mock_api.order_info_status = expired_status
    mock_api.order_info_retcode = expired_retcode
    mock_api.install(monkeypatch)

    spx.save_spx_settings(
        db_session,
        {
            "spx_username": "0345296757",
            "spx_password": configured_pw,
            "spx_cookies": "spx_token=expired_token_000; spx_sid=expired_sid_000",
        },
    )

    def fake_playwright_login(u: str, p: str, timeout: int = 45) -> str:
        if p != "NhapHang123@":
            raise RuntimeError("Wrong password")
        mock_api.order_info_status = 200
        mock_api.order_info_retcode = 0
        return "spx_token=fresh_tok; spx_sid=fresh_sid"

    monkeypatch.setattr(spx, "_run_playwright_spx_login", fake_playwright_login)

    online = spx.fetch_spx_order_online(db_session, "SPXVN06647830539A", auto_relogin=True)
    assert online is not None
    assert online["order_info"]["order_sn"] == "VN266915710568180Q"
    raw = spx.get_spx_raw_credentials(db_session)
    assert "spx_token=fresh_tok" in raw["spx_cookies"]
    assert raw["spx_password"] == "NhapHang123@"


@pytest.mark.parametrize(
    "tracking_input",
    [
        "SPXVN06647830539A",
        "VN266915710568180Q",
        "SPXVN0888999111",
        "VN266915888999Q",
    ],
)
def test_t3_expired_cookie_auto_relogin_label_download_golden_ratio_and_share(
    db_session, monkeypatch, tracking_input: str
):
    """Tier 3 (F3+F4+F5+F8+F9+F10): Expired session -> auto-relogin -> online order fetch -> PDF download -> 65% scale -> 90d share -> remote print."""
    mock_api = ConfigurableSpxMock()
    mock_api.require_token_check = True
    mock_api.install(monkeypatch)

    spx.save_spx_settings(
        db_session,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=expired_tok; spx_sid=expired_sid",
        },
    )
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda u, p, timeout=45: "spx_token=fresh_tok; spx_sid=fresh_sid",
    )
    remote_printed: list[tuple[str, str, str]] = []

    def fake_print_remote(db_s, tn: str, host: str = "192.168.1.10", printer_name: str = "TP732H") -> dict[str, Any]:
        remote_printed.append((tn, host, printer_name))
        return {"success": True, "message": f"Printed {tn} on {printer_name}@{host}"}

    monkeypatch.setattr(spx, "print_spx_order_remote", fake_print_remote)

    res = spx.quick_print_by_code(
        db_session,
        tracking_input,
        printer_name="TP732H",
        host="192.168.1.10",
        print_remote=True,
    )
    assert res["success"] is True
    assert res["print_remote_success"] is True
    assert res["recipient_name"] == "Anh Tài"
    assert res["share_url"].startswith("/s/")
    assert len(remote_printed) == 1
    assert remote_printed[0][1] == "192.168.1.10"
    assert remote_printed[0][2] == "TP732H"


@pytest.mark.parametrize(
    "poison_type",
    [
        "reportlab_pdf",
        "placeholder_recipient",
        "missing_vn_order_code",
        "force_refresh_flag",
    ],
)
def test_t3_poisoned_cache_remediation_end_to_end_pipeline(
    db_session, monkeypatch, poison_type: str
):
    """Tier 3 (F5+F7+F8+F9): Poisoned DB row is detected, invalidated, re-fetched online, scaled 65%, and re-shared."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    spx.save_spx_settings(
        db_session,
        {"spx_username": "0345296757", "spx_password": "NhapHang123@", "spx_cookies": "spx_token=valid_tok; spx_sid=s1"},
    )

    if poison_type == "reportlab_pdf":
        bad_pdf = spx_label.generate_spx_a6_label(
            tracking_no="SPXVN06647830539A",
            recipient_name="Khách hàng SPX (30539A)",
            recipient_phone="",
            recipient_address="Địa chỉ nhận hàng theo đơn SPX Express",
        )
    else:
        bad_pdf = spx.scale_pdf_golden_ratio(_make_authentic_spx_pdf())

    old_doc_id = storage.save_upload(bad_pdf, suffix=".pdf")
    shipment = _make_shipment_row(
        db_session,
        tracking_no="SPXVN06647830539A",
        order_code="SPXVN06647830539A" if poison_type == "missing_vn_order_code" else "VN266915710568180Q",
        recipient_name="Khách hàng SPX (30539A)" if poison_type == "placeholder_recipient" else "Anh Tài",
        label_doc_id=old_doc_id,
    )

    pdf_out = spx.get_spx_order_label(
        db_session,
        "SPXVN06647830539A",
        force_refresh=(poison_type == "force_refresh_flag"),
    )
    db_session.refresh(shipment)
    assert shipment.label_doc_id != old_doc_id
    assert shipment.order_code == "VN266915710568180Q"
    assert shipment.recipient_name == "Anh Tài"
    assert b"ReportLab" not in pdf_out


# ===========================================================================
# TIER 4: REAL-WORLD END-TO-END APPLICATION SCENARIOS (REST API) — 6 CASES
# ===========================================================================


def test_t4_e2e_rest_settings_session_validate_and_refresh(auth_client, monkeypatch):
    """Tier 4 Scenario 1: Configure SPX settings via REST, validate session, and trigger headless session refresh."""
    mock_api = ConfigurableSpxMock()
    mock_api.require_token_check = True
    mock_api.install(monkeypatch)
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda u, p, timeout=45: "spx_token=fresh_tok; spx_sid=fresh_sid; login_status=true",
    )

    # 1. Save credentials with expired cookie
    r_save = auth_client.post(
        "/api/spx/settings",
        json={
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=expired_tok; spx_sid=expired_sid",
        },
    )
    assert r_save.status_code == 200
    assert r_save.json()["spx_password"] == "********"

    # 2. Validate session -> should report invalid
    r_val1 = auth_client.get("/api/spx/session/validate")
    assert r_val1.status_code == 200
    assert r_val1.json()["valid"] is False

    # 3. Trigger /api/spx/session/refresh
    r_ref = auth_client.post("/api/spx/session/refresh", json={})
    assert r_ref.status_code == 200
    assert r_ref.json()["success"] is True
    assert r_ref.json()["spx_token"] == "fresh_tok"

    # 4. Validate session again -> valid!
    r_val2 = auth_client.get("/api/spx/session/validate")
    assert r_val2.status_code == 200
    assert r_val2.json()["valid"] is True


def test_t4_e2e_rest_merap_group_order_quick_print_label_and_public_share(auth_client, monkeypatch):
    """Tier 4 Scenario 2: Full E2E lifecycle for SPXVN06647830539A (Anh Tài - Merap Group) + public /s/{token} access."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)

    # 1. Quick-print SPXVN06647830539A
    r_qp = auth_client.post(
        "/api/spx/quick-print",
        json={"tracking_no": "SPXVN06647830539A", "print_remote": False},
    )
    assert r_qp.status_code == 200
    qp_data = r_qp.json()
    assert qp_data["tracking_no"] == "SPXVN06647830539A"
    assert qp_data["order_code"] == "VN266915710568180Q"
    assert qp_data["recipient_name"] == "Anh Tài"
    assert qp_data["share_url"].startswith("/s/")

    # 2. Fetch PDF label from /api/spx/orders/SPXVN06647830539A/label
    r_lbl = auth_client.get("/api/spx/orders/SPXVN06647830539A/label")
    assert r_lbl.status_code == 200
    assert r_lbl.headers["content-type"] == "application/pdf"
    assert r_lbl.content.startswith(b"%PDF")
    assert b"ReportLab" not in r_lbl.content

    # 3. Access public share link /s/{token} and /api/share/{token}/view
    share_token = qp_data["share_token"]
    r_pub = auth_client.get(f"/s/{share_token}")
    assert r_pub.status_code == 200

    r_pub_pdf = auth_client.get(f"/api/share/{share_token}/view")
    assert r_pub_pdf.status_code == 200
    assert r_pub_pdf.content.startswith(b"%PDF")


def test_t4_e2e_rest_auto_login_endpoint_and_failure_reporting(auth_client, monkeypatch):
    """Tier 4 Scenario 3: Verify /api/spx/auto-login endpoint returns 200 on success and 500 with clear detail on failure."""
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda u, p, timeout=45: "spx_token=auto_tok_1; spx_sid=auto_sid_1",
    )
    r_ok = auth_client.post("/api/spx/auto-login", json={"username": "0345296757", "password": "NhapHang123@"})
    assert r_ok.status_code == 200
    assert r_ok.json()["success"] is True

    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda u, p, timeout=45: (_ for _ in ()).throw(RuntimeError("Playwright timeout")),
    )
    r_fail = auth_client.post("/api/spx/auto-login", json={"username": "0345296757", "password": "WrongPassword"})
    assert r_fail.status_code == 500
    assert "Lỗi tự động đăng nhập SPX" in r_fail.json()["detail"]


def test_t4_e2e_rest_zero_fake_template_blocks_unresolvable_spxvn(auth_client, monkeypatch):
    """Tier 4 Scenario 4: Verify REST /api/spx/quick-print and /api/spx/sync-orders return 500 and create 0 fake rows when SPX is unreachable."""
    monkeypatch.setattr(spx, "fetch_spx_order_online", lambda *a, **kw: None)
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Network unreachable")),
    )

    r_qp = auth_client.post(
        "/api/spx/quick-print",
        json={"tracking_no": "SPXVN06647830539A", "print_remote": False},
    )
    assert r_qp.status_code == 500
    assert "Tuyệt đối không tự chế tem mẫu" in r_qp.json()["detail"]

    r_get = auth_client.get("/api/spx/orders/SPXVN06647830539A")
    assert r_get.status_code == 404


def test_t4_e2e_rest_force_refresh_label_query_param(auth_client, monkeypatch):
    """Tier 4 Scenario 5: Verify GET /api/spx/orders/{tracking_no}/label?force_refresh=true re-downloads and updates doc_id."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)

    r_qp = auth_client.post(
        "/api/spx/quick-print",
        json={"tracking_no": "SPXVN06647830539A", "print_remote": False},
    )
    assert r_qp.status_code == 200
    first_doc_id = r_qp.json()["label_doc_id"]

    r_refresh = auth_client.get("/api/spx/orders/SPXVN06647830539A/label?force_refresh=true")
    assert r_refresh.status_code == 200
    assert r_refresh.content.startswith(b"%PDF")

    r_order = auth_client.get("/api/spx/orders/SPXVN06647830539A")
    assert r_order.status_code == 200
    assert r_order.json()["label_doc_id"] != first_doc_id


def test_t4_e2e_rest_batch_sync_and_batch_print_workflow(auth_client, monkeypatch):
    """Tier 4 Scenario 6: Sync batch of official SPX orders, verify stats, and execute batch print."""
    mock_api = ConfigurableSpxMock()
    mock_api.install(monkeypatch)
    monkeypatch.setattr(
        spx,
        "print_spx_order_remote",
        lambda db_s, tn, host="192.168.1.10", printer_name="TP732H": {"success": True, "tracking_no": tn},
    )

    r_sync = auth_client.post(
        "/api/spx/sync-orders",
        json={"raw_text": "SPXVN06647830539A\nSPXVN0555666777"},
    )
    assert r_sync.status_code == 200
    assert r_sync.json()["total_synced"] == 2

    r_bp = auth_client.post(
        "/api/spx/batch-print",
        json={"tracking_numbers": ["SPXVN06647830539A", "SPXVN0555666777"], "printer_name": "TP732H", "host": "192.168.1.10"},
    )
    assert r_bp.status_code == 200
    assert r_bp.json()["total_printed"] == 2
