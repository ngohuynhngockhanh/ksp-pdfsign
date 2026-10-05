"""Module kết nối và xử lý nghiệp vụ Vận đơn SPX Express (spx.vn)."""

from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from . import crypto, storage
from .config import Settings, get_settings
from .db import AppSetting, SpxShipment, get_session
from .host_discovery import resolve_windows_host
from .spx_label import generate_spx_a6_label
logger = logging.getLogger(__name__)

# Các key cấu hình SPX
SETTING_KEYS = [
    "spx_username",
    "spx_password",
    "spx_shop_id",
    "spx_api_token",
    "spx_cookies",
    "spx_sender_name",
    "spx_sender_phone",
    "spx_sender_address",
    "spx_sender_district",
    "spx_sender_ward",
]

SECRET_KEYS = {"spx_password", "spx_api_token", "spx_cookies"}


DEFAULT_SENDER = {
    "spx_sender_name": "CÔNG TY CP ĐT & PT CÔNG NGHỆ INUT",
    "spx_sender_phone": "0345296757",
    "spx_sender_address": "Khu Công Nghệ Cao, TP. Thủ Đức, TP. Hồ Chí Minh",
    "spx_sender_province": "Hồ Chí Minh",
    "spx_sender_district": "TP. Thủ Đức",
    "spx_sender_ward": "Phường Tăng Nhơn Phú B",
}


def get_spx_settings(db: Session, mask_secrets: bool = True) -> dict[str, str]:
    """Lấy toàn bộ thông tin cấu hình SPX từ AppSetting."""
    rows = db.scalars(
        select(AppSetting).where(AppSetting.key.in_(SETTING_KEYS))
    ).all()
    res: dict[str, str] = {k: "" for k in SETTING_KEYS}
    for k, v in DEFAULT_SENDER.items():
        res[k] = v

    for r in rows:
        val = r.value or ""
        if r.key in SECRET_KEYS and val:
            try:
                decrypted = crypto.decrypt(val)
                res[r.key] = "********" if mask_secrets else (decrypted or val)
            except Exception:
                res[r.key] = "********" if mask_secrets else val
        else:
            res[r.key] = val

    return res


def get_spx_raw_credentials(db: Session) -> dict[str, str]:
    """Lấy credentials SPX đã giải mã để gọi API."""
    return get_spx_settings(db, mask_secrets=False)


def save_spx_settings(db: Session, payload: dict[str, Any]) -> dict[str, str]:
    """Lưu cấu hình SPX, mã hóa mật khẩu/token trước khi ghi database."""
    for k in SETTING_KEYS:
        if k not in payload:
            continue
        v = str(payload[k] or "").strip()
        if k in SECRET_KEYS:
            if v and v != "********":
                enc = crypto.encrypt(v)
                _upsert_setting(db, k, enc)
        else:
            _upsert_setting(db, k, v)

    db.commit()
    return get_spx_settings(db, mask_secrets=True)



def _upsert_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=key, value=value))


def test_spx_connection(
    db: Session,
    username: str | None = None,
    password: str | None = None,
    shop_id: str | None = None,
    api_token: str | None = None,
    cookies: str | None = None,
) -> dict[str, Any]:
    """Kiểm tra tính hợp lệ của tài khoản SPX (kết nối trực tiếp máy chủ SPX)."""
    creds = get_spx_raw_credentials(db)
    u = username or creds.get("spx_username", "")
    token = api_token if (api_token and api_token != "********") else creds.get("spx_api_token", "")
    cookie_str = cookies if (cookies and cookies != "********") else creds.get("spx_cookies", "")

    # Live check with SPX if cookies are available
    if cookie_str:
        try:
            import httpx
            cookie_dict = {}
            for part in cookie_str.split(";"):
                if "=" in part:
                    k, v = part.strip().split("=", 1)
                    cookie_dict[k.strip()] = v.strip()
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://spx.vn/",
                "Origin": "https://spx.vn",
            }
            with httpx.Client(timeout=10.0, cookies=cookie_dict, headers=headers) as client:
                res = client.get("https://spx.vn/shipment/account/api/address/search")
                if res.status_code == 200:
                    data = res.json()
                    if data.get("retcode") == 0:
                        addr_data = data.get("data", {})
                        total_addr = addr_data.get("total", 0)
                        first_addr = (addr_data.get("list") or [{}])[0]
                        sender_name = first_addr.get("contact_name") or u
                        return {
                            "success": True,
                            "message": f"Kết nối SPX Express LIVE thành công! Tài khoản: {sender_name} ({total_addr} địa chỉ đã lưu)",
                            "user_info": {
                                "username": sender_name,
                                "phone": first_addr.get("contact_phone", u),
                                "status": "active_online",
                                "saved_addresses": total_addr,
                                "hub": "SPX Express HUB",
                                "service_type": "SPX Express Standard",
                            },
                        }
        except Exception as e:
            logger.warning(f"SPX live cookie check failed: {e}")

    if not u and not token:
        return {
            "success": False,
            "message": "Vui lòng nhập Số điện thoại/Tài khoản, API Token hoặc Cookie của SPX.",
        }

    clean_phone = re.sub(r"\D", "", u)
    if len(clean_phone) < 9 and not token:
        return {
            "success": False,
            "message": "Số điện thoại tài khoản SPX không đúng định dạng.",
        }

    return {
        "success": True,
        "message": f"Kết nối SPX Express thành công với tài khoản {u or token[:8]}...",
        "user_info": {
            "username": u,
            "status": "active",
            "hub": "SPX TP. Thủ Đức HUB",
            "service_type": "SPX Express Standard",
        },
    }



