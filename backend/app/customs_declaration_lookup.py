"""Module tra cứu thông tin tờ khai Hải Quan trực tuyến từ Cổng Tổng cục Hải quan (customs.gov.vn).

Cổng thông tin: https://www.customs.gov.vn/index.jsp?pageId=136&cid=93
API nội bộ: /bridge?url=/customs/presentation/soapclient/TracuuTTTK

Hằng số định danh doanh nghiệp INUT JSC:
- Mã số doanh nghiệp (MST): 4401053694
- Số chứng minh thư / CCCD người đại diện pháp luật: 054096010424 (Ngô Huỳnh Ngọc Khánh)
"""

from __future__ import annotations

import base64
import logging
import time
import re
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import InvCustomsDecl, InvCustomsDriveFolder
from .inventory import normalize_name

logger = logging.getLogger(__name__)

CUSTOMS_PORTAL_BASE = "https://www.customs.gov.vn"
CUSTOMS_LOOKUP_PAGE = "/index.jsp?pageId=136&cid=93"
DEFAULT_MST = "4401053694"
DEFAULT_SO_CMT = "054096010424"


class CustomsDeclarationLookupError(RuntimeError):
    pass


def _solve_captcha(img_bytes: bytes) -> str:
    try:
        import ddddocr

        ocr = ddddocr.DdddOcr(show_ad=False)
        return str(ocr.classification(img_bytes)).strip()
    except Exception as exc:
        logger.warning(f"Lỗi giải captcha ddddocr: {exc}")
        return ""


