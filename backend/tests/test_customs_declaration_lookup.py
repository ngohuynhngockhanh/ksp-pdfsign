from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.customs_declaration_lookup import (
    DEFAULT_MST,
    DEFAULT_SO_CMT,
    CustomsDeclarationLookupError,
    lookup_customs_declaration,
    lookup_declaration_by_ref,
)
from app.db import InvCustomsDecl, InvCustomsDriveFolder


def test_lookup_customs_declaration_success(monkeypatch):
    fake_response = {
        "CUSTOMS": {
            "DATA": {
                "THONG_TIN_TK": {
                    "SO_TK": 108625440120,
                    "MA_DV": 4401053694,
                    "TEN_LUONG": "Luồng Vàng",
                    "MA_HQ": "06DS",
                    "TEN_HQ": "Hải quan Chuyển phát nhanh",
                    "MA_LH": "A11",
                    "TEN_LH": "Nhập kinh doanh tiêu dùng",
                    "NAM_DK": 2026,
                    "NGAY_DK": "15-09-2026",
                    "NGAY_TQ": "",
                    "NGAY_QUA_KVGS": "",
                },
                "CHI_TIET_NO_THUE": {
                    "TEN_LT": "Thuế xuất nhập khẩu",
                    "TEN_NTK": "Tài khoản nộp ngân sách",
                    "NO_THUE": {
                        "TEN_ST": "Thuế giá trị gia tăng",
                        "DA_NOP": 1726998,
                        "PHAI_NOP": 0,
                        "CON_NO": -1726998,
                    },
                },
            },
            "ERROR": {"ERROR_NUMBER": 0, "ERROR_MESSAGE": "Thực hiện thành công!"},
        }
    }

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, headers=None):
            class R:
                status_code = 200

            return R()

        def post(self, url, headers=None, json=None):
            class R:
                status_code = 200
                if "PhanCongKiemTraTK" in url:
                    text = "19854844|Trạng thái xử lý: Đang xử lý<br><br>Công chức kiểm tra hồ sơ: Lê Văn Hải<br><br>Công chức kiểm tra hàng hóa: <br><br>Thời gian hiển thị: 15/09/2026 10:22:23"
                else:
                    text = "iVBORw0KGgoAAAANSUhEUg=="

                def json(self):
                    return fake_response

            return R()

    monkeypatch.setattr("httpx.Client", FakeClient)
    monkeypatch.setattr("app.customs_declaration_lookup._solve_captcha", lambda _b: "abc12")

    res = lookup_customs_declaration("108625440120", DEFAULT_MST, DEFAULT_SO_CMT)
    assert res["ok"] is True
    assert res["so_to_khai"] == "108625440120"
    assert res["phan_luong"] == "Luồng Vàng"
    assert res["thue"]["da_nop"] == 1726998
    assert res["nguoi_kiem_tra"]["trang_thai_xu_ly"] == "Đang xử lý"
    assert res["nguoi_kiem_tra"]["cong_chuc_kiem_tra_ho_so"] == "Lê Văn Hải"
    assert res["nguoi_kiem_tra"]["thoi_gian_hien_thi"] == "15/09/2026 10:22:23"


def test_lookup_declaration_by_ref_not_found(monkeypatch):
    from app.db import reset_engine_for_tests, init_db, get_session
    reset_engine_for_tests()
    init_db()
    for db in get_session():
        with pytest.raises(CustomsDeclarationLookupError, match="Không tìm thấy"):
            lookup_declaration_by_ref(db, "tờ khai không tồn tại xyz")
        break