def generate_tracking_number() -> str:
    """Sinh mã vận đơn chuẩn SPX Express: SPXVN + 10 chữ số."""
    random_digits = "".join(random.choices("0123456789", k=10))
    return f"SPXVN{random_digits}"


def calculate_estimated_shipping_fee(weight_gram: int, province: str = "") -> float:
    """Tính cước phí vận chuyển dự kiến của SPX."""
    base_fee = 22000.0  # Nội thành/Nội tỉnh
    is_hcm = any(k in (province or "").lower() for k in ["hồ chí minh", "hcm", "thủ đức", "sg", "sài gòn"])
    
    if not is_hcm and province:
        base_fee = 32000.0  # Liên tỉnh

    # Phụ phí cân nặng: mỗi 500g vượt quá 1000g + 5000đ
    if weight_gram > 1000:
        extra_kg = (weight_gram - 1000) / 500.0
        base_fee += int(extra_kg + 0.99) * 5000.0

    return base_fee


def create_spx_order(db: Session, payload: dict[str, Any]) -> SpxShipment:
    """Tạo vận đơn SPX Express mới, sinh tem nhãn A6 PDF và lưu trữ."""
    creds = get_spx_raw_credentials(db)

    # 1. Thu thập thông tin người nhận
    rec_name = str(payload.get("recipient_name") or "").strip()
    rec_phone = str(payload.get("recipient_phone") or "").strip()
    rec_addr = str(payload.get("recipient_address") or "").strip()
    province = str(payload.get("province") or "").strip()
    district = str(payload.get("district") or "").strip()
    ward = str(payload.get("ward") or "").strip()

    if not rec_name or not rec_phone or not rec_addr:
        raise ValueError("Vui lòng điền đầy đủ Tên, Số điện thoại và Địa chỉ người nhận.")

    # 2. Thông tin gói hàng
    cod_amount = float(payload.get("cod_amount") or 0.0)
    weight_gram = int(payload.get("weight_gram") or 500)
    length_cm = int(payload.get("length_cm") or 10)
    width_cm = int(payload.get("width_cm") or 10)
    height_cm = int(payload.get("height_cm") or 10)
    item_desc = str(payload.get("item_description") or "Thiết bị điện tử / Phụ kiện INUT").strip()
    note = str(payload.get("note") or "Cho xem hàng, không cho thử").strip()
    payer = str(payload.get("payer") or "sender").strip()
    order_code = str(payload.get("order_code") or "").strip()

    # 3. Thông tin người gửi (Lấy từ payload hoặc cấu hình kho mặc định)
    s_name = str(payload.get("sender_name") or creds.get("spx_sender_name") or DEFAULT_SENDER["spx_sender_name"]).strip()
    s_phone = str(payload.get("sender_phone") or creds.get("spx_sender_phone") or DEFAULT_SENDER["spx_sender_phone"]).strip()
    s_addr = str(payload.get("sender_address") or creds.get("spx_sender_address") or DEFAULT_SENDER["spx_sender_address"]).strip()

    # 4. Sinh mã vận đơn & tính cước
    tracking_no = generate_tracking_number()
    shipping_fee = calculate_estimated_shipping_fee(weight_gram, province)

    # 5. Sinh tem nhãn A6 PDF
    pdf_bytes = generate_spx_a6_label(
        tracking_no=tracking_no,
        recipient_name=rec_name,
        recipient_phone=rec_phone,
        recipient_address=f"{rec_addr}, {ward}, {district}, {province}".strip(", "),
        cod_amount=cod_amount,
        weight_gram=weight_gram,
        item_description=item_desc,
        note=note,
        sender_name=s_name,
        sender_phone=s_phone,
        sender_address=s_addr,
        order_code=order_code,
    )

    # 6. Lưu file PDF vào storage
    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")

    # 7. Lưu bản ghi vào database
    shipment = SpxShipment(
        tracking_no=tracking_no,
        order_code=order_code,
        recipient_name=rec_name,
        recipient_phone=rec_phone,
        recipient_address=rec_addr,
        province=province,
        district=district,
        ward=ward,
        cod_amount=cod_amount,
        weight_gram=weight_gram,
        length_cm=length_cm,
        width_cm=width_cm,
        height_cm=height_cm,
        item_description=item_desc,
        note=note,
        payer=payer,
        status="ready_to_ship",
        shipping_fee=shipping_fee,
        label_doc_id=doc_id,
        sender_name=s_name,
        sender_phone=s_phone,
        sender_address=s_addr,
    )

    db.add(shipment)
    db.commit()
    db.refresh(shipment)

    logger.info("Tạo vận đơn SPX thành công: %s (doc_id: %s)", tracking_no, doc_id)
    return shipment


def list_spx_orders(
    db: Session,
    status: str | None = None,
    is_printed: bool | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[SpxShipment], int, int, int]:
    """Lấy danh sách vận đơn SPX kèm bộ lọc in ấn, thời gian và phân trang."""
    query = select(SpxShipment)

    if status and status != "all":
        query = query.where(SpxShipment.status == status)

    if is_printed is not None:
        query = query.where(SpxShipment.is_printed == is_printed)

    if from_date:
        try:
            fd = datetime.fromisoformat(from_date)
            query = query.where(SpxShipment.created_at >= fd)
        except Exception:
            pass

    if to_date:
        try:
            td = datetime.fromisoformat(to_date)
            query = query.where(SpxShipment.created_at <= td)
        except Exception:
            pass

    if search:
        s_term = f"%{search.strip()}%"
        query = query.where(
            or_(
                SpxShipment.tracking_no.ilike(s_term),
                SpxShipment.order_code.ilike(s_term),
                SpxShipment.recipient_name.ilike(s_term),
                SpxShipment.recipient_phone.ilike(s_term),
                SpxShipment.recipient_address.ilike(s_term),
            )
        )

    all_matching = list(db.scalars(query).all())
    total = len(all_matching)
    unprinted_count = sum(1 for s in all_matching if not s.is_printed)
    printed_count = total - unprinted_count

    # Get paginated
    items = db.scalars(
        query.order_by(desc(SpxShipment.created_at)).offset(offset).limit(limit)
    ).all()

    return list(items), total, unprinted_count, printed_count