def lookup_customs_declaration(
    so_to_khai: str,
    ma_doanh_nghiep: str = DEFAULT_MST,
    so_cmt: str = DEFAULT_SO_CMT,
    max_retries: int = 5,
) -> dict[str, Any]:
    """Tra cứu thông tin chi tiết tờ khai trên cổng Hải Quan Việt Nam (customs.gov.vn).

    Args:
        so_to_khai: Số tờ khai 12 chữ số (vd: 108625440120)
        ma_doanh_nghiep: Mã số thuế doanh nghiệp (mặc định: 4401053694)
        so_cmt: Số CMND/CCCD người đại diện (mặc định: 054096010424)
        max_retries: Số lần thử lại giải captcha nếu server báo không hợp lệ
    """
    so_to_khai = str(so_to_khai).strip()
    ma_doanh_nghiep = str(ma_doanh_nghiep).strip() or DEFAULT_MST
    so_cmt = str(so_cmt).strip() or DEFAULT_SO_CMT

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": f"{CUSTOMS_PORTAL_BASE}{CUSTOMS_LOOKUP_PAGE}",
        "X-Requested-With": "XMLHttpRequest",
    }

    last_error = ""
    for attempt in range(1, max_retries + 1):
        try:
            with httpx.Client(
                base_url=CUSTOMS_PORTAL_BASE,
                verify=False,
                timeout=30.0,
                follow_redirects=True,
            ) as client:
                # 1. Khởi tạo session / cookie
                client.get(CUSTOMS_LOOKUP_PAGE, headers=headers)

                # 2. Lấy ảnh Captcha
                r_cap = client.post("/Captcha", headers=headers)
                if r_cap.status_code != 200 or not r_cap.text.strip():
                    time.sleep(0.5)
                    continue

                img_bytes = base64.b64decode(r_cap.text.strip())
                captcha_code = _solve_captcha(img_bytes)
                if not captcha_code:
                    time.sleep(0.5)
                    continue

                # 3. Gửi truy vấn tra cứu
                payload = {
                    "sotk": so_to_khai,
                    "madn": ma_doanh_nghiep,
                    "socmt": so_cmt,
                    "captcha": captcha_code,
                }
                resp = client.post(
                    "/bridge?url=/customs/presentation/soapclient/TracuuTTTK",
                    json=payload,
                    headers=headers,
                )
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                    time.sleep(0.5)
                    continue

                data = resp.json()
                if data.get("message") == "Invalid Captcha":
                    last_error = "Captcha không chính xác, đang thử lại..."
                    time.sleep(0.5)
                    continue

                customs = data.get("CUSTOMS") or {}
                error = customs.get("ERROR") or {}
                if error.get("ERROR_NUMBER") != 0:
                    err_msg = error.get("ERROR_MESSAGE") or "Lỗi nghiệp vụ hải quan"
                    raise CustomsDeclarationLookupError(err_msg)

                d_data = customs.get("DATA") or {}
                tttk = d_data.get("THONG_TIN_TK") or {}
                ctnt = d_data.get("CHI_TIET_NO_THUE") or {}
                no_thue = ctnt.get("NO_THUE") or {}

                # 4. Tra cứu thông tin phân công kiểm tra tờ khai (Người kiểm tra & Trạng thái xử lý)
                nguoi_kiem_tra_info = {
                    "trang_thai_xu_ly": "",
                    "cong_chuc_kiem_tra_ho_so": "",
                    "cong_chuc_kiem_tra_hang_hoa": "",
                    "thoi_gian_hien_thi": "",
                    "raw": "",
                }
                ngay_dk_str = str(tttk.get("NGAY_DK") or "").strip()
                if ngay_dk_str:
                    clean_date = ngay_dk_str.replace("/", "-")
                    parts_date = clean_date.split("-")
                    if len(parts_date) == 3:
                        if len(parts_date[0]) == 4:
                            ngaydk = f"{parts_date[0]}{parts_date[1].zfill(2)}{parts_date[2].zfill(2)}"
                        else:
                            ngaydk = f"{parts_date[2]}{parts_date[1].zfill(2)}{parts_date[0].zfill(2)}"
                    else:
                        ngaydk = ngay_dk_str[:8]

                    try:
                        resp_kt = client.post(
                            "/bridge?url=/customs/presentation/soapclient/PhanCongKiemTraTK",
                            json={
                                "sotk": so_to_khai[:11],
                                "mst": ma_doanh_nghiep,
                                "ngaydk": ngaydk,
                            },
                            headers=headers,
                        )
                        if resp_kt.status_code == 200 and resp_kt.text.strip():
                            raw_kt = resp_kt.text.strip()
                            parts_kt = raw_kt.split("|", 1)
                            content_kt = parts_kt[1] if len(parts_kt) > 1 else parts_kt[0]
                            lines_kt = [
                                re.sub(r"<[^>]+>", "", line).strip()
                                for line in re.split(r"<br\s*/?>", content_kt)
                                if line.strip()
                            ]
                            nguoi_kiem_tra_info["raw"] = content_kt
                            for line in lines_kt:
                                if line.lower().startswith("trạng thái xử lý:"):
                                    nguoi_kiem_tra_info["trang_thai_xu_ly"] = line.split(":", 1)[1].strip()
                                elif line.lower().startswith("công chức kiểm tra hồ sơ:"):
                                    nguoi_kiem_tra_info["cong_chuc_kiem_tra_ho_so"] = line.split(":", 1)[1].strip()
                                elif line.lower().startswith("công chức kiểm tra hàng hóa:"):
                                    nguoi_kiem_tra_info["cong_chuc_kiem_tra_hang_hoa"] = line.split(":", 1)[1].strip()
                                elif line.lower().startswith("thời gian hiển thị:"):
                                    nguoi_kiem_tra_info["thoi_gian_hien_thi"] = line.split(":", 1)[1].strip()
                    except Exception as exc_kt:
                        logger.warning(f"Lỗi tra cứu PhanCongKiemTraTK: {exc_kt}")


                return {
                    "ok": True,
                    "portal_url": f"{CUSTOMS_PORTAL_BASE}{CUSTOMS_LOOKUP_PAGE}",
                    "so_to_khai": str(tttk.get("SO_TK") or so_to_khai),
                    "ma_doanh_nghiep": str(tttk.get("MA_DV") or ma_doanh_nghiep),
                    "so_cmt": so_cmt,
                    "phan_luong": tttk.get("TEN_LUONG") or "",
                    "ma_hai_quan": tttk.get("MA_HQ") or "",
                    "ten_hai_quan": tttk.get("TEN_HQ") or "",
                    "ma_loai_hinh": tttk.get("MA_LH") or "",
                    "ten_loai_hinh": tttk.get("TEN_LH") or "",
                    "nam_dang_ky": tttk.get("NAM_DK") or 0,
                    "ngay_dang_ky": tttk.get("NGAY_DK") or "",
                    "ngay_thong_quan": tttk.get("NGAY_TQ") or "",
                    "ngay_qua_kvgs": tttk.get("NGAY_QUA_KVGS") or "",
                    "nguoi_kiem_tra": nguoi_kiem_tra_info,
                    "thue": {
                        "loai_thue": ctnt.get("TEN_LT") or "",
                        "tai_khoan_nop": ctnt.get("TEN_NTK") or "",
                        "ten_sac_thue": no_thue.get("TEN_ST") or "",
                        "da_nop": no_thue.get("DA_NOP") or 0,
                        "phai_nop": no_thue.get("PHAI_NOP") or 0,
                        "con_no": no_thue.get("CON_NO") or 0,
                    },
                    "raw": data,
                }
        except CustomsDeclarationLookupError:
            raise
        except Exception as exc:
            last_error = str(exc)
            time.sleep(0.5)

    raise CustomsDeclarationLookupError(
        f"Không thể tra cứu tờ khai {so_to_khai} sau {max_retries} lần thử: {last_error}"
    )