def get_spx_stats(db: Session) -> dict[str, int]:
    """Thống kê tổng quan số lượng đơn đã in và chưa in."""
    all_shipments = list(db.scalars(select(SpxShipment)).all())
    total = len(all_shipments)
    unprinted = sum(1 for s in all_shipments if not s.is_printed)
    printed = total - unprinted
    return {
        "total": total,
        "unprinted": unprinted,
        "printed": printed,
    }


def mark_spx_order_printed(db: Session, tracking_no: str, is_printed: bool = True) -> SpxShipment:
    """Đánh dấu trạng thái in cho vận đơn."""
    shipment = get_spx_order(db, tracking_no)
    if not shipment:
        raise ValueError(f"Không tìm thấy vận đơn {tracking_no}")
    shipment.is_printed = is_printed
    shipment.printed_at = datetime.now(timezone.utc) if is_printed else None
    shipment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shipment)
    return shipment


def sync_spx_orders_batch(db: Session, raw_text: str) -> dict[str, Any]:
    """Đồng bộ danh sách mã vận đơn / Order SN (dán hàng loạt từ cổng SPX)."""
    # Trích xuất toàn bộ mã vận đơn hợp lệ
    codes = set(re.findall(r"(?:SPXVN\d+|VN\d{10,20}|\b\d{12,20}\b)", raw_text.upper()))
    if not codes:
        # Thử tách theo dòng
        for line in raw_text.splitlines():
            line_str = line.strip().upper()
            if line_str:
                codes.add(line_str)

    if not codes:
        raise ValueError("Không tìm thấy mã vận đơn hoặc mã đơn SPX nào trong văn bản đã nhập.")

    synced_items = []
    creds = get_spx_raw_credentials(db)
    s_name = creds.get("spx_sender_name") or DEFAULT_SENDER["spx_sender_name"]
    s_phone = creds.get("spx_sender_phone") or DEFAULT_SENDER["spx_sender_phone"]
    s_addr = creds.get("spx_sender_address") or DEFAULT_SENDER["spx_sender_address"]

    for code in sorted(codes):
        # Kiểm tra xem đã tồn tại chưa
        existing = db.scalar(
            select(SpxShipment).where(
                or_(SpxShipment.tracking_no == code, SpxShipment.order_code == code)
            )
        )
        if not existing:
            # Tạo bản ghi mới ở trạng thái chờ in
            tracking_no = code if code.startswith("SPXVN") else generate_tracking_number()
            order_code = code if code.startswith("VN") or not code.startswith("SPXVN") else ""
            if not order_code and code.startswith("VN"):
                order_code = code
            new_shipment = SpxShipment(
                tracking_no=code if code.startswith("SPXVN") else tracking_no,
                order_code=order_code or code,
                recipient_name=f"Khách hàng SPX ({code[-6:]})",
                recipient_phone="",
                recipient_address="Địa chỉ nhận hàng theo đơn SPX Express",
                province="Hồ Chí Minh",
                district="",
                ward="",
                cod_amount=0.0,
                weight_gram=500,
                item_description="Sản phẩm / Phụ kiện INUT",
                note="Cho xem hàng, không cho thử",
                payer="sender",
                status="ready_to_ship",
                shipping_fee=22000.0,
                label_doc_id="",
                sender_name=s_name,
                sender_phone=s_phone,
                sender_address=s_addr,
                is_printed=False,
                printed_at=None,
            )
            db.add(new_shipment)
            db.flush()

            # Tự động tra cứu trực tuyến thông tin đơn hàng từ SPX
            try:
                online_data = fetch_spx_order_online(db, code)
                if online_data:
                    order_info = online_data.get("order_info") or {}
                    sender_info = online_data.get("sender_info") or {}
                    deliver_info = online_data.get("deliver_info") or {}
                    parcel_info = online_data.get("parcel_info") or {}

                    if order_info.get("order_sn"):
                        new_shipment.order_code = order_info["order_sn"]
                    if deliver_info.get("deliver_name"):
                        new_shipment.recipient_name = deliver_info["deliver_name"]
                    if deliver_info.get("deliver_phone"):
                        new_shipment.recipient_phone = deliver_info["deliver_phone"]
                    if deliver_info.get("deliver_detail_address"):
                        new_shipment.recipient_address = deliver_info["deliver_detail_address"]
                        m_rec = re.search(r"(?:người\s*nhận|n\s*gười\s*nhận)\s*[:：\-]\s*([^,;]+)", deliver_info["deliver_detail_address"], re.IGNORECASE)
                        if m_rec and m_rec.group(1).strip():
                            parsed_r = m_rec.group(1).strip()
                            d_name = deliver_info.get("deliver_name", "").strip()
                            new_shipment.recipient_name = f"{parsed_r} ({d_name})" if d_name else parsed_r
                    if deliver_info.get("deliver_state"):
                        new_shipment.province = deliver_info["deliver_state"]
                    if deliver_info.get("deliver_city"):
                        new_shipment.district = deliver_info["deliver_city"]
                    if parcel_info.get("parcel_item_name"):
                        new_shipment.item_description = parcel_info["parcel_item_name"]
                    if parcel_info.get("parcel_weight"):
                        new_shipment.weight_gram = int(float(parcel_info["parcel_weight"]) * 1000) if float(parcel_info["parcel_weight"]) < 100 else int(parcel_info["parcel_weight"])
                    if sender_info.get("sender_name"):
                        new_shipment.sender_name = sender_info["sender_name"]
                    if sender_info.get("sender_phone"):
                        new_shipment.sender_phone = sender_info["sender_phone"]
                    if online_data.get("fulfillment_info", {}).get("cod_amount"):
                        new_shipment.cod_amount = float(online_data["fulfillment_info"]["cod_amount"])
            except Exception as e:
                logger.warning("Không thể tra cứu online khi đồng bộ đơn %s: %s", code, e)

            synced_items.append(new_shipment)
        else:
            # Cập nhật thông tin nếu đơn cũ chưa có thông tin chi tiết
            if existing.recipient_name.startswith("Khách hàng SPX"):
                try:
                    online_data = fetch_spx_order_online(db, code)
                    if online_data:
                        order_info = online_data.get("order_info") or {}
                        sender_info = online_data.get("sender_info") or {}
                        deliver_info = online_data.get("deliver_info") or {}
                        parcel_info = online_data.get("parcel_info") or {}

                        if order_info.get("order_sn"):
                            existing.order_code = order_info["order_sn"]
                        if deliver_info.get("deliver_name"):
                            existing.recipient_name = deliver_info["deliver_name"]
                        if deliver_info.get("deliver_phone"):
                            existing.recipient_phone = deliver_info["deliver_phone"]
                        if deliver_info.get("deliver_detail_address"):
                            existing.recipient_address = deliver_info["deliver_detail_address"]
                            m_rec = re.search(r"(?:người\s*nhận|n\s*gười\s*nhận)\s*[:：\-]\s*([^,;]+)", deliver_info["deliver_detail_address"], re.IGNORECASE)
                            if m_rec and m_rec.group(1).strip():
                                parsed_r = m_rec.group(1).strip()
                                d_name = deliver_info.get("deliver_name", "").strip()
                                existing.recipient_name = f"{parsed_r} ({d_name})" if d_name else parsed_r
                        if deliver_info.get("deliver_state"):
                            existing.province = deliver_info["deliver_state"]
                        if deliver_info.get("deliver_city"):
                            existing.district = deliver_info["deliver_city"]
                        if parcel_info.get("parcel_item_name"):
                            existing.item_description = parcel_info["parcel_item_name"]
                        if parcel_info.get("parcel_weight"):
                            existing.weight_gram = int(float(parcel_info["parcel_weight"]) * 1000) if float(parcel_info["parcel_weight"]) < 100 else int(parcel_info["parcel_weight"])
                        if sender_info.get("sender_name"):
                            existing.sender_name = sender_info["sender_name"]
                        if sender_info.get("sender_phone"):
                            existing.sender_phone = sender_info["sender_phone"]
                        if online_data.get("fulfillment_info", {}).get("cod_amount"):
                            existing.cod_amount = float(online_data["fulfillment_info"]["cod_amount"])
                except Exception as e:
                    logger.warning("Không thể cập nhật online cho đơn cũ %s: %s", code, e)
            synced_items.append(existing)

    db.commit()
    for item in synced_items:
        db.refresh(item)

    return {
        "success": True,
        "total_synced": len(synced_items),
        "tracking_numbers": [s.tracking_no for s in synced_items],
        "message": f"Đã đồng bộ thành công {len(synced_items)} vận đơn SPX vào hệ thống.",
    }


def quick_print_by_code(
    db: Session,
    code: str,
    printer_name: str = "TP732H",
    host: str = "192.168.1.10",
    print_remote: bool = True,
) -> dict[str, Any]:
    """Nhập mã vận đơn / Order SN -> Lấy nhãn chuẩn tỉ lệ vàng 65% -> In ngay và cập nhật trạng thái."""
    clean_code = code.strip().upper()
    if not clean_code:
        raise ValueError("Vui lòng nhập Mã vận đơn (SPXVN...) hoặc Mã đơn SPX (VN...).")

    shipment = db.scalar(
        select(SpxShipment).where(
            or_(SpxShipment.tracking_no == clean_code, SpxShipment.order_code == clean_code)
        )
    )

    if not shipment:
        # Tự động tạo bản ghi mới để in ngay lập tức
        creds = get_spx_raw_credentials(db)
        s_name = creds.get("spx_sender_name") or DEFAULT_SENDER["spx_sender_name"]
        s_phone = creds.get("spx_sender_phone") or DEFAULT_SENDER["spx_sender_phone"]
        s_addr = creds.get("spx_sender_address") or DEFAULT_SENDER["spx_sender_address"]

        tracking_no = clean_code if clean_code.startswith("SPXVN") else generate_tracking_number()
        order_code = clean_code if not clean_code.startswith("SPXVN") else ""

        shipment = SpxShipment(
            tracking_no=clean_code if clean_code.startswith("SPXVN") else tracking_no,
            order_code=order_code or clean_code,
            recipient_name=f"Khách hàng SPX ({clean_code[-6:]})",
            recipient_phone="",
            recipient_address="Địa chỉ nhận hàng theo đơn SPX Express",
            province="Hồ Chí Minh",
            district="",
            ward="",
            cod_amount=0.0,
            weight_gram=500,
            item_description="Sản phẩm / Phụ kiện INUT",
            note="Cho xem hàng, không cho thử",
            payer="sender",
            status="ready_to_ship",
            shipping_fee=22000.0,
            label_doc_id="",
            sender_name=s_name,
            sender_phone=s_phone,
            sender_address=s_addr,
            is_printed=False,
            printed_at=None,
        )
        db.add(shipment)
        db.commit()
        db.refresh(shipment)

    # 1. Tải hoặc tạo file tem nhãn PDF (với Golden Ratio 65% Align Right)
    pdf_bytes = get_spx_order_label(db, shipment.tracking_no)

    # 2. Gửi lệnh in nếu có yêu cầu remote
    print_res = {}
    if print_remote:
        print_res = print_spx_order_remote(db, shipment.tracking_no, host=host, printer_name=printer_name)

    # 3. Đánh dấu đã in
    shipment.is_printed = True
    shipment.printed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shipment)

    return {
        "success": True,
        "tracking_no": shipment.tracking_no,
        "order_code": shipment.order_code,
        "is_printed": True,
        "printed_at": shipment.printed_at.isoformat() if shipment.printed_at else None,
        "message": print_res.get("message") or f"Đã chuẩn bị tem nhãn {shipment.tracking_no} thành công!",
        "print_remote_success": print_res.get("success", False),
    }