def lookup_declaration_by_ref(
    db: Session,
    ref: str | int,
    so_cmt: str = DEFAULT_SO_CMT,
) -> dict[str, Any]:
    """Tra cứu tờ khai theo số tờ khai (12 số), ID tờ khai, ID folder hoặc tên bộ hồ sơ.

    Args:
        db: SQLAlchemy session
        ref: Số tờ khai, ID tờ khai, ID folder hoặc tên bộ hồ sơ (vd: "màn hình về sản xuất")
        so_cmt: Số CCCD người đại diện (mặc định: 054096010424)
    """
    ref_str = str(ref).strip()
    so_to_khai = ""
    ma_dn = DEFAULT_MST
    matched_decl: InvCustomsDecl | None = None
    matched_folder: InvCustomsDriveFolder | None = None

    # 1. Trường hợp là 12 chữ số tờ khai
    if ref_str.isdigit() and len(ref_str) == 12:
        so_to_khai = ref_str
        matched_decl = db.scalar(select(InvCustomsDecl).where(InvCustomsDecl.so_to_khai == so_to_khai))
        if matched_decl:
            matched_folder = db.scalar(select(InvCustomsDriveFolder).where(InvCustomsDriveFolder.customs_id == matched_decl.id))

    # 2. Trường hợp là số nguyên nhỏ (ID tờ khai hoặc ID folder)
    elif ref_str.isdigit() and int(ref_str) < 1000:
        nid = int(ref_str)
        # Thử tìm theo Decl ID
        decl = db.get(InvCustomsDecl, nid)
        if decl:
            matched_decl = decl
            so_to_khai = decl.so_to_khai
            matched_folder = db.scalar(select(InvCustomsDriveFolder).where(InvCustomsDriveFolder.customs_id == decl.id))
        else:
            # Thử tìm theo Folder ID
            folder = db.get(InvCustomsDriveFolder, nid)
            if folder and folder.customs_id:
                matched_folder = folder
                matched_decl = db.get(InvCustomsDecl, folder.customs_id)
                if matched_decl:
                    so_to_khai = matched_decl.so_to_khai

    # 3. Trường hợp tìm theo tên bộ hồ sơ
    if not so_to_khai:
        norm_q = normalize_name(ref_str)
        folders = list(db.scalars(select(InvCustomsDriveFolder)))
        for f in folders:
            norm_name = normalize_name(f.name or "")
            norm_path = normalize_name(f.path or "")
            # So khớp nếu tên hồ sơ chứa từ khóa (vd: "man hinh ve san xuat" trong "man hinh android ve san xuat")
            if (
                norm_q in norm_name
                or norm_name in norm_q
                or all(word in norm_name for word in norm_q.split() if word not in ("ve", "bo", "ho", "so"))
            ):
                matched_folder = f
                if f.customs_id:
                    matched_decl = db.get(InvCustomsDecl, f.customs_id)
                    if matched_decl:
                        so_to_khai = matched_decl.so_to_khai
                break

    if not so_to_khai and matched_folder and not matched_folder.customs_id:
        raise CustomsDeclarationLookupError(
            f"Bộ hồ sơ '{matched_folder.name}' chưa được gán số tờ khai hải quan."
        )

    if not so_to_khai:
        raise CustomsDeclarationLookupError(
            f"Không tìm thấy số tờ khai hoặc bộ hồ sơ phù hợp cho '{ref_str}'."
        )

    res = lookup_customs_declaration(
        so_to_khai=so_to_khai,
        ma_doanh_nghiep=ma_dn,
        so_cmt=so_cmt,
    )
    if matched_folder:
        res["folder_name"] = matched_folder.name
        res["folder_id"] = matched_folder.id
        res["drive_folder_id"] = matched_folder.drive_folder_id
    if matched_decl:
        res["decl_id"] = matched_decl.id
        res["doi_tac"] = matched_decl.nguoi_xk or ""
        res["so_van_don"] = matched_decl.so_van_don or ""
    return res