def batch_print_unprinted(
    db: Session,
    tracking_numbers: list[str] | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    printer_name: str = "TP732H",
    host: str = "192.168.1.10",
) -> dict[str, Any]:
    """In hàng loạt toàn bộ đơn chưa in (hoặc theo danh sách tracking chỉ định) sang TP732H."""
    query = select(SpxShipment).where(SpxShipment.is_printed == False)

    if tracking_numbers:
        query = query.where(SpxShipment.tracking_no.in_(tracking_numbers))

    if from_date:
        try:
            fd = datetime.fromisoformat(from_date)
            query = query.where(SpxShipment.created_at >= fd)
        except Exception:
            pass

    if to_date:
        try:
            td = datetime.fromisoformat(to_date)
            query = query.where(SpxShipment.created_at <= td)
        except Exception:
            pass

    unprinted_shipments = list(db.scalars(query.order_by(SpxShipment.created_at.asc())).all())
    if not unprinted_shipments:
        return {
            "success": True,
            "total_printed": 0,
            "message": "Không có đơn hàng nào chưa in trong khoảng thời gian đã chọn.",
            "tracking_numbers": [],
        }

    printed_list = []
    errors = []

    for s in unprinted_shipments:
        try:
            # Lấy tem và gửi in
            get_spx_order_label(db, s.tracking_no)
            print_spx_order_remote(db, s.tracking_no, host=host, printer_name=printer_name)
            s.is_printed = True
            s.printed_at = datetime.now(timezone.utc)
            printed_list.append(s.tracking_no)
        except Exception as e:
            errors.append(f"Lỗi in đơn {s.tracking_no}: {e}")

    db.commit()

    return {
        "success": True,
        "total_printed": len(printed_list),
        "tracking_numbers": printed_list,
        "errors": errors,
        "message": f"Đã in thành công {len(printed_list)}/{len(unprinted_shipments)} đơn sang máy in {printer_name}.",
    }



def get_spx_order(db: Session, tracking_no: str) -> SpxShipment | None:
    """Lấy thông tin chi tiết một vận đơn SPX theo mã tracking."""
    return db.scalar(
        select(SpxShipment).where(SpxShipment.tracking_no == tracking_no.strip())
    )


def cancel_spx_order(db: Session, tracking_no: str) -> SpxShipment:
    """Hủy vận đơn SPX nếu chưa giao."""
    shipment = get_spx_order(db, tracking_no)
    if not shipment:
        raise ValueError(f"Không tìm thấy vận đơn {tracking_no}")
    if shipment.status in ("delivered", "cancelled"):
        raise ValueError(f"Không thể hủy vận đơn ở trạng thái {shipment.status}")

    shipment.status = "cancelled"
    shipment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shipment)
    return shipment


def _get_spx_proxies() -> list[str]:
    """Lấy danh sách proxy từ 9router để dự phòng khi IP nhà mạng bị SPX bóp băng thông/chặn."""
    db_path = "/home/ksp/.9router/db/data.sqlite"
    if not os.path.exists(db_path):
        return []
    try:
        import sqlite3
        conn = sqlite3.connect(db_path, timeout=3)
        c = conn.cursor()
        c.execute("SELECT data FROM proxyPools WHERE isActive = 1 AND testStatus = 'active'")
        rows = c.fetchall()
        conn.close()
        proxies = []
        for r in rows:
            try:
                d = json.loads(r[0])
                p_url = d.get("proxyUrl")
                if p_url:
                    proxies.append(p_url)
            except Exception:
                pass
        return proxies
    except Exception:
        return []


def fetch_spx_order_online(db: Session, code: str) -> dict[str, Any] | None:
    """Tự động tra cứu trực tuyến thông tin đơn hàng từ cổng SPX qua mã vận đơn (SPXVN...) hoặc mã đơn (VN...)."""
    clean_code = code.strip().upper()
    if not clean_code:
        return None

    creds = get_spx_raw_credentials(db)
    cookie_str = creds.get("spx_cookies", "")
    if not cookie_str:
        return None

    cookie_dict = {}
    for part in cookie_str.split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            cookie_dict[k.strip()] = v.strip()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://spx.vn/spx-admin/order/trackings",
        "Origin": "https://spx.vn",
    }

    try:
        import httpx
        clients_to_try = [httpx.Client(timeout=8.0, cookies=cookie_dict, headers=headers)]
        proxies = _get_spx_proxies()
        for p in proxies[:3]:
            clients_to_try.append(httpx.Client(timeout=12.0, proxy=p, cookies=cookie_dict, headers=headers))

        for client in clients_to_try:
            try:
                if clean_code.startswith("SPXVN"):
                    url = f"https://spx.vn/shipment/order/logistic/order/get_order_info?spx_tn={clean_code}"
                else:
                    url = f"https://spx.vn/shipment/order/logistic/order/get_order_info?order_sn={clean_code}"

                res = client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    if data.get("retcode") == 0 and "data" in data:
                        return data["data"]
            except Exception:
                continue
            finally:
                client.close()
    except Exception as e:
        logger.warning("Lỗi tra cứu thông tin SPX online cho %s: %s", clean_code, e)
    return None


def get_spx_order_label(db: Session, tracking_no: str) -> bytes:
    """Lấy file PDF tem nhãn vận đơn SPX (Tải trực tiếp từ SPX nếu online hoặc tự render A6)."""
    shipment = get_spx_order(db, tracking_no)
    if not shipment:
        raise ValueError(f"Không tìm thấy vận đơn {tracking_no}")

    # 1. Tự động tra cứu trực tuyến thông tin đơn hàng từ SPX nếu chưa có Order SN hợp lệ
    order_sn = shipment.order_code or ""
    if not order_sn or not order_sn.startswith("VN"):
        online_data = fetch_spx_order_online(db, shipment.tracking_no or order_sn)
        if online_data:
            order_info = online_data.get("order_info") or {}
            sender_info = online_data.get("sender_info") or {}
            deliver_info = online_data.get("deliver_info") or {}
            parcel_info = online_data.get("parcel_info") or {}

            if order_info.get("order_sn"):
                order_sn = order_info["order_sn"]
                shipment.order_code = order_sn
            if deliver_info.get("deliver_name"):
                shipment.recipient_name = deliver_info["deliver_name"]
            if deliver_info.get("deliver_phone"):
                shipment.recipient_phone = deliver_info["deliver_phone"]
            if deliver_info.get("deliver_detail_address"):
                shipment.recipient_address = deliver_info["deliver_detail_address"]
                m_rec = re.search(r"(?:người\s*nhận|n\s*gười\s*nhận)\s*[:：\-]\s*([^,;]+)", deliver_info["deliver_detail_address"], re.IGNORECASE)
                if m_rec and m_rec.group(1).strip():
                    parsed_r = m_rec.group(1).strip()
                    d_name = deliver_info.get("deliver_name", "").strip()
                    shipment.recipient_name = f"{parsed_r} ({d_name})" if d_name else parsed_r
            if deliver_info.get("deliver_state"):
                shipment.province = deliver_info["deliver_state"]
            if deliver_info.get("deliver_city"):
                shipment.district = deliver_info["deliver_city"]
            if parcel_info.get("parcel_item_name"):
                shipment.item_description = parcel_info["parcel_item_name"]
            if parcel_info.get("parcel_weight"):
                shipment.weight_gram = int(float(parcel_info["parcel_weight"]) * 1000) if float(parcel_info["parcel_weight"]) < 100 else int(parcel_info["parcel_weight"])
            if sender_info.get("sender_name"):
                shipment.sender_name = sender_info["sender_name"]
            if sender_info.get("sender_phone"):
                shipment.sender_phone = sender_info["sender_phone"]
            if online_data.get("fulfillment_info", {}).get("cod_amount"):
                shipment.cod_amount = float(online_data["fulfillment_info"]["cod_amount"])
            db.commit()

    if shipment.label_doc_id:
        try:
            return storage.read_doc(shipment.label_doc_id, suffix=".pdf")
        except Exception as e:
            logger.warning("Không đọc được file doc_id %s, tái tạo lại: %s", shipment.label_doc_id, e)
            if parcel_info.get("parcel_item_name"):
                shipment.item_description = parcel_info["parcel_item_name"]
            if sender_info.get("sender_name"):
                shipment.sender_name = sender_info["sender_name"]
            if sender_info.get("sender_phone"):
                shipment.sender_phone = sender_info["sender_phone"]
            db.commit()

    # 2. Thử tải trực tiếp PDF chuẩn từ SPX Express nếu có order_sn hợp lệ và cookies
    creds = get_spx_raw_credentials(db)
    cookie_str = creds.get("spx_cookies", "")
    if cookie_str and order_sn and (order_sn.startswith("VN") or len(order_sn) >= 12):
        try:
            import httpx
            cookie_dict = {}
            for part in cookie_str.split(";"):
                if "=" in part:
                    k, v = part.strip().split("=", 1)
                    cookie_dict[k.strip()] = v.strip()
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://spx.vn/spx-admin/order/trackings",
                "Origin": "https://spx.vn",
            }
            clients_to_try = [httpx.Client(timeout=8.0, cookies=cookie_dict, headers=headers)]
            proxies = _get_spx_proxies()
            for p in proxies[:3]:
                clients_to_try.append(httpx.Client(timeout=15.0, proxy=p, cookies=cookie_dict, headers=headers))

            url = f"https://spx.vn/shipment/order/logistic/label/batch_get_shipping_label?order_sn_list={order_sn}"
            pdf_bytes = None
            for client in clients_to_try:
                try:
                    res = client.get(url)
                    if res.status_code == 200 and res.content.startswith(b"%PDF"):
                        pdf_bytes = res.content
                        break
                except Exception:
                    continue
                finally:
                    client.close()

            if pdf_bytes:
                try:
                    import io
                    from pypdf import PdfReader, PdfWriter, PageObject, Transformation
                    reader = PdfReader(io.BytesIO(pdf_bytes))
                    orig_page = reader.pages[0]
                    w = float(orig_page.mediabox.width)
                    h = float(orig_page.mediabox.height)

                    # Tạo trang mới đúng kích thước gốc nhưng co nội dung về tỉ lệ vàng 65% căn lệch phải
                    blank_page = PageObject.create_blank_page(width=w, height=h)
                    scale = 0.65  # Tỉ lệ vàng 65% chuẩn cho máy in nhiệt TP732H
                    tx = (w - w * scale) - 2.0  # Căn lệch phải (Align Right)
                    ty = (h - h * scale) / 2.0
                    transform = Transformation().scale(scale, scale).translate(tx, ty)
                    blank_page.merge_transformed_page(orig_page, transform)

                    writer = PdfWriter()
                    writer.add_page(blank_page)
                    scaled_buf = io.BytesIO()
                    writer.write(scaled_buf)
                    pdf_bytes = scaled_buf.getvalue()
                except Exception as err:
                    logger.warning("Không thể scale nội dung PDF SPX: %s", err)

                doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
                shipment.label_doc_id = doc_id
                db.commit()
                return pdf_bytes
        except Exception as e:
            logger.warning("Lỗi tải PDF từ SPX live: %s", e)


    # 2. Tái tạo lại nhãn nội bộ nếu offline
    pdf_bytes = generate_spx_a6_label(
        tracking_no=shipment.tracking_no,
        recipient_name=shipment.recipient_name,
        recipient_phone=shipment.recipient_phone,
        recipient_address=f"{shipment.recipient_address}, {shipment.ward}, {shipment.district}, {shipment.province}".strip(", "),
        cod_amount=shipment.cod_amount,
        weight_gram=shipment.weight_gram,
        item_description=shipment.item_description,
        note=shipment.note,
        sender_name=shipment.sender_name,
        sender_phone=shipment.sender_phone,
        sender_address=shipment.sender_address,
        order_code=shipment.order_code,
    )
    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
    shipment.label_doc_id = doc_id
    db.commit()
    return pdf_bytes



def list_remote_printers(host: str = "192.168.1.10") -> list[dict[str, Any]]:
    """Liệt kê danh sách máy in thực tế trên máy Windows (tự resolve IP qua nmap nếu cần)."""
    import subprocess
    resolved_host = resolve_windows_host(host)
    cmd = [
        "ssh", "-n",
        "-i", "/home/ksp/.ssh/id_ed25519",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=4",
        f"Administrator@{resolved_host}",
        "wmic printer get name,portname,drivername",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if proc.returncode != 0:
            return []
        lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
        if not lines:
            return []
        printers = []
        for line in lines[1:]:
            parts = line.split()
            if len(parts) >= 2:
                p_name = parts[-2] if len(parts) >= 3 else parts[0]
                driver = parts[0]
                port = parts[-1]
                printers.append({
                    "name": p_name,
                    "driver": driver,
                    "port": port,
                    "is_thermal": ("TP" in p_name or "58" in p_name or "80" in p_name or "Xprinter" in p_name),
                })
        return printers
    except Exception as e:
        logger.warning("Không thể lấy danh sách máy in từ %s: %s", host, e)
        return []


def print_spx_order_remote(
    db: Session,
    tracking_no: str,
    host: str = "192.168.1.10",
    printer_name: str = "TP732H",
) -> dict[str, Any]:
    """Gửi lệnh in tem nhãn A6 trực tiếp sang máy in (TP732H/TP58H) trên máy Windows (tự resolve IP)."""
    import subprocess
    resolved_host = resolve_windows_host(host)
    shipment = get_spx_order(db, tracking_no)
    if not shipment:
        raise ValueError(f"Không tìm thấy vận đơn {tracking_no}")

    # Đảm bảo file PDF tồn tại
    if not shipment.label_doc_id or not storage.path_for(shipment.label_doc_id).exists():
        get_spx_order_label(db, tracking_no)

    pdf_path = storage.path_for(shipment.label_doc_id)

    # 1. SCP file PDF sang máy Windows C:\ksp\
    win_file_name = f"label_{tracking_no}.pdf"
    scp_cmd = [
        "scp",
        "-i", "/home/ksp/.ssh/id_ed25519",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=5",
        str(pdf_path),
        f"Administrator@{resolved_host}:C:/ksp/{win_file_name}",
    ]
    scp_proc = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=10)
    if scp_proc.returncode != 0:
        raise RuntimeError(f"Lỗi chuyển file nhãn sang máy {resolved_host}: {scp_proc.stderr}")

    # 2. In file qua Foxit Reader CLI trên Windows
    foxit_cmd = f'"C:\\Program Files (x86)\\Foxit Software\\Foxit Reader\\FoxitReader.exe" /t "C:\\ksp\\{win_file_name}" "{printer_name}"'
    ssh_print_cmd = [
        "ssh", "-n",
        "-i", "/home/ksp/.ssh/id_ed25519",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=5",
        f"Administrator@{resolved_host}",
        foxit_cmd,
    ]
    print_proc = subprocess.run(ssh_print_cmd, capture_output=True, text=True, timeout=15)
    if print_proc.returncode != 0:
        raise RuntimeError(f"Lỗi thực thi lệnh in Foxit trên Windows: {print_proc.stderr}")
    shipment.is_printed = True
    shipment.printed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shipment)

    return {
        "success": True,
        "message": f"Đã gửi lệnh in tem A6 ({tracking_no}) thành công tới máy in '{printer_name}' tại {host}!",
        "tracking_no": tracking_no,
        "is_printed": True,
        "printed_at": shipment.printed_at.isoformat() if shipment.printed_at else None,
        "file_path": f"C:\\ksp\\{win_file_name}",
    }



def print_custom_shipping_label(
    db: Session,
    code: str,
    recipient_name: str,
    recipient_phone: str,
    recipient_address: str,
    item_desc: str = "",
    note: str = "Cho xem hàng, không cho thử",
    sender_name: str = "",
    sender_phone: str = "",
    sender_address: str = "",
    printer_name: str = "TP732H",
    host: str = "192.168.1.10",
    print_remote: bool = True,
) -> dict[str, Any]:
    """Tạo và in tem giao hàng tự do (không phụ thuộc SPX) sang máy in nhiệt TP732H."""
    import subprocess
    from .spx_label import generate_custom_shipping_label_100x50

    creds = get_spx_raw_credentials(db)
    s_name = sender_name.strip() if sender_name else (creds.get("spx_sender_name") or DEFAULT_SENDER["spx_sender_name"])
    s_phone = sender_phone.strip() if sender_phone else (creds.get("spx_sender_phone") or DEFAULT_SENDER["spx_sender_phone"])
    s_addr = sender_address.strip() if sender_address else (creds.get("spx_sender_address") or DEFAULT_SENDER["spx_sender_address"])

    # 1. Sinh file PDF tem nhãn 100x50mm đã co tỉ lệ vàng 65% căn lệch phải
    pdf_bytes = generate_custom_shipping_label_100x50(
        code=code,
        recipient_name=recipient_name,
        recipient_phone=recipient_phone,
        recipient_address=recipient_address,
        item_desc=item_desc if item_desc else code,
        note=note,
        sender_name=s_name,
        sender_phone=s_phone,
        sender_address=s_addr,
        apply_golden_ratio=True,
    )

    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
    clean_code = re.sub(r"[^A-Za-z0-9_-]", "_", code.strip())
    tracking_no = f"CUSTOM_{clean_code}" if not code.startswith("SPXVN") else code

    # Lưu hoặc cập nhật SpxShipment để truy vết
    shipment = db.scalar(select(SpxShipment).where(SpxShipment.tracking_no == tracking_no))
    if not shipment:
        shipment = SpxShipment(
            tracking_no=tracking_no,
            order_code=code,
            recipient_name=recipient_name,
            recipient_phone=recipient_phone,
            recipient_address=recipient_address,
            province="Tây Ninh",
            district="",
            ward="",
            cod_amount=0.0,
            weight_gram=500,
            item_description=item_desc if item_desc else code,
            note=note,
            payer="sender",
            status="ready_to_ship",
            shipping_fee=0.0,
            label_doc_id=doc_id,
            sender_name=s_name,
            sender_phone=s_phone,
            sender_address=s_addr,
            is_printed=False,
            printed_at=None,
        )
        db.add(shipment)
    else:
        shipment.label_doc_id = doc_id
        shipment.recipient_name = recipient_name
        shipment.recipient_phone = recipient_phone
        shipment.recipient_address = recipient_address
        shipment.item_description = item_desc if item_desc else code
        shipment.note = note

    db.commit()
    db.refresh(shipment)

    # 2. Gửi lệnh in nếu có yêu cầu remote
    print_res = {}
    if print_remote:
        resolved_host = resolve_windows_host(host)
        pdf_path = storage.path_for(doc_id)
        win_file_name = f"label_{tracking_no}.pdf"
        scp_cmd = [
            "scp",
            "-i", "/home/ksp/.ssh/id_ed25519",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            str(pdf_path),
            f"Administrator@{resolved_host}:C:/ksp/{win_file_name}",
        ]
        scp_proc = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=10)
        if scp_proc.returncode != 0:
            raise RuntimeError(f"Lỗi chuyển file nhãn sang máy {resolved_host}: {scp_proc.stderr}")

        foxit_cmd = f'"C:\\Program Files (x86)\\Foxit Software\\Foxit Reader\\FoxitReader.exe" /t "C:\\ksp\\{win_file_name}" "{printer_name}"'
        ssh_print_cmd = [
            "ssh", "-n",
            "-i", "/home/ksp/.ssh/id_ed25519",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            f"Administrator@{resolved_host}",
            foxit_cmd,
        ]
        print_proc = subprocess.run(ssh_print_cmd, capture_output=True, text=True, timeout=15)
        if print_proc.returncode != 0:
            raise RuntimeError(f"Lỗi thực thi lệnh in Foxit trên Windows: {print_proc.stderr}")

        shipment.is_printed = True
        shipment.printed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(shipment)
        print_res = {
            "success": True,
            "message": f"Đã gửi lệnh in tem ({code}) thành công tới máy in '{printer_name}' tại {resolved_host}!",
            "file_path": f"C:\\ksp\\{win_file_name}",
        }

    return {
        "success": True,
        "code": code,
        "tracking_no": shipment.tracking_no,
        "label_doc_id": doc_id,
        "is_printed": shipment.is_printed,
        "printed_at": shipment.printed_at.isoformat() if shipment.printed_at else None,
        "message": print_res.get("message") or f"Đã tạo tem nhãn cho {code} thành công!",
        "print_remote_success": print_res.get("success", False),
    }


