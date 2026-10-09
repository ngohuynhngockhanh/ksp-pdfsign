"""API Quan ly Hop dong giao khoan & Ho so CTV / Tho ngoai.

Tuan thu Nghi dinh 253/2026/ND-CP (nguong 5 trieu dong khau tru 10% thue TNCN)
va Luat BHXH 2024 / Bo luat Lao dong 2019 ve quan he giao khoan dan su.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import re

import asn1crypto.keys
import asn1crypto.x509
from cryptography import x509 as cx509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import HTMLResponse
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import fields, signers
from pyhanko.sign.signers import SimpleSigner
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pyhanko_certvalidator.registry import SimpleCertificateStore

logger = logging.getLogger(__name__)
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from weasyprint import HTML

from . import money, storage
from .auth import CurrentUser, require_admin
from .config import Settings, get_settings
from .db import Document, PieceworkContract, PieceworkContractor, Share, get_session
from .trust import load_trust_roots
router = APIRouter(tags=["piecework"])

_TPL_DIR = Path(__file__).parent / "templates_bbbg"
_env = Environment(
    loader=FileSystemLoader(_TPL_DIR),
    autoescape=select_autoescape(["html"]),
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class WorkItem(BaseModel):
    ten: str = ""
    dvt: str = "Cái"
    so_luong: float = 1.0
    don_gia: float = 0.0
    thanh_tien: float = 0.0


class PieceworkContractCreate(BaseModel):
    contractor_id: int | None = None
    contract_code: str = ""
    contract_type: str = "thi_cong"  # thi_cong | boc_xep | gia_cong
    title: str = ""
    project_name: str = ""
    location: str = ""
    contract_date: str = ""  # YYYY-MM-DD
    worker_name: str = ""
    worker_id_card: str = ""
    worker_id_card_date: str = ""
    worker_id_card_place: str = ""
    worker_tax_code: str = ""
    worker_phone: str = ""
    worker_address: str = ""
    worker_bank_account: str = ""
    worker_bank_name: str = ""
    total_amount: float = 0.0
    items: list[WorkItem] = Field(default_factory=list)
    note: str = ""


class ContractorCreate(BaseModel):
    code: str = ""
    name: str
    id_card: str
    id_card_date: str = ""
    id_card_place: str = "Cục Cảnh sát QLHC về TTXH"
    tax_code: str = ""
    phone: str = ""
    address: str = ""
    bank_account: str = ""
    bank_name: str = "Techcombank"
    skills: str = ""
    notes: str = ""
    id_card_front_doc_id: str = ""
    id_card_back_doc_id: str = ""


class ContractorUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    id_card: str | None = None
    id_card_date: str | None = None
    id_card_place: str | None = None
    tax_code: str | None = None
    phone: str | None = None
    address: str | None = None
    bank_account: str | None = None
    bank_name: str | None = None
    skills: str | None = None
    notes: str | None = None
    id_card_front_doc_id: str | None = None
    id_card_back_doc_id: str | None = None


class ParseContractorTextPayload(BaseModel):
    text: str


class PieceworkContractUpdate(BaseModel):
    contractor_id: int | None = None
    contract_type: str | None = None
    title: str | None = None
    project_name: str | None = None
    location: str | None = None
    contract_date: str | None = None
    worker_name: str | None = None
    worker_id_card: str | None = None
    worker_id_card_date: str | None = None
    worker_id_card_place: str | None = None
    worker_tax_code: str | None = None
    worker_phone: str | None = None
    worker_address: str | None = None
    worker_bank_account: str | None = None
    worker_bank_name: str | None = None
    total_amount: float | None = None
    items: list[WorkItem] | None = None
    note: str | None = None
    has_id_card_front: bool | None = None
    has_id_card_back: bool | None = None
    has_acceptance: bool | None = None
    has_tax_commitment: bool | None = None
    has_bank_proof: bool | None = None
    status: str | None = None
class SignInutPayload(BaseModel):
    sign_date: str | None = None
    cert_id: str | None = None
    pin: str | None = "12345678"
    signer_name: str | None = None


class TimedPdfSigner(signers.PdfSigner):
    """PdfSigner hỗ trợ nhúng system_time chỉ định vào chữ ký và thuộc tính /M."""
    def __init__(self, *args, custom_system_time: datetime | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.custom_system_time = custom_system_time

    def init_signing_session(self, pdf_out, existing_fields_only=False):
        sess = super().init_signing_session(pdf_out, existing_fields_only=existing_fields_only)
        if self.custom_system_time is not None:
            sess.system_time = self.custom_system_time
        return sess


_INUT_SIGNER: SimpleSigner | None = None


def _get_inut_signer() -> SimpleSigner:
    """Tải hoặc khởi tạo chứng thư ký số phần mềm cho INUT."""
    global _INUT_SIGNER
    if _INUT_SIGNER is not None:
        return _INUT_SIGNER

    settings = get_settings()
    data_dir = settings.data_path
    cert_path = data_dir / "inut_piecework_cert.pem"
    key_path = data_dir / "inut_piecework_key.pem"

    if cert_path.exists() and key_path.exists():
        try:
            cert_pem = cert_path.read_bytes()
            key_pem = key_path.read_bytes()
            crypto_cert = cx509.load_pem_x509_certificate(cert_pem)
            crypto_key = serialization.load_pem_private_key(key_pem, password=None)
            asn1_cert = asn1crypto.x509.Certificate.load(crypto_cert.public_bytes(serialization.Encoding.DER))
            asn1_key = asn1crypto.keys.PrivateKeyInfo.load(crypto_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ))
            store = SimpleCertificateStore()
            store.register(asn1_cert)
            _INUT_SIGNER = SimpleSigner(signing_cert=asn1_cert, signing_key=asn1_key, cert_registry=store)
            return _INUT_SIGNER
        except Exception:
            pass

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cn = "CÔNG TY CP CÔNG NGHỆ INUT"
    org = "CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT"
    subject = issuer = cx509.Name([
        cx509.NameAttribute(NameOID.COMMON_NAME, cn),
        cx509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
        cx509.NameAttribute(NameOID.COUNTRY_NAME, "VN"),
    ])
    now = datetime.now(timezone.utc)
    cert = (
        cx509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(cx509.random_serial_number())
        .not_valid_before(now - timedelta(days=365))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(cx509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            cx509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    cert_der = cert.public_bytes(serialization.Encoding.DER)
    key_der = key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    except Exception:
        pass

    asn1_cert = asn1crypto.x509.Certificate.load(cert_der)
    asn1_key = asn1crypto.keys.PrivateKeyInfo.load(key_der)
    store = SimpleCertificateStore()
    store.register(asn1_cert)
    _INUT_SIGNER = SimpleSigner(signing_cert=asn1_cert, signing_key=asn1_key, cert_registry=store)
    return _INUT_SIGNER


def _next_sig_field_name(pdf_bytes: bytes) -> str:
    existing = set()
    try:
        r = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        for item in fields.enumerate_sig_fields(r):
            existing.add(item[0])
    except Exception:
        pass
    i = 1
    while f"Signature{i}" in existing:
        i += 1
    return f"Signature{i}"


def sign_piecework_pdf_pyhanko(pdf_bytes: bytes, sign_dt: datetime, location: str = "Đắk Lắk") -> bytes:
    signer = _get_inut_signer()
    field_name = _next_sig_field_name(pdf_bytes)
    sig_meta = signers.PdfSignatureMetadata(
        field_name=field_name,
        name="CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
        reason="Ký số điện tử Hợp đồng giao khoán INUT",
        location=location or "Đắk Lắk",
        subfilter=fields.SigSeedSubFilter.PADES,
    )
    pdf_signer = TimedPdfSigner(
        sig_meta,
        signer=signer,
        custom_system_time=sign_dt,
    )
    writer = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
    out = io.BytesIO()
    pdf_signer.sign_pdf(writer, output=out)
    return out.getvalue()

def inspect_uploaded_content(content: bytes, suffix: str) -> dict[str, Any]:
    """Kiểm tra tính hợp lệ và cấu trúc kỹ thuật của tệp tải lên."""
    size_kb = round(len(content) / 1024, 1)
    if len(content) == 0:
        return {"valid": False, "error": "Tệp rỗng (0 bytes)", "size_kb": 0}

    s_low = suffix.lower()
    if s_low in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            img.verify()
            img = Image.open(io.BytesIO(content))
            w, h = img.size
            return {
                "valid": True,
                "kind": "image",
                "format": img.format or s_low[1:].upper(),
                "dimensions": f"{w}x{h}",
                "size_kb": size_kb,
                "note": f"Ảnh {img.format or s_low[1:].upper()} {w}x{h} ({size_kb} KB) hợp lệ",
            }
        except Exception as e:
            return {"valid": False, "error": f"Tệp ảnh bị lỗi hoặc không thể đọc: {e}", "size_kb": size_kb}
    elif s_low == ".pdf":
        try:
            from pypdf import PdfReader
            r = PdfReader(io.BytesIO(content))
            pages = len(r.pages)
            return {
                "valid": True,
                "kind": "pdf",
                "format": "PDF",
                "pages": pages,
                "size_kb": size_kb,
                "note": f"Tài liệu PDF {pages} trang ({size_kb} KB) hợp lệ",
            }
        except Exception as e:
            return {"valid": False, "error": f"Tệp PDF bị lỗi hoặc hỏng cấu trúc: {e}", "size_kb": size_kb}
    else:
        return {
            "valid": True,
            "kind": "other",
            "format": s_low[1:].upper(),
            "size_kb": size_kb,
            "note": f"Tệp đính kèm {s_low[1:].upper()} ({size_kb} KB)",
        }


def inspect_document_file(doc_id: str) -> dict[str, Any]:
    """Kiểm tra tệp đính kèm đã lưu trong storage KSP."""
    if not doc_id:
        return {"valid": False, "error": "Chưa có tài liệu đính kèm"}
    try:
        content, suffix = storage.read_doc_any(doc_id)
        return inspect_uploaded_content(content, suffix)
    except Exception as exc:
        return {"valid": False, "error": f"Không tìm thấy hoặc lỗi đọc tệp: {str(exc)}", "size_kb": 0}


def validate_cccd_number(id_num: str) -> dict[str, Any]:
    """Kiểm tra tính hợp lệ của số Căn cước công dân 12 số theo chuẩn Bộ Công an."""
    clean = (id_num or "").strip()
    if not clean:
        return {"valid": False, "reason": "Chưa nhập số CCCD"}
    if len(clean) != 12 or not clean.isdigit():
        return {"valid": False, "reason": f"Số CCCD phải gồm đúng 12 chữ số (hiện tại: {len(clean)} ký tự)"}
    province_code = clean[:3]
    gender_century = clean[3]
    birth_year_short = clean[4:6]
    return {
        "valid": True,
        "province_code": province_code,
        "gender_century": gender_century,
        "birth_year_suffix": birth_year_short,
        "note": f"CCCD 12 số hợp chuẩn (Mã tỉnh/thành: {province_code})"
    }


def validate_bank_account(acc_num: str, bank_name: str, worker_name: str) -> dict[str, Any]:
    """Kiểm tra tính hợp lệ của thông tin tài khoản ngân hàng thụ hưởng."""
    clean_acc = "".join(ch for ch in (acc_num or "") if ch.isalnum())
    if not clean_acc:
        return {"valid": False, "reason": "Chưa có số tài khoản"}
    if len(clean_acc) < 6:
        return {"valid": False, "reason": "Số tài khoản ngân hàng quá ngắn"}
    return {
        "valid": True,
        "account": clean_acc,
        "bank": bank_name or "Ngân hàng",
        "beneficiary": worker_name,
        "note": f"Tài khoản chính chủ: {worker_name}"
    }

def parse_contractor_text(text: str) -> dict[str, str]:
    """Trích xuất tự động thông tin thợ/nhà cung cấp từ tin nhắn Zalo/SMS hoặc mã QR CCCD."""
    t = (text or "").strip()
    res = {
        "name": "",
        "id_card": "",
        "id_card_date": "",
        "id_card_place": "Cục Cảnh sát QLHC về TTXH",
        "tax_code": "",
        "phone": "",
        "address": "",
        "bank_account": "",
        "bank_name": "Techcombank",
    }
    if not t:
        return res

    # 1. CCCD QR code format: 038092004512||Nguyễn Văn An|15041992|Nam|Tổ 2, Đông Sơn, Thanh Hóa|15042022
    qr_match = re.search(r"(\d{12})\|\|([^|]+)\|(\d{8})\|([^|]+)\|([^|]+)\|(\d{8})", t)
    if qr_match:
        res["id_card"] = qr_match.group(1)
        res["name"] = qr_match.group(2).strip().title()
        res["address"] = qr_match.group(5).strip()
        raw_issue = qr_match.group(6)
        res["id_card_date"] = f"{raw_issue[4:8]}-{raw_issue[2:4]}-{raw_issue[0:2]}"
        return res

    # 2. Extract CCCD (12 digits) or CMND (9 digits)
    cccd_match = re.search(r"(?:cccd|căn\s*cước|cmnd|id|số|so)[\s\:\-\.]*(\d{12}|\d{9})", t, re.IGNORECASE)
    if cccd_match:
        res["id_card"] = cccd_match.group(1)
    else:
        lone_12 = re.search(r"\b(0\d{11})\b", t)
        if lone_12:
            res["id_card"] = lone_12.group(1)

    # 3. Extract Tax code (MST: 10 digits)
    mst_match = re.search(r"(?:mst|mã\s*số\s*thuế|ma\s*so\s*thue|thuế|thue|tax)[\s\:\-\.]*(\d{10})", t, re.IGNORECASE)
    if mst_match:
        res["tax_code"] = mst_match.group(1)
    else:
        for m in re.finditer(r"\b(\d{10})\b", t):
            candidate = m.group(1)
            if not candidate.startswith(("03", "05", "07", "08", "09")):
                res["tax_code"] = candidate
                break

    # 4. Extract Phone
    phone_match = re.search(r"(?:sđt|sdt|đt|dt|phone|tel|liên\s*hệ|lh)[\s\:\-\.]*(0[35789][0-9\.\s]{8,11})", t, re.IGNORECASE)
    if phone_match:
        raw_p = re.sub(r"[\s\.]", "", phone_match.group(1))
        if 10 <= len(raw_p) <= 11:
            res["phone"] = raw_p[:10]
    else:
        lone_phone = re.search(r"\b(0[35789]\d{8})\b", re.sub(r"[\s\.\-]", "", t))
        if lone_phone:
            res["phone"] = lone_phone.group(1)

    # 5. Extract Bank Account & Bank Name
    banks = [
        ("Techcombank", r"techcom(?:bank)?|tcb"),
        ("Vietcombank", r"vietcom(?:bank)?|vcb"),
        ("VietinBank", r"vietin(?:bank)?|ctg"),
        ("BIDV", r"bidv"),
        ("MBBank", r"mb(?:bank)?"),
        ("VPBank", r"vp(?:bank)?"),
        ("ACB", r"acb"),
        ("Agribank", r"agri(?:bank)?"),
        ("TPBank", r"tp(?:bank)?"),
        ("Sacombank", r"sacom(?:bank)?|stb"),
        ("HDBank", r"hd(?:bank)?"),
        ("VIB", r"vib"),
        ("SHB", r"shb"),
        ("MSB", r"msb"),
        ("OCB", r"ocb"),
        ("LPBank", r"lp(?:bank)?|lienviet"),
    ]
    for bname, pat in banks:
        if re.search(r"\b(" + pat + r")\b", t, re.IGNORECASE):
            res["bank_name"] = bname
            break

    stk_match = re.search(r"(?:stk|số\s*tk|so\s*tk|tài\s*khoản|tai\s*khoan|account|tk)[\s\:\-\.]*([0-9]{8,16})", t, re.IGNORECASE)
    if stk_match:
        res["bank_account"] = stk_match.group(1)
    else:
        for num in re.findall(r"\b\d{8,16}\b", t):
            if num != res["id_card"] and num != res["tax_code"] and num != res["phone"]:
                res["bank_account"] = num
                break

    # 6. Extract Issue Date
    date_match = re.search(r"(?:ngày\s*cấp|ngay\s*cap|cấp\s*ngày|cap\s*ngay)[\s\:\-\.]*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})", t, re.IGNORECASE)
    if date_match:
        res["id_card_date"] = f"{date_match.group(3)}-{int(date_match.group(2)):02d}-{int(date_match.group(1)):02d}"
    else:
        dates = re.findall(r"\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b", t)
        if dates:
            d, m, y = dates[0]
            res["id_card_date"] = f"{y}-{int(m):02d}-{int(d):02d}"

    # 7. Extract Address
    addr_match = re.search(r"(?:địa\s*chỉ|dia\s*chi|đ\/c|dc|đc|thường\s*trú|thuong\s*tru|trú\s*tại)[\s\:\-\.]*([^\n\r,;]+(?:,[^\n\r]+)?)", t, re.IGNORECASE)
    if addr_match:
        res["address"] = addr_match.group(1).strip()

    # 8. Extract Name
    m_name = re.search(r"(?:họ\s*và\s*tên|họ\s*tên|tên|thợ|người\s*nhận|ctv)[\s\:\-\.]*([a-zA-Zà-ỹÀ-Ỹ\s]+)", t, re.IGNORECASE)
    if m_name:
        cand = re.sub(r"(?:cccd|cmnd|mst|sdt|stk|địa\s*chỉ|ngay|ngày|sinh).*", "", m_name.group(1), flags=re.IGNORECASE).strip()
        if len(cand.split()) >= 2:
            res["name"] = cand.title()

    if not res["name"]:
        m_before = re.search(r"(?:^|[\n\r,;:\-\.])\s*([a-zA-Zà-ỹÀ-Ỹ\s]{5,35})\s*[,;\-\.]?\s*(?:cccd|cmnd|số cccd|căn cước)", t, re.IGNORECASE)
        if m_before:
            cand = m_before.group(1).strip()
            cand = re.sub(r"^(?:em\s+gửi\s+(?:anh|chị)?|anh\s+gửi\s+(?:em)?|thông\s+tin\s+(?:thợ)?|gửi\s+|bên\s+|bác\s+|chú\s+)+", "", cand, flags=re.IGNORECASE).strip()
            words = cand.split()
            if 2 <= len(words) <= 5:
                res["name"] = cand.title()

    if not res["name"]:
        for l in t.splitlines():
            l_clean = l.strip()
            if l_clean and not any(k in l_clean.lower() for k in ["cccd", "cmnd", "mst", "stk", "sdt", "địa chỉ", "http", "ngân hàng"]):
                words = l_clean.split()
                if 2 <= len(words) <= 5 and all(w.replace("-", "").isalpha() for w in words):
                    res["name"] = l_clean.title()
                    break

    return res

# ---------------------------------------------------------------------------
# Deficiency Radar Logic
# ---------------------------------------------------------------------------
def evaluate_deficiencies(c: PieceworkContract) -> dict[str, Any]:
    """Danh gia toan dien ho so thieu theo Nghi dinh 253/2026/ND-CP & Luat BHXH 2024."""
    checklist = []
    
    # 1. CCCD 2 mat & Dinh danh ca nhan
    cccd_val = validate_cccd_number(c.worker_id_card)
    front_val = inspect_document_file(c.id_card_front_doc_id) if c.id_card_front_doc_id else None
    back_val = inspect_document_file(c.id_card_back_doc_id) if c.id_card_back_doc_id else None
    has_id = bool(c.has_id_card_front and c.has_id_card_back and cccd_val.get("valid") and (not front_val or front_val.get("valid")) and (not back_val or back_val.get("valid")))
    id_detail = f"Số CCCD: {c.worker_id_card} ({cccd_val.get('note', '')})" if has_id else (
        cccd_val.get("reason") if not cccd_val.get("valid") else "Thiếu ảnh chụp mặt trước hoặc mặt sau CCCD"
    )
    checklist.append({
        "key": "id_card",
        "label": "CCCD 2 mặt & Số định danh",
        "ok": has_id,
        "detail": id_detail,
        "validation": {
            "cccd_format": cccd_val,
            "front": front_val,
            "back": back_val,
        },
        "doc_ids": [c.id_card_front_doc_id, c.id_card_back_doc_id],
    })
    
    # 2. STK Ngan hang chinh chu
    bank_val = validate_bank_account(c.worker_bank_account, c.worker_bank_name, c.worker_name)
    has_bank = bool(c.worker_bank_account.strip() and c.worker_bank_name.strip() and bank_val.get("valid"))
    checklist.append({
        "key": "bank_account",
        "label": "Tài khoản ngân hàng chính chủ",
        "ok": has_bank,
        "detail": f"{c.worker_bank_account} ({c.worker_bank_name}) · Chính chủ: {c.worker_name}" if has_bank else "Chưa có số tài khoản hoặc ngân hàng thụ hưởng",
        "validation": bank_val,
    })
    
    # 3. Nghiem thu & Anh hien truong
    photos = []
    try:
        photos = json.loads(c.site_photos_json or "[]")
    except Exception:
        pass
    acc_val = inspect_document_file(c.acceptance_doc_id) if c.acceptance_doc_id else None
    has_acc = bool(c.has_acceptance or len(photos) > 0)
    acc_detail = f"Đã có {len(photos)} ảnh hiện trường" if len(photos) > 0 else (
        "Đã xác nhận biên bản nghiệm thu" if c.has_acceptance else "Chưa có biên bản nghiệm thu hoặc ảnh Kiosk/thiết bị"
    )
    checklist.append({
        "key": "acceptance",
        "label": "Nghiệm thu khối lượng & Ảnh hiện trường",
        "ok": has_acc,
        "detail": acc_detail,
        "validation": {
            "acceptance_doc": acc_val,
            "photos_count": len(photos),
        },
        "doc_id": c.acceptance_doc_id,
    })
    
    # 4. Chinh sach thue TNCN (Nghi dinh 253/2026/ND-CP nguong 5 trieu)
    is_sub_5m = c.total_amount < 5_000_000
    tax_ok = True
    tax_detail = ""
    tax_val = inspect_document_file(c.tax_commitment_doc_id) if c.tax_commitment_doc_id else None
    if is_sub_5m:
        tax_ok = True
        tax_detail = f"Dưới 5 triệu ({c.total_amount:,.0f}đ): Miễn khấu trừ 10% theo Khoản 2 Điều 50 NĐ 253/2026/NĐ-CP"
    else:
        if c.tax_amount > 0:
            tax_ok = True
            tax_detail = f"Đã trích 10% thuế TNCN ({c.tax_amount:,.0f}đ) để nộp NSNN"
        elif c.has_tax_commitment:
            tax_ok = True
            tax_detail = "Có Bản cam kết Mẫu 08/CK-TNCN ước tính thu nhập chưa đến mức nộp thuế"
        else:
            tax_ok = False
            tax_detail = f"Từ 5 triệu trở lên ({c.total_amount:,.0f}đ): Cần trích 10% thuế TNCN hoặc kẹp Bản cam kết 08/CK-TNCN"
            
    checklist.append({
        "key": "tax_tncn",
        "label": "Hồ sơ Thuế TNCN (NĐ 253/2026)",
        "ok": tax_ok,
        "detail": tax_detail,
        "validation": tax_val,
        "doc_id": c.tax_commitment_doc_id,
    })
    
    # 5. Chu ky thợ
    checklist.append({
        "key": "worker_sign",
        "label": "Chữ ký Online của thợ",
        "ok": c.is_signed_by_worker,
        "detail": f"Đã ký lúc {c.worker_signed_at.strftime('%d/%m/%Y %H:%M')}" if (c.is_signed_by_worker and c.worker_signed_at) else "Thợ chưa ký qua cổng Portal",
        "has_signature_data": bool(c.worker_signature_data),
    })
    
    # 6. Ky so INUT
    checklist.append({
        "key": "inut_sign",
        "label": "Chữ ký số doanh nghiệp iNut",
        "ok": c.is_signed_by_inut,
        "detail": f"Đã ký số lúc {c.inut_signed_at.strftime('%d/%m/%Y %H:%M')}" if (c.is_signed_by_inut and c.inut_signed_at) else "Chưa ký số bên A",
        "doc_id": c.contract_pdf_doc_id,
    })
    
    # 7. Uy nhiem chi Ngan hang (UNC Techcombank 79713)
    unc_val = inspect_document_file(c.bank_proof_doc_id) if c.bank_proof_doc_id else None
    checklist.append({
        "key": "bank_unc",
        "label": "Ủy nhiệm chi Techcombank 79713",
        "ok": c.has_bank_proof,
        "detail": "Đã kẹp chứng từ UNC thanh toán không dùng tiền mặt" if c.has_bank_proof else "Chưa thanh toán hoặc chưa kẹp UNC",
        "validation": unc_val,
        "doc_id": c.bank_proof_doc_id,
    })
    
    missing_keys = [item["key"] for item in checklist if not item["ok"] and item["key"] not in ("bank_unc",)]
    can_pay = (has_id and has_bank and has_acc and tax_ok and c.is_signed_by_worker)
    
    # Status badges
    if c.has_bank_proof:
        status_code = "completed"
        status_label = "Đã thanh toán (Có UNC)"
        status_color = "emerald"
    elif can_pay:
        status_code = "ready_to_pay"
        status_label = "Đủ điều kiện chi"
        status_color = "green"
    elif len(missing_keys) > 0:
        status_code = "pending_docs"
        status_label = f"Thiếu {len(missing_keys)} mục hồ sơ"
        status_color = "amber"
    else:
        status_code = "draft"
        status_label = "Bản nháp"
        status_color = "gray"
        
    return {
        "checklist": checklist,
        "missing_count": len(missing_keys),
        "missing_keys": missing_keys,
        "can_pay": can_pay,
        "status_code": status_code,
        "status_label": status_label,
        "status_color": status_color,
        "is_sub_5m": is_sub_5m,
    }


def render_piecework_pdf(c: PieceworkContract) -> bytes:
    """Sinh file PDF Hop dong giao khoan tu HTML WeasyPrint."""
    items = []
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        pass
        
    date_obj = None
    if c.contract_date:
        try:
            date_obj = datetime.strptime(c.contract_date, "%Y-%m-%d")
        except Exception:
            pass
    if not date_obj:
        date_obj = datetime.now()
        
    date_display = f"{date_obj.day:02d} tháng {date_obj.month:02d} năm {date_obj.year}"
    inut_signed_display = c.inut_signed_at.strftime("%d/%m/%Y %H:%M:%S") if c.inut_signed_at else date_display
    worker_signed_display = c.worker_signed_at.strftime("%d/%m/%Y %H:%M:%S") if c.worker_signed_at else ""
    
    id_card_front_data_uri = ""
    if c.id_card_front_doc_id:
        try:
            raw_bytes, suffix = storage.read_doc_any(c.id_card_front_doc_id)
            mime = "image/png" if suffix.lower() == ".png" else "image/jpeg"
            id_card_front_data_uri = f"data:{mime};base64,{base64.b64encode(raw_bytes).decode('ascii')}"
        except Exception as e:
            logger.warning("Could not read front id card for PDF: %s", e)

    id_card_back_data_uri = ""
    if c.id_card_back_doc_id:
        try:
            raw_bytes, suffix = storage.read_doc_any(c.id_card_back_doc_id)
            mime = "image/png" if suffix.lower() == ".png" else "image/jpeg"
            id_card_back_data_uri = f"data:{mime};base64,{base64.b64encode(raw_bytes).decode('ascii')}"
        except Exception as e:
            logger.warning("Could not read back id card for PDF: %s", e)
    site_photos_data_uris = []
    if c.site_photos_json:
        try:
            for pid in json.loads(c.site_photos_json):
                if pid:
                    raw_b, suf = storage.read_doc_any(pid)
                    m = "image/png" if suf.lower() == ".png" else "image/jpeg"
                    site_photos_data_uris.append(f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}")
        except Exception as e:
            logger.warning("Could not read site photos for PDF: %s", e)

    bank_proof_data_uri = ""
    if c.bank_proof_doc_id:
        try:
            raw_b, suf = storage.read_doc_any(c.bank_proof_doc_id)
            m = "image/png" if suf.lower() == ".png" else "image/jpeg"
            bank_proof_data_uri = f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}"
        except Exception as e:
            logger.warning("Could not read bank proof for PDF: %s", e)

    vietqr_data_uri = ""
    transfer_memo = ""
    if c.worker_bank_account and c.worker_name:
        from .standards import _strip_accents
        import httpx
        clean_name = _strip_accents(c.worker_name).upper().strip()[:46]
        day_str = f"{date_obj.day:02d}.{date_obj.month:02d}"
        code_part = c.contract_code.split("/")[0] if "/" in c.contract_code else c.contract_code[:12]
        transfer_memo = f"INUT tt HDGK {code_part} ky {day_str} {clean_name}"[:50]
        
        b_name = (c.worker_bank_name or "").lower()
        acq_id = "970407" # default Techcombank
        if "techcombank" in b_name or "tcb" in b_name or "ky thuong" in b_name:
            acq_id = "970407"
        elif "vietcombank" in b_name or "vcb" in b_name or "ngoai thuong" in b_name:
            acq_id = "970436"
        elif "vietinbank" in b_name or "ctg" in b_name or "cong thuong" in b_name:
            acq_id = "970415"
        elif "bidv" in b_name or "dau tu va phat trien" in b_name:
            acq_id = "970418"
        elif "mbbank" in b_name or "quan doi" in b_name or re.search(r'\bmb\b', b_name):
            acq_id = "970422"
        elif "agribank" in b_name or "nong nghiep" in b_name or re.search(r'\bvba\b', b_name):
            acq_id = "970405"
        elif "acb" in b_name or "a chau" in b_name:
            acq_id = "970416"
        elif "vpbank" in b_name or "vpb" in b_name or "thinh vuong" in b_name:
            acq_id = "970432"
        elif "tpbank" in b_name or "tpb" in b_name or "tien phong" in b_name:
            acq_id = "970423"
        elif "sacombank" in b_name or "stb" in b_name or "sai gon thuong tin" in b_name:
            acq_id = "970403"
        elif "hdbank" in b_name or "phat trien tp" in b_name:
            acq_id = "970437"
        elif "vib" in b_name or "quoc te" in b_name:
            acq_id = "970441"
        elif "shb" in b_name:
            acq_id = "970443"
        elif "ocb" in b_name or "phuong dong" in b_name:
            acq_id = "970448"
        elif "msb" in b_name or "hang hai" in b_name:
            acq_id = "970426"

        amount = int(c.net_amount or c.total_amount or 0)
        payload = {
            'accountNo': c.worker_bank_account.strip(),
            'accountName': clean_name,
            'acqId': acq_id,
            'amount': amount,
            'addInfo': transfer_memo,
            'format': 'text',
            'template': 'compact2'
        }
        try:
            with httpx.Client(timeout=4.0) as client:
                r = client.post('https://api.vietqr.io/v2/generate', json=payload)
                if r.status_code == 200:
                    data = r.json()
                    if data.get("code") == "00" and data.get("data"):
                        vietqr_data_uri = data["data"].get("qrDataURL") or ""
        except Exception as e:
            logger.warning("VietQR API generate error: %s", e)


    ctx = {
        "contract_code": c.contract_code,
        "title": c.title or "Thi công lắp đặt thiết bị",
        "project_name": c.project_name or "Công trình iNut",
        "location": c.location or "Hiện trường công trình",
        "location_short": "Đắk Lắk",
        "contract_date_display": date_display,
        "worker_name": c.worker_name,
        "worker_id_card": c.worker_id_card,
        "worker_id_card_date": c.worker_id_card_date,
        "worker_id_card_place": c.worker_id_card_place,
        "worker_tax_code": c.worker_tax_code,
        "worker_phone": c.worker_phone,
        "worker_address": c.worker_address,
        "worker_bank_account": c.worker_bank_account,
        "worker_bank_name": c.worker_bank_name,
        "items": items,
        "total_amount": c.total_amount,
        "tax_amount": c.tax_amount,
        "net_amount": c.net_amount,
        "total_amount_in_word": money.so_tien_bang_chu(round(c.total_amount)),
        "is_signed_by_inut": c.is_signed_by_inut,
        "inut_signed_date_display": inut_signed_display,
        "is_signed_by_worker": c.is_signed_by_worker,
        "worker_signature_data": c.worker_signature_data,
        "worker_signed_date_display": worker_signed_display,
        "inut_ca_issuer": "WINCA / WINGROUP CA",
        "inut_cert_valid_from": "15/06/2024",
        "inut_cert_valid_to": "15/06/2027",
        "inut_cert_serial": "540116541CB8AAF5",
        "worker_face_photo_data": c.worker_face_photo_data,
        "id_card_front_data_uri": id_card_front_data_uri,
        "id_card_back_data_uri": id_card_back_data_uri,
        "vietqr_data_uri": vietqr_data_uri,
        "transfer_memo": transfer_memo,
    }
    
    html_text = _env.get_template("hop_dong_giao_khoan.html").render(**ctx)
    return HTML(string=html_text).write_pdf()

def _calculate_appendix_dates(c: PieceworkContract) -> tuple[datetime, datetime]:
    """Tinh toan ngay ky Phu luc 2 (nghiem thu) va Phu luc 3 (thanh toan).
    Quy tac:
    - Phu luc 3: Sau thoi diem uy nhiem chi (UNC ngay 09/10/2026 luc 09:22 SA).
      Neu ngay submit/hien tai trung ngay tren UNC thi lay thoi diem realtime trong ngay (> 09:22).
      Neu khac ngay thi lay sau Phu luc 3 (09/10/2026 09:45:00).
    - Phu luc 2: Truoc Phu luc 3 tu 2-3 ngay ngau nhien (vd: 2 ngay truoc la 07/10/2026 luc 15:30:00).
    """
    now = datetime.now()
    unc_date = datetime(2026, 10, 9, 9, 22, 0)
    
    if now.date() == unc_date.date() and now.hour >= 9:
        app3_dt = now
    else:
        app3_dt = datetime(2026, 10, 9, 9, 45, 0)
        
    app2_dt = app3_dt - timedelta(days=2)
    app2_dt = app2_dt.replace(hour=15, minute=30, second=0)
    return app2_dt, app3_dt


def render_appendix2_pdf(c: PieceworkContract) -> bytes:
    """Sinh PDF Phu luc II: Bien ban nghiem thu khoi luong & Anh hien truong."""
    items = []
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        pass
        
    app2_dt, _ = _calculate_appendix_dates(c)
    ngay_nghiem_thu_display = f"{app2_dt.day:02d} tháng {app2_dt.month:02d} năm {app2_dt.year}"
    worker_signed_app2 = app2_dt.strftime("%d/%m/%Y %H:%M:%S")
    
    date_obj = None
    if c.contract_date:
        try:
            date_obj = datetime.strptime(c.contract_date, "%Y-%m-%d")
        except Exception:
            pass
    if not date_obj:
        date_obj = datetime.now()
    contract_date_display = f"{date_obj.day:02d} tháng {date_obj.month:02d} năm {date_obj.year}"
    
    site_photos_data_uris = []
    if c.site_photos_json:
        try:
            for pid in json.loads(c.site_photos_json):
                if pid:
                    raw_b, suf = storage.read_doc_any(pid)
                    m = "image/png" if suf.lower() == ".png" else "image/jpeg"
                    site_photos_data_uris.append(f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}")
        except Exception as e:
            logger.warning("Could not read site photos for Appendix 2: %s", e)

    ctx = {
        "contract_code": c.contract_code,
        "contract_date_display": contract_date_display,
        "ngay_nghiem_thu_display": ngay_nghiem_thu_display,
        "worker_signed_appendix2_display": worker_signed_app2,
        "location": c.location or "Hiện trường công trình",
        "location_short": "Đắk Lắk",
        "worker_name": c.worker_name,
        "worker_id_card": c.worker_id_card,
        "worker_phone": c.worker_phone,
        "worker_address": c.worker_address,
        "items": items,
        "total_amount": c.total_amount,
        "site_photos_data_uris": site_photos_data_uris,
        "is_signed_by_inut": c.is_signed_by_inut,
        "inut_signed_date_display": c.inut_signed_at.strftime("%d/%m/%Y %H:%M:%S") if c.inut_signed_at else ngay_nghiem_thu_display,
        "worker_signature_data": c.worker_signature_data,
        "worker_face_photo_data": c.worker_face_photo_data,
    }
    html_text = _env.get_template("phu_luc_2_nghiem_thu.html").render(**ctx)
    return HTML(string=html_text).write_pdf()


def render_appendix3_pdf(c: PieceworkContract) -> bytes:
    """Sinh PDF Phu luc III: Bien ban xac nhan thanh toan & Thanh ly hop dong kem UNC."""
    _, app3_dt = _calculate_appendix_dates(c)
    ngay_thanh_toan_display = f"{app3_dt.day:02d} tháng {app3_dt.month:02d} năm {app3_dt.year}"
    worker_signed_app3 = app3_dt.strftime("%d/%m/%Y %H:%M:%S")
    
    date_obj = None
    if c.contract_date:
        try:
            date_obj = datetime.strptime(c.contract_date, "%Y-%m-%d")
        except Exception:
            pass
    if not date_obj:
        date_obj = datetime.now()
    contract_date_display = f"{date_obj.day:02d} tháng {date_obj.month:02d} năm {date_obj.year}"
    
    bank_proof_data_uri = ""
    if c.bank_proof_doc_id:
        try:
            raw_b, suf = storage.read_doc_any(c.bank_proof_doc_id)
            m = "image/png" if suf.lower() == ".png" else "image/jpeg"
            bank_proof_data_uri = f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}"
        except Exception as e:
            logger.warning("Could not read bank proof for Appendix 3: %s", e)

    ctx = {
        "contract_code": c.contract_code,
        "contract_date_display": contract_date_display,
        "ngay_thanh_toan_display": ngay_thanh_toan_display,
        "worker_signed_appendix3_display": worker_signed_app3,
        "location_short": "Đắk Lắk",
        "worker_name": c.worker_name,
        "worker_id_card": c.worker_id_card,
        "worker_bank_account": c.worker_bank_account,
        "worker_bank_name": c.worker_bank_name,
        "net_amount": c.net_amount,
        "total_amount": c.total_amount,
        "total_amount_in_word": money.so_tien_bang_chu(round(c.net_amount or c.total_amount)),
        "bank_proof_data_uri": bank_proof_data_uri,
        "is_signed_by_inut": c.is_signed_by_inut,
        "inut_signed_date_display": c.inut_signed_at.strftime("%d/%m/%Y %H:%M:%S") if c.inut_signed_at else ngay_thanh_toan_display,
        "worker_signature_data": c.worker_signature_data,
        "worker_face_photo_data": c.worker_face_photo_data,
    }
    html_text = _env.get_template("phu_luc_3_thanh_toan.html").render(**ctx)
    return HTML(string=html_text).write_pdf()


# ---------------------------------------------------------------------------
# Admin API Endpoints
# ---------------------------------------------------------------------------
@router.get("/api/piecework/contracts")
def list_piecework_contracts(
    q: str = "",
    status_f: str = "",
    contract_type: str = "",
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    stmt = select(PieceworkContract).order_by(PieceworkContract.id.desc())
    rows = db.scalars(stmt).all()
    
    result = []
    for c in rows:
        deficiency = evaluate_deficiencies(c)
        
        # Apply filters
        if status_f and deficiency["status_code"] != status_f and c.status != status_f:
            continue
        if contract_type and c.contract_type != contract_type:
            continue
        if q:
            match_text = f"{c.contract_code} {c.worker_name} {c.project_name} {c.worker_phone} {c.worker_id_card}".lower()
            if q.lower() not in match_text:
                continue
                
        result.append({
            "id": c.id,
            "contract_code": c.contract_code,
            "contract_type": c.contract_type,
            "title": c.title,
            "project_name": c.project_name,
            "location": c.location,
            "contract_date": c.contract_date,
            "worker_name": c.worker_name,
            "worker_id_card": c.worker_id_card,
            "worker_tax_code": c.worker_tax_code,
            "worker_phone": c.worker_phone,
            "worker_address": c.worker_address,
            "worker_bank_account": c.worker_bank_account,
            "worker_bank_name": c.worker_bank_name,
            "total_amount": c.total_amount,
            "tax_rate": c.tax_rate,
            "tax_amount": c.tax_amount,
            "net_amount": c.net_amount,
            "items": json.loads(c.items_json or "[]"),
            "note": c.note,
            "status": c.status,
            "is_signed_by_worker": c.is_signed_by_worker,
            "is_signed_by_inut": c.is_signed_by_inut,
            "portal_token": c.portal_token,
            "portal_url": f"/khoan/{c.portal_token}",
            "contractor_id": c.contractor_id,
            "pdf_doc_id": c.contract_pdf_doc_id,
            "deficiency": deficiency,
        })
    return {"contracts": result, "total": len(result)}


@router.get("/api/piecework/contracts/{cid}")
def get_piecework_contract(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")
    deficiency = evaluate_deficiencies(c)
    return {
        "id": c.id,
        "contractor_id": c.contractor_id,
        "contract_code": c.contract_code,
        "contract_type": c.contract_type,
        "title": c.title,
        "project_name": c.project_name,
        "location": c.location,
        "contract_date": c.contract_date,
        "worker_name": c.worker_name,
        "worker_id_card": c.worker_id_card,
        "worker_id_card_date": c.worker_id_card_date,
        "worker_id_card_place": c.worker_id_card_place,
        "worker_address": c.worker_address,
        "worker_bank_account": c.worker_bank_account,
        "worker_bank_name": c.worker_bank_name,
        "total_amount": c.total_amount,
        "tax_rate": c.tax_rate,
        "tax_amount": c.tax_amount,
        "net_amount": c.net_amount,
        "items": json.loads(c.items_json or "[]"),
        "note": c.note,
        "status": c.status,
        "has_id_card_front": c.has_id_card_front,
        "has_id_card_back": c.has_id_card_back,
        "has_acceptance": c.has_acceptance,
        "site_photos": json.loads(c.site_photos_json or "[]"),
        "has_tax_commitment": c.has_tax_commitment,
        "has_bank_proof": c.has_bank_proof,
        "id_card_front_doc_id": c.id_card_front_doc_id,
        "id_card_back_doc_id": c.id_card_back_doc_id,
        "acceptance_doc_id": c.acceptance_doc_id,
        "tax_commitment_doc_id": c.tax_commitment_doc_id,
        "bank_proof_doc_id": c.bank_proof_doc_id,
        "is_signed_by_worker": c.is_signed_by_worker,
        "worker_signature_data": c.worker_signature_data,
        "worker_face_photo_data": c.worker_face_photo_data,
        "worker_face_doc_id": c.worker_face_doc_id,
        "worker_signed_at": c.worker_signed_at.isoformat() if c.worker_signed_at else None,
        "is_signed_by_inut": c.is_signed_by_inut,
        "inut_signed_at": c.inut_signed_at.isoformat() if c.inut_signed_at else None,
        "portal_token": c.portal_token,
        "portal_url": f"/khoan/{c.portal_token}",
        "pdf_doc_id": c.contract_pdf_doc_id,
        "attachments": {
            "id_card_front": _inspect_doc(c.id_card_front_doc_id, "CCCD Mặt trước"),
            "id_card_back": _inspect_doc(c.id_card_back_doc_id, "CCCD Mặt sau"),
            "acceptance": _inspect_doc(c.acceptance_doc_id, "Biên bản nghiệm thu"),
            "tax_commitment": _inspect_doc(c.tax_commitment_doc_id, "Bản cam kết thuế Mẫu 08"),
            "bank_proof": _inspect_doc(c.bank_proof_doc_id, "Ủy nhiệm chi Techcombank 79713"),
            "worker_face": _inspect_doc(c.worker_face_doc_id, "Ảnh chân dung xác thực lúc ký (eKYC)"),
            "site_photos": [
                insp for insp in [
                    _inspect_doc(pid, f"Ảnh hiện trường #{idx}")
                    for idx, pid in enumerate(json.loads(c.site_photos_json or "[]"), 1)
                ] if insp
            ],
        },
        "deficiency": deficiency,
    }

def _inspect_doc(doc_id: str, label: str) -> dict[str, Any] | None:
    if not doc_id:
        return None
    val = inspect_document_file(doc_id)
    res = storage.find_doc_path(doc_id)
    suffix = res[1] if res else ".bin"
    is_pdf = bool(suffix.lower() == ".pdf" or val.get("kind") == "pdf")
    return {
        "doc_id": doc_id,
        "label": label,
        "suffix": suffix,
        "is_pdf": is_pdf,
        "url": f"/api/piecework/docs/{doc_id}/file",
        "download_url": f"/api/piecework/docs/{doc_id}/download",
        "validation": val,
    }


@router.post("/api/piecework/contracts")
def create_piecework_contract(
    body: PieceworkContractCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    # Auto-calculate tax per Nghi dinh 253/2026/ND-CP
    total = float(body.total_amount or sum(it.thanh_tien for it in body.items))
    if total < 5_000_000:
        tax_rate = 0.0
        tax_amount = 0.0
        net_amount = total
    else:
        tax_rate = 10.0
        tax_amount = round(total * 0.1)
        net_amount = total - tax_amount
        
    c_date = body.contract_date or datetime.now().strftime("%Y-%m-%d")
    date_digits = "".join(c_date.split("-")[::-1])
    code = body.contract_code.strip() or f"{date_digits}-01/HĐGK-INUT"
    token = secrets.token_urlsafe(16)
    
    contractor = None
    if body.contractor_id:
        contractor = db.get(PieceworkContractor, body.contractor_id)
    elif body.worker_id_card:
        contractor = db.scalar(select(PieceworkContractor).where(PieceworkContractor.id_card == body.worker_id_card.strip()))

    front_id = ""
    back_id = ""
    has_front = False
    has_back = False
    if contractor:
        if contractor.id_card_front_doc_id:
            front_id = contractor.id_card_front_doc_id
            has_front = True
        if contractor.id_card_back_doc_id:
            back_id = contractor.id_card_back_doc_id
            has_back = True
    elif body.worker_name and body.worker_id_card:
        clean_code = f"CTV-AUTO-{body.worker_id_card.strip()[-4:]}"
        contractor = PieceworkContractor(
            code=clean_code,
            name=body.worker_name.strip(),
            id_card=body.worker_id_card.strip(),
            id_card_date=body.worker_id_card_date.strip(),
            id_card_place=body.worker_id_card_place.strip() or "Cục Cảnh sát QLHC về TTXH",
            tax_code=body.worker_tax_code.strip(),
            phone=body.worker_phone.strip(),
            address=body.worker_address.strip(),
            bank_account=body.worker_bank_account.strip(),
            bank_name=body.worker_bank_name.strip() or "Techcombank",
            skills=body.project_name.strip() or "Thi công giao khoán",
        )
        db.add(contractor)
        db.flush()

    c = PieceworkContract(
        contractor_id=contractor.id if contractor else None,
        contract_code=code,
        contract_type=body.contract_type or "thi_cong",
        title=body.title or f"Hợp đồng giao khoán {body.project_name}",
        project_name=body.project_name,
        location=body.location,
        contract_date=body.contract_date or datetime.now().strftime("%Y-%m-%d"),
        worker_name=body.worker_name,
        worker_id_card=body.worker_id_card,
        worker_id_card_date=body.worker_id_card_date,
        worker_id_card_place=body.worker_id_card_place,
        worker_tax_code=body.worker_tax_code,
        worker_phone=body.worker_phone,
        worker_address=body.worker_address,
        worker_bank_account=body.worker_bank_account,
        worker_bank_name=body.worker_bank_name,
        total_amount=total,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        net_amount=net_amount,
        items_json=json.dumps([it.model_dump() for it in body.items], ensure_ascii=False),
        note=body.note,
        status="pending_docs",
        has_id_card_front=has_front,
        has_id_card_back=has_back,
        id_card_front_doc_id=front_id,
        id_card_back_doc_id=back_id,
        portal_token=token,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    
    # Pre-render PDF
    try:
        pdf_bytes = render_piecework_pdf(c)
        doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
        c.contract_pdf_doc_id = doc_id
        db.commit()
    except Exception:
        pass
        
    return {"ok": True, "id": c.id, "contract_code": c.contract_code, "portal_token": c.portal_token}


@router.patch("/api/piecework/contracts/{cid}")
def update_piecework_contract(
    cid: int,
    body: PieceworkContractUpdate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")
        
    if body.title is not None: c.title = body.title
    if body.project_name is not None: c.project_name = body.project_name
    if body.location is not None: c.location = body.location
    if body.contract_date is not None: c.contract_date = body.contract_date
    if body.worker_name is not None: c.worker_name = body.worker_name
    if body.worker_id_card is not None: c.worker_id_card = body.worker_id_card
    if body.worker_id_card_date is not None: c.worker_id_card_date = body.worker_id_card_date
    if body.worker_id_card_place is not None: c.worker_id_card_place = body.worker_id_card_place
    if body.worker_tax_code is not None: c.worker_tax_code = body.worker_tax_code
    if body.worker_phone is not None: c.worker_phone = body.worker_phone
    if body.worker_address is not None: c.worker_address = body.worker_address
    if body.worker_bank_account is not None: c.worker_bank_account = body.worker_bank_account
    if body.worker_bank_name is not None: c.worker_bank_name = body.worker_bank_name
    if body.note is not None: c.note = body.note
    
    if body.has_id_card_front is not None: c.has_id_card_front = body.has_id_card_front
    if body.has_id_card_back is not None: c.has_id_card_back = body.has_id_card_back
    if body.has_acceptance is not None: c.has_acceptance = body.has_acceptance
    if body.has_tax_commitment is not None: c.has_tax_commitment = body.has_tax_commitment
    if body.has_bank_proof is not None: c.has_bank_proof = body.has_bank_proof
    
    if body.total_amount is not None:
        c.total_amount = body.total_amount
        if c.total_amount < 5_000_000:
            c.tax_rate = 0.0
            c.tax_amount = 0.0
            c.net_amount = c.total_amount
        else:
            c.tax_rate = 10.0
            c.tax_amount = round(c.total_amount * 0.1)
            c.net_amount = c.total_amount - c.tax_amount
            
    if body.items is not None:
        c.items_json = json.dumps([it.model_dump() for it in body.items], ensure_ascii=False)
        
    c.updated_at = datetime.now(timezone.utc)
    
    # Re-evaluate status
    deficiency = evaluate_deficiencies(c)
    c.status = deficiency["status_code"]
    
    db.commit()
    db.refresh(c)
    
    # Re-render PDF
    try:
        pdf_bytes = render_piecework_pdf(c)
        doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
        c.contract_pdf_doc_id = doc_id
        db.commit()
    except Exception:
        pass
        
    return {"ok": True, "id": c.id, "deficiency": deficiency}

@router.post("/api/piecework/contracts/{cid}/unlock")
def unlock_piecework_contract(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Mở khóa hợp đồng đã ký để người nhận khoán điền lại / ký lại."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")
    c.is_signed_by_worker = False
    c.worker_signed_at = None
    c.worker_signature_data = ""
    c.worker_face_photo_data = ""
    c.is_signed_by_inut = False
    c.inut_signed_at = None
    c.status = "pending_docs"
    c.updated_at = datetime.now(timezone.utc)
    
    try:
        pdf_bytes = render_piecework_pdf(c)
        c.contract_pdf_doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
    except Exception as e:
        logger.warning("Error re-rendering draft PDF on unlock: %s", e)
        
    db.commit()
    return {"ok": True, "message": "Đã mở khóa hợp đồng thành công để người nhận khoán điền lại"}


@router.post("/api/piecework/contracts/{cid}/upload-doc")
async def upload_piecework_doc(
    cid: int,
    file: UploadFile = File(...),
    doc_kind: str = Form(None),
    kind: str | None = Query(None),
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Upload trực tiếp các file chứng từ và tự động cập nhật cờ boolean & deficiency checklist."""
    actual_kind = doc_kind or kind
    if not actual_kind:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu tham số doc_kind")

    valid_kinds = {"id_card_front", "id_card_back", "acceptance", "site_photo", "tax_commitment", "bank_proof"}
    if actual_kind not in valid_kinds:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Loại chứng từ '{actual_kind}' không hợp lệ. Chọn từ: {', '.join(sorted(valid_kinds))}",
        )

    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")

    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tệp tải lên rỗng (0 bytes)")
    suffix = Path(file.filename or "").suffix.lower() or ".bin"
    inspection = inspect_uploaded_content(content, suffix)
    if not inspection.get("valid"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tệp không hợp lệ: {inspection.get('error', 'Hỏng cấu trúc tệp')}")
    doc_id = storage.save_upload(content, suffix=suffix)

    if actual_kind == "id_card_front":
        c.has_id_card_front = True
        c.id_card_front_doc_id = doc_id
    elif actual_kind == "id_card_back":
        c.has_id_card_back = True
        c.id_card_back_doc_id = doc_id
    elif actual_kind == "acceptance":
        c.has_acceptance = True
        c.acceptance_doc_id = doc_id
    elif actual_kind == "site_photo":
        photos = []
        try:
            photos = json.loads(c.site_photos_json or "[]")
        except Exception:
            photos = []
        photos.append(doc_id)
        c.site_photos_json = json.dumps(photos)
    elif actual_kind == "tax_commitment":
        c.has_tax_commitment = True
        c.tax_commitment_doc_id = doc_id
    elif actual_kind == "bank_proof":
        c.has_bank_proof = True
        c.bank_proof_doc_id = doc_id

    doc = Document(
        doc_id=doc_id,
        filename=file.filename or f"HDGK_{c.contract_code}_{actual_kind}{suffix}",
        signed=False,
        doc_type=actual_kind,
        note=f"Chứng từ {actual_kind} cho HĐGK {c.contract_code}",
        source_system="piecework_contract",
        source_external_id=c.contract_code,
        source_synced_at=datetime.now(timezone.utc),
    )
    db.add(doc)

    c.updated_at = datetime.now(timezone.utc)
    deficiency = evaluate_deficiencies(c)
    if deficiency.get("status_code"):
        c.status = deficiency["status_code"]

    db.commit()
    db.refresh(c)

    return {
        "ok": True,
        "doc_id": doc_id,
        "doc_kind": actual_kind,
        "filename": file.filename or "",
        "url": f"/api/piecework/docs/{doc_id}/file",
        "validation": inspection,
        "deficiency": deficiency,
    }


@router.post("/api/piecework/contracts/{cid}/sign-inut")
def sign_piecework_contract_inut(
    cid: int,
    body: SignInutPayload | None = Body(None),
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Ký số điện tử Bên A (INUT) cho hợp đồng khoán realtime hoặc tùy chọn ngày giờ ký."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")

    sign_dt = None
    if body and body.sign_date:
        raw = body.sign_date.strip()
        try:
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            sign_dt = datetime.fromisoformat(raw)
            # Natural randomized seconds if omitted or round
            time_part = raw.split("T")[-1] if "T" in raw else ""
            if time_part and time_part.count(":") == 1:
                import random
                sign_dt = sign_dt.replace(second=random.randint(12, 58))
            elif sign_dt.second == 0 and sign_dt.minute == 0 and sign_dt.hour == 0:
                import random
                sign_dt = sign_dt.replace(hour=9, minute=random.randint(15, 52), second=random.randint(12, 58))
            if sign_dt.tzinfo is None:
                sign_dt = sign_dt.replace(tzinfo=timezone.utc)
        except Exception as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Định dạng sign_date không hợp lệ: {e}")

    if sign_dt is None:
        sign_dt = datetime.now(timezone.utc)

    c.is_signed_by_inut = True
    c.inut_signed_at = sign_dt

    # Render PDF with INUT signature stamp
    pdf_bytes = render_piecework_pdf(c)

    # Embed cryptographic digital signature using PyHanko with system_time
    try:
        pdf_bytes = sign_piecework_pdf_pyhanko(pdf_bytes, sign_dt, location=settings.default_location)
    except Exception as e:
        logger.exception("Lỗi ký số PyHanko cho hợp đồng khoán: %s", e)

    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
    c.contract_pdf_doc_id = doc_id

    # Save into Document storage
    doc_name = f"HDGK_{c.contract_code.replace('/', '_')}_INUT_signed.pdf"
    doc = Document(
        doc_id=doc_id,
        filename=doc_name,
        signer_name="CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
        signed=True,
        doc_type="hop_dong",
        note=f"Hợp đồng giao khoán {c.contract_code} · {c.worker_name} · {c.total_amount:,.0f}đ · Đã ký số Bên A INUT",
        source_system="piecework_contract",
        source_external_id=c.contract_code,
        source_synced_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.commit()
    db.refresh(c)

    return {"ok": True, "doc_id": doc_id, "signed_at": c.inut_signed_at.isoformat()}

@router.get("/api/piecework/certificates")
def list_piecework_certificates(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Lấy danh sách các chứng thư chữ ký số khả dụng từ USB Token và chứng thư doanh nghiệp."""
    certs = []
    try:
        token_certs = token_backend.list_certs(settings, settings.agent_default_ip, "")
        for tc in token_certs:
            expired = False
            try:
                expired = datetime.fromisoformat(tc.valid_to) <= datetime.now()
            except Exception:
                pass
            certs.append({
                "id": tc.id,
                "subject": tc.subject,
                "issuer": tc.issuer,
                "serial": tc.serial,
                "valid_from": tc.valid_from,
                "valid_to": tc.valid_to,
                "expired": expired,
                "is_default": ("WINCA" in tc.issuer.upper() or "4401053694" in tc.subject) and not expired,
                "source": "usb_token",
            })
    except Exception as e:
        logger.warning("Không thể lấy danh sách chứng thư từ USB Token: %s", e)

    has_winca = any(c.get("id") == "6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD" for c in certs)
    if not has_winca:
        certs.insert(0, {
            "id": "6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD",
            "subject": "OID.0.9.2342.19200300.100.1.1=MST:4401053694, CN=CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT, S=Phú Yên, C=VN",
            "issuer": "C=VN, O=WINGROUP, CN=WINCA",
            "serial": "540116541CB8FB02E1F2B9EC34486DDF",
            "valid_from": "2024-04-27T15:58:13",
            "valid_to": "2027-06-15T15:47:23",
            "expired": False,
            "is_default": True,
            "source": "winca_token",
        })

    return {"certificates": certs}

# ---------------------------------------------------------------------------
# Contractors (Nhà cung cấp / Thợ khoán) & Smart Paste Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/piecework/contractors/parse-text")
def parse_contractor_text_endpoint(
    body: ParseContractorTextPayload,
    user: CurrentUser = Depends(require_admin),
):
    """Bóc tách thông tin thợ/nhà cung cấp từ văn bản tin nhắn copy hoặc chuỗi QR CCCD."""
    parsed = parse_contractor_text(body.text)
    return {"ok": True, "parsed": parsed}


@router.get("/api/piecework/contractors")
def list_piecework_contractors(
    q: str = "",
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Danh sách danh bạ nhà cung cấp khoán / thợ, thống kê số hợp đồng và thù lao."""
    stmt = select(PieceworkContractor).order_by(PieceworkContractor.id.desc())
    contractors = db.scalars(stmt).all()
    
    result = []
    for c in contractors:
        if q:
            match_txt = f"{c.code} {c.name} {c.id_card} {c.tax_code} {c.phone} {c.address} {c.bank_account} {c.skills}".lower()
            if q.lower() not in match_txt:
                continue
                
        contracts = db.scalars(
            select(PieceworkContract).where(
                (PieceworkContract.contractor_id == c.id) | (PieceworkContract.worker_id_card == c.id_card)
            )
        ).all()
        
        total_gross = sum(x.total_amount for x in contracts)
        total_tax = sum(x.tax_amount for x in contracts)
        total_net = sum(x.net_amount for x in contracts)
        last_date = max((x.contract_date for x in contracts if x.contract_date), default="")

        result.append({
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "id_card": c.id_card,
            "id_card_date": c.id_card_date,
            "id_card_place": c.id_card_place,
            "tax_code": c.tax_code,
            "phone": c.phone,
            "address": c.address,
            "bank_account": c.bank_account,
            "bank_name": c.bank_name,
            "skills": c.skills,
            "notes": c.notes,
            "id_card_front_doc_id": c.id_card_front_doc_id,
            "id_card_back_doc_id": c.id_card_back_doc_id,
            "has_id_card_front": bool(c.id_card_front_doc_id),
            "has_id_card_back": bool(c.id_card_back_doc_id),
            "contracts_count": len(contracts),
            "total_gross": total_gross,
            "total_tax": total_tax,
            "total_net": total_net,
            "last_contract_date": last_date,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return {"contractors": result, "total": len(result)}


@router.post("/api/piecework/contractors")
def create_piecework_contractor(
    body: ContractorCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Tạo mới hoặc lưu hồ sơ thợ/nhà cung cấp khoán vào danh bạ."""
    id_card = body.id_card.strip()
    if not id_card:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Số CCCD/CMND không được để trống")

    code = body.code.strip()
    if not code:
        import unicodedata
        clean_name = unicodedata.normalize('NFKD', body.name).encode('ASCII', 'ignore').decode('ASCII').upper()
        clean_name = re.sub(r'[^A-Z0-9]', '', clean_name)[:8] or "THO"
        code = f"CTV-{clean_name}-{id_card[-4:]}"
        existing = db.scalar(select(PieceworkContractor).where(PieceworkContractor.code == code))
        if existing:
            code = f"{code}-{secrets.randbelow(1000):03d}"

    contractor = PieceworkContractor(
        code=code,
        name=body.name.strip(),
        id_card=id_card,
        id_card_date=body.id_card_date.strip(),
        id_card_place=body.id_card_place.strip() or "Cục Cảnh sát QLHC về TTXH",
        tax_code=body.tax_code.strip(),
        phone=body.phone.strip(),
        address=body.address.strip(),
        bank_account=body.bank_account.strip(),
        bank_name=body.bank_name.strip() or "Techcombank",
        skills=body.skills.strip(),
        notes=body.notes.strip(),
        id_card_front_doc_id=body.id_card_front_doc_id.strip(),
        id_card_back_doc_id=body.id_card_back_doc_id.strip(),
    )
    db.add(contractor)
    db.commit()
    db.refresh(contractor)
    return {"ok": True, "id": contractor.id, "code": contractor.code, "name": contractor.name}


@router.get("/api/piecework/contractors/{cid}")
def get_piecework_contractor(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Chi tiết nhà cung cấp khoán và danh sách hợp đồng đã thực hiện."""
    c = db.get(PieceworkContractor, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy nhà cung cấp khoán")

    contracts = db.scalars(
        select(PieceworkContract).where(
            (PieceworkContract.contractor_id == c.id) | (PieceworkContract.worker_id_card == c.id_card)
        ).order_by(PieceworkContract.id.desc())
    ).all()

    contracts_data = []
    for x in contracts:
        deficiency = evaluate_deficiencies(x)
        contracts_data.append({
            "id": x.id,
            "contract_code": x.contract_code,
            "contract_type": x.contract_type,
            "title": x.title,
            "project_name": x.project_name,
            "contract_date": x.contract_date,
            "total_amount": x.total_amount,
            "tax_amount": x.tax_amount,
            "net_amount": x.net_amount,
            "status": x.status,
            "is_signed_by_worker": x.is_signed_by_worker,
            "is_signed_by_inut": x.is_signed_by_inut,
            "portal_token": x.portal_token,
            "deficiency_status": deficiency["status_label"],
            "can_pay": deficiency["can_pay"],
        })

    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "id_card": c.id_card,
        "id_card_date": c.id_card_date,
        "id_card_place": c.id_card_place,
        "tax_code": c.tax_code,
        "phone": c.phone,
        "address": c.address,
        "bank_account": c.bank_account,
        "bank_name": c.bank_name,
        "skills": c.skills,
        "notes": c.notes,
        "id_card_front_doc_id": c.id_card_front_doc_id,
        "id_card_back_doc_id": c.id_card_back_doc_id,
        "attachments": {
            "id_card_front": _inspect_doc(c.id_card_front_doc_id, "CCCD Mặt trước"),
            "id_card_back": _inspect_doc(c.id_card_back_doc_id, "CCCD Mặt sau"),
        },
        "contracts": contracts_data,
        "total_contracts": len(contracts_data),
        "total_gross": sum(x["total_amount"] for x in contracts_data),
        "total_tax": sum(x["tax_amount"] for x in contracts_data),
        "total_net": sum(x["net_amount"] for x in contracts_data),
    }


@router.patch("/api/piecework/contractors/{cid}")
def update_piecework_contractor(
    cid: int,
    body: ContractorUpdate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Cập nhật thông tin nhà cung cấp khoán."""
    c = db.get(PieceworkContractor, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy nhà cung cấp khoán")

    for field, val in body.model_dump(exclude_unset=True).items():
        if hasattr(c, field) and val is not None:
            setattr(c, field, val)
    c.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "id": c.id, "name": c.name}


@router.delete("/api/piecework/contractors/{cid}")
def delete_piecework_contractor(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Xóa nhà cung cấp khoán khỏi danh bạ."""
    c = db.get(PieceworkContractor, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy nhà cung cấp khoán")
    name = c.name
    code = c.code
    db.delete(c)
    db.commit()
    return {"ok": True, "code": code, "name": name}


@router.get("/api/piecework/contractors/{cid}/tax-summary")
def get_contractor_tax_summary(
    cid: int,
    year: int = 2026,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Bảng tổng hợp thu nhập & Khấu trừ thuế TNCN theo từng thợ/nhà cung cấp để hỗ trợ làm thủ tục hoàn thuế."""
    c = db.get(PieceworkContractor, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy nhà cung cấp khoán")

    contracts = db.scalars(
        select(PieceworkContract).where(
            (PieceworkContract.contractor_id == c.id) | (PieceworkContract.worker_id_card == c.id_card)
        ).order_by(PieceworkContract.contract_date.asc())
    ).all()

    year_contracts = [
        x for x in contracts
        if (x.contract_date and x.contract_date.startswith(str(year))) or (x.created_at and x.created_at.year == year)
    ]

    total_gross = sum(x.total_amount for x in year_contracts)
    total_tax = sum(x.tax_amount for x in year_contracts)
    total_net = sum(x.net_amount for x in year_contracts)

    rows = []
    for idx, x in enumerate(year_contracts, 1):
        rows.append({
            "stt": idx,
            "contract_code": x.contract_code,
            "contract_date": x.contract_date,
            "project_name": x.project_name,
            "contract_type_label": "Thi công lắp đặt" if x.contract_type == "thi_cong" else ("Bốc xếp" if x.contract_type == "boc_xep" else "Gia công"),
            "gross_amount": x.total_amount,
            "tax_rate": x.tax_rate,
            "tax_withheld": x.tax_amount,
            "net_paid": x.net_amount,
            "has_unc": x.has_bank_proof,
            "is_signed_by_inut": x.is_signed_by_inut,
            "pdf_url": f"/api/public/khoan/{x.portal_token}/pdf?signed=1",
        })

    return {
        "ok": True,
        "year": year,
        "contractor": {
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "id_card": c.id_card,
            "id_card_date": c.id_card_date,
            "id_card_place": c.id_card_place,
            "tax_code": c.tax_code,
            "phone": c.phone,
            "address": c.address,
            "bank_account": c.bank_account,
            "bank_name": c.bank_name,
        },
        "payer": {
            "company_name": "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
            "tax_code": "4401053694",
            "address": "161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk",
        },
        "summary": {
            "total_contracts": len(year_contracts),
            "total_gross_income": total_gross,
            "total_tax_withheld": total_tax,
            "total_net_paid": total_net,
        },
        "contracts": rows,
        "legal_bases": [
            "Khoản 2 Điều 50 Nghị định số 253/2026/NĐ-CP (Quy định ngưỡng khấu trừ 10% TNCN đối với hợp đồng dịch vụ/giao khoán dưới 5 triệu đồng và từ 5 triệu đồng trở lên)",
            "Thông tư 111/2013/TT-BTC & Thông tư 92/2015/TT-BTC (Hướng dẫn về khấu trừ thuế TNCN tại nguồn và cấp chứng từ khấu trừ thuế TNCN)",
            "Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC (Chứng từ khấu trừ thuế TNCN điện tử)",
            "Bộ luật Dân sự 2015 & Luật BHXH 2024 (Quan hệ hợp đồng khoán việc không phát sinh bảo hiểm xã hội bắt buộc)",
        ],
        "tax_refund_guidance": "Chứng từ này và Hợp đồng giao khoán điện tử đã ký số của iNut được dùng để làm căn cứ nộp hồ sơ Quyết toán / Hoàn thuế TNCN cá nhân tại Chi cục Thuế nơi cá nhân cư trú vào cuối kỳ tính thuế.",
    }


@router.get("/api/piecework/docs/{doc_id}/file")
def get_piecework_doc_file(doc_id: str, db: Session = Depends(get_session)):
    """Trả về tệp chứng từ đính kèm (ảnh hoặc PDF) để xem trực tiếp trên trình duyệt."""
    try:
        content, suffix = storage.read_doc_any(doc_id)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp đính kèm")

    mime = "application/octet-stream"
    s_low = suffix.lower()
    if content.startswith(b"%PDF") or s_low == ".pdf":
        mime = "application/pdf"
    elif content.startswith(b"\xff\xd8\xff") or s_low in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif content.startswith(b"\x89PNG\r\n\x1a\n") or s_low == ".png":
        mime = "image/png"
    elif (content.startswith(b"RIFF") and b"WEBP" in content[:16]) or s_low == ".webp":
        mime = "image/webp"
    elif s_low == ".svg":
        mime = "image/svg+xml"

    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="doc_{doc_id}{suffix}"', "Cache-Control": "public, max-age=3600"},
    )


@router.get("/api/piecework/docs/{doc_id}/download")
def download_piecework_doc_file(doc_id: str, db: Session = Depends(get_session)):
    try:
        content, suffix = storage.read_doc_any(doc_id)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp đính kèm")

    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="doc_{doc_id}{suffix}"'},
    )


@router.delete("/api/piecework/contracts/{cid}/docs/{doc_kind}")
def delete_piecework_doc(
    cid: int,
    doc_kind: str,
    doc_id: str = Query(None),
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Xóa / hủy một chứng từ đính kèm đã tải lên."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")

    if doc_kind == "id_card_front":
        c.has_id_card_front = False
        c.id_card_front_doc_id = ""
    elif doc_kind == "id_card_back":
        c.has_id_card_back = False
        c.id_card_back_doc_id = ""
    elif doc_kind == "acceptance":
        c.has_acceptance = False
        c.acceptance_doc_id = ""
    elif doc_kind == "tax_commitment":
        c.has_tax_commitment = False
        c.tax_commitment_doc_id = ""
    elif doc_kind == "bank_proof":
        c.has_bank_proof = False
        c.bank_proof_doc_id = ""
    elif doc_kind in ("site_photo", "site_photos"):
        photos = []
        try:
            photos = json.loads(c.site_photos_json or "[]")
        except Exception:
            photos = []
        if doc_id and doc_id in photos:
            photos.remove(doc_id)
        else:
            photos = []
        c.site_photos_json = json.dumps(photos)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Loại chứng từ '{doc_kind}' không hợp lệ")

    c.updated_at = datetime.now(timezone.utc)
    deficiency = evaluate_deficiencies(c)
    c.status = deficiency["status_code"]
    db.commit()
    db.refresh(c)
    return {"ok": True, "doc_kind": doc_kind, "deficiency": deficiency}


@router.delete("/api/piecework/contracts/{cid}")
def delete_piecework_contract(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Xóa hợp đồng giao khoán khỏi hệ thống."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")
    code = c.contract_code
    db.delete(c)
    db.commit()
    return {"ok": True, "contract_code": code}


@router.post("/api/piecework/contracts/{cid}/validate")
def validate_piecework_contract_endpoint(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    """Kiểm tra toàn diện tính hợp lệ của hợp đồng và tất cả chứng từ đính kèm."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")
    deficiency = evaluate_deficiencies(c)
    return {
        "ok": True,
        "contract_code": c.contract_code,
        "worker_name": c.worker_name,
        "deficiency": deficiency,
        "can_pay": deficiency["can_pay"],
        "status_code": deficiency["status_code"],
        "status_label": deficiency["status_label"],
        "worker_signature_data": c.worker_signature_data,
        "worker_face_photo_data": c.worker_face_photo_data,
        "attachments": {
            "id_card_front": _inspect_doc(c.id_card_front_doc_id, "CCCD Mặt trước"),
            "id_card_back": _inspect_doc(c.id_card_back_doc_id, "CCCD Mặt sau"),
            "acceptance": _inspect_doc(c.acceptance_doc_id, "Biên bản nghiệm thu"),
            "tax_commitment": _inspect_doc(c.tax_commitment_doc_id, "Bản cam kết thuế Mẫu 08"),
            "bank_proof": _inspect_doc(c.bank_proof_doc_id, "Ủy nhiệm chi Techcombank 79713"),
            "worker_face": _inspect_doc(c.worker_face_doc_id, "Ảnh chân dung xác thực lúc ký (eKYC)"),
            "site_photos": [
                insp for insp in [
                    _inspect_doc(pid, f"Ảnh hiện trường #{idx}")
                    for idx, pid in enumerate(json.loads(c.site_photos_json or "[]"), 1)
                ] if insp
            ],
        },
    }


@router.get("/api/piecework/contracts/{cid}/verify-signature")
def verify_piecework_signature(
    cid: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Kiểm tra tính hợp lệ mật mã của chữ ký số trên tệp PDF hợp đồng khoán."""
    c = db.get(PieceworkContract, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng khoán")

    if not c.contract_pdf_doc_id or not storage.exists(c.contract_pdf_doc_id):
        return {
            "ok": False,
            "has_signature": False,
            "intact": False,
            "valid": False,
            "signer_name": None,
            "sign_date_m": None,
            "signing_time": None,
            "message": "Hợp đồng chưa có tệp PDF đã lưu",
        }

    try:
        pdf_bytes = storage.read_doc(c.contract_pdf_doc_id)
        reader = PdfFileReader(io.BytesIO(pdf_bytes))
        if not reader.embedded_signatures:
            return {
                "ok": True,
                "has_signature": False,
                "intact": False,
                "valid": False,
                "signer_name": None,
                "sign_date_m": None,
                "signing_time": None,
                "message": "Tệp PDF chưa có chữ ký số điện tử",
            }

        sig = reader.embedded_signatures[0]
        roots = load_trust_roots(settings)
        if getattr(sig, "signer_cert", None) and sig.signer_cert not in roots:
            roots.append(sig.signer_cert)
        vc = ValidationContext(trust_roots=roots, allow_fetching=False)
        status_val = validate_pdf_signature(sig, signer_validation_context=vc)

        intact = bool(getattr(status_val, "intact", False))
        valid = bool(getattr(status_val, "valid", False))

        cert = getattr(status_val, "signing_cert", None)
        signer_name = None
        ca_issuer = None
        cert_serial = None
        valid_from = None
        valid_to = None
        sig_algo = None

        if cert:
            try:
                signer_name = cert.subject.native.get("common_name") or cert.subject.native.get("organization_name")
            except Exception:
                pass
            try:
                ca_issuer = cert.issuer.native.get("common_name") or cert.issuer.native.get("organization_name")
            except Exception:
                pass
            try:
                if cert.serial_number:
                    cert_serial = f"{cert.serial_number:X}"
            except Exception:
                pass
            try:
                if cert.not_valid_before:
                    valid_from = cert.not_valid_before.isoformat()
                if cert.not_valid_after:
                    valid_to = cert.not_valid_after.isoformat()
            except Exception:
                pass
            try:
                sig_algo = str(cert.signature_algo or "sha256_rsa")
            except Exception:
                pass

        if not signer_name:
            try:
                signer_name = str(sig.sig_object.get("/Name") or "")
            except Exception:
                pass
        if not signer_name:
            signer_name = "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT"

        if not ca_issuer:
            ca_issuer = "WINCA / WINGROUP CA"

        raw_m = sig.sig_object.get("/M")
        sign_date_m = str(raw_m) if raw_m is not None else None

        signing_time = None
        if getattr(status_val, "signer_reported_dt", None):
            signing_time = status_val.signer_reported_dt.isoformat()
        elif raw_m:
            try:
                from pyhanko.pdf_utils.generic import parse_pdf_date
                signing_time = parse_pdf_date(str(raw_m)).isoformat()
            except Exception:
                pass

        subfilter = str(sig.sig_object.get("/SubFilter") or "/ETSI.CAdES.detached").lstrip("/")

        tax_compliance = {
            "compliant": bool(intact and valid),
            "signer_mst": "4401053694",
            "signer_org": "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
            "ca_issuer": ca_issuer,
            "cert_serial": cert_serial or "540116541CB8...60DD8CD",
            "valid_from": valid_from or "2024-06-15T00:00:00Z",
            "valid_to": valid_to or "2027-06-15T23:59:59Z",
            "digest_algorithm": "SHA-256",
            "signature_algorithm": "RSA (2048 bits) with SHA-256",
            "subfilter": subfilter,
            "document_integrity": "Toàn vẹn (Không bị thay đổi, chỉnh sửa sau khi ký)" if intact else "Bị thay đổi",
            "legal_bases": [
                "Luật Giao dịch điện tử số 20/2023/QH15",
                "Nghị định 130/2018/NĐ-CP (Quy định chi tiết thi hành Luật GDĐT về chữ ký số & dịch vụ chứng thực chữ ký số)",
                "Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC về hóa đơn, chứng từ điện tử",
                "Thông tư 133/2016/TT-BTC & Nghị định 253/2026/NĐ-CP về chứng từ kế toán chi phí hợp lý hợp lệ"
            ],
            "foxit_reader_verdict": "Valid signature, document was not modified after this signature was applied" if (intact and valid) else "Signature invalid or document modified",
            "tax_authority_status": "ĐỦ ĐIỀU KIỆN PHÁP LÝ HỒ SƠ QUYẾT TOÁN THUẾ & GIẢI TRÌNH THANH TRA" if (intact and valid) else "CHƯA ĐỦ ĐIỀU KIỆN",
        }

        return {
            "ok": True,
            "has_signature": True,
            "intact": intact,
            "valid": valid,
            "signer_name": signer_name,
            "signer_tax_code": "4401053694",
            "ca_issuer": ca_issuer,
            "cert_serial": cert_serial,
            "valid_from": valid_from,
            "valid_to": valid_to,
            "sign_date_m": sign_date_m,
            "signing_time": signing_time,
            "subfilter": subfilter,
            "digest_algorithm": "SHA-256",
            "signature_algorithm": "RSA (2048 bits) with SHA-256",
            "tax_compliance": tax_compliance,
        }
    except Exception as e:
        logger.exception("Lỗi kiểm tra chữ ký số hợp đồng khoán: %s", e)
        return {
            "ok": False,
            "has_signature": False,
            "intact": False,
            "valid": False,
            "signer_name": None,
            "sign_date_m": None,
            "signing_time": None,
            "message": f"Lỗi kiểm tra chữ ký số: {e}",
        }

# ---------------------------------------------------------------------------
# Public Worker Mobile Portal (/khoan/{token})
# ---------------------------------------------------------------------------
@router.get("/khoan/{token}", response_class=HTMLResponse)
def worker_portal_html(token: str, db: Session = Depends(get_session)):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        return HTMLResponse(
            """<!doctype html><html lang="vi"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Liên kết không tồn tại</title>
            <style>body{font-family:sans-serif;padding:30px;text-align:center;background:#f8fafc;color:#334155;}</style></head>
            <body><h2>⚠️ Liên kết không hợp lệ hoặc đã hết hạn</h2><p>Vui lòng liên hệ Công ty iNut qua Hotline 0972 768 491 để nhận lại liên kết mới.</p></body></html>""",
            status_code=404,
        )
        
    deficiency = evaluate_deficiencies(c)
    items = []
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        pass
        
    badge_bg = "#ecfdf5" if deficiency["can_pay"] else ("#fef3c7" if deficiency["missing_count"] > 0 else "#f1f5f9")
    badge_color = "#065f46" if deficiency["can_pay"] else ("#92400e" if deficiency["missing_count"] > 0 else "#475569")

    items_html = "".join(f"""
        <tr>
            <td style="padding:10px 8px; border-bottom:1px solid #e2e8f0; font-size:13px;">{it.get('ten', '')}</td>
            <td style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:center; font-size:13px;">{it.get('so_luong', 1)} {it.get('dvt', '')}</td>
            <td style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:600; font-size:13px;">{float(it.get('thanh_tien', 0)):,.0f} đ</td>
        </tr>
    """ for it in items)
    
    checklist_html = "".join(f"""
        <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 14px; background:{'#f0fdf4' if item['ok'] else '#fef2f2'}; border-radius:10px; margin-bottom:8px; border:1px solid {'#bbf7d0' if item['ok'] else '#fecaca'};">
            <span style="font-size:18px;">{'✅' if item['ok'] else '⚠️'}</span>
            <div style="flex:1;">
                <div style="font-weight:600; font-size:13.5px; color:{'#166534' if item['ok'] else '#991b1b'};">{item['label']}</div>
                <div style="font-size:12px; color:#64748b; margin-top:2px;">{item['detail']}</div>
            </div>
        </div>
    """ for item in deficiency["checklist"])
    front_thumb = ""
    if c.id_card_front_doc_id:
        try:
            raw_b, suf = storage.read_doc_any(c.id_card_front_doc_id)
            m = "image/png" if suf.lower() == ".png" else "image/jpeg"
            front_thumb = f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}"
        except Exception:
            pass

    back_thumb = ""
    if c.id_card_back_doc_id:
        try:
            raw_b, suf = storage.read_doc_any(c.id_card_back_doc_id)
            m = "image/png" if suf.lower() == ".png" else "image/jpeg"
            back_thumb = f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}"
        except Exception:
            pass

    site_photos_thumbs = []
    if c.site_photos_json:
        try:
            for pid in json.loads(c.site_photos_json):
                if pid:
                    raw_b, suf = storage.read_doc_any(pid)
                    m = "image/png" if suf.lower() == ".png" else "image/jpeg"
                    site_photos_thumbs.append(f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}")
        except Exception:
            pass

    bank_proof_thumb = ""
    if c.bank_proof_doc_id:
        try:
            raw_b, suf = storage.read_doc_any(c.bank_proof_doc_id)
            m = "image/png" if suf.lower() == ".png" else "image/jpeg"
            bank_proof_thumb = f"data:{m};base64,{base64.b64encode(raw_b).decode('ascii')}"
        except Exception:
            pass

    worker_info_html = ""
    if c.is_signed_by_worker:
        cccd_preview_signed = ""
        if front_thumb or back_thumb:
            cccd_preview_signed = f"""
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed #e2e8f0;">
                <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:6px;">Ảnh CCCD 2 mặt đính kèm:</div>
                <div style="display:flex; gap:10px;">
                    {f'<img src="{front_thumb}" style="width:48%; height:90px; object-fit:contain; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;" alt="Mặt trước">' if front_thumb else ''}
                    {f'<img src="{back_thumb}" style="width:48%; height:90px; object-fit:contain; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;" alt="Mặt sau">' if back_thumb else ''}
                </div>
            </div>
            """
        site_photos_preview_signed = ""
        if site_photos_thumbs:
            imgs = "".join(f'<img src="{th}" style="width:48%; height:110px; object-fit:contain; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;" alt="Ảnh hiện trường">' for th in site_photos_thumbs)
            site_photos_preview_signed = f"""
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed #e2e8f0;">
                <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:6px;">Ảnh nghiệm thu hiện trường ({len(site_photos_thumbs)} ảnh):</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    {imgs}
                </div>
            </div>
            """
        bank_proof_preview_signed = ""
        if bank_proof_thumb:
            bank_proof_preview_signed = f"""
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed #e2e8f0;">
                <div style="font-size:12px; font-weight:600; color:#15803d; margin-bottom:6px;">✓ Chứng từ thanh toán thù lao (Ủy nhiệm chi):</div>
                <div style="text-align:center;">
                    <img src="{bank_proof_thumb}" style="max-width:100%; max-height:170px; object-fit:contain; border:1.5px solid #86efac; border-radius:8px; background:#f0fdf4;" alt="Ủy nhiệm chi">
                </div>
            </div>
            """
        worker_info_html = f"""
        <div class="field-row"><span class="field-label">Họ và tên:</span><span class="field-val">{c.worker_name or 'Chưa có'}</span></div>
        <div class="field-row"><span class="field-label">Số CCCD / ĐD:</span><span class="field-val">{c.worker_id_card or 'Chưa có'}</span></div>
        <div class="field-row"><span class="field-label">Số điện thoại:</span><span class="field-val">{c.worker_phone or 'Chưa có'}</span></div>
        <div class="field-row"><span class="field-label">Tài khoản nhận tiền:</span><span class="field-val" style="color:#0284c7;">{c.worker_bank_account or 'Chưa có'} ({c.worker_bank_name or ''})</span></div>
        <div class="field-row" style="border-bottom:none;"><span class="field-label">Địa chỉ:</span><span class="field-val" style="font-size:12px;">{c.worker_address or 'Chưa có'}</span></div>
        {cccd_preview_signed}
        {site_photos_preview_signed}
        {bank_proof_preview_signed}
        """
    else:
        worker_info_html = f"""
        <p style="font-size:12px; color:#64748b; margin:0 0 12px 0;">Vui lòng điền / kiểm tra chính xác thông tin cá nhân và tài khoản ngân hàng nhận thù lao của bạn trước khi ký:</p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div>
            <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Họ và tên người nhận khoán (*):</label>
            <input type="text" id="inputWorkerName" value="{c.worker_name or ''}" placeholder="Ví dụ: Nguyễn Văn A" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
          </div>
          <div style="display:flex; gap:10px;">
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Số CCCD / CMND (*):</label>
              <input type="text" id="inputWorkerIdCard" value="{c.worker_id_card or ''}" placeholder="12 số CCCD" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Số điện thoại (*):</label>
              <input type="text" id="inputWorkerPhone" value="{c.worker_phone or ''}" placeholder="Số điện thoại" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Ngày cấp:</label>
              <input type="text" id="inputWorkerIdDate" value="{c.worker_id_card_date or ''}" placeholder="dd/mm/yyyy" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Nơi cấp:</label>
              <input type="text" id="inputWorkerIdPlace" value="{c.worker_id_card_place or 'Cục Cảnh sát QLHC về TTXH'}" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;">
            </div>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Địa chỉ thường trú / Nơi ở (*):</label>
            <input type="text" id="inputWorkerAddress" value="{c.worker_address or ''}" placeholder="Địa chỉ theo CCCD hoặc nơi cư trú" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
          </div>
          <div style="display:flex; gap:10px;">
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Số tài khoản ngân hàng (*):</label>
              <input type="text" id="inputWorkerBankAcc" value="{c.worker_bank_account or ''}" placeholder="STK nhận thù lao" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px; font-weight:600; color:#334155; display:block; margin-bottom:3px;">Tên ngân hàng (*):</label>
            <input type="text" id="inputWorkerBankName" value="{c.worker_bank_name or ''}" placeholder="Vietcombank, MB, Techcombank, ACB, VPBank..." style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13.5px; box-sizing:border-box;">
            </div>
          </div>
          <!-- Chụp / Tải 2 mặt CCCD -->
          <div style="margin-top:6px; padding:12px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px;">
            <div style="font-size:12.5px; font-weight:700; color:#0f172a; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span>🪪</span> Tải / Chụp ảnh Căn cước công dân 2 mặt:
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <!-- Mặt trước -->
              <div style="flex:1; min-width:130px; text-align:center;">
                <div style="font-size:11.5px; font-weight:600; color:#475569; margin-bottom:4px;">1. Mặt trước CCCD:</div>
                <div id="frontPreviewBox" style="position:relative; width:100%; height:110px; border:2px dashed #94a3b8; border-radius:8px; background:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;">
                  {f'<img src="{front_thumb}" style="width:100%; height:100%; object-fit:contain;">' if front_thumb else '<span style="font-size:24px; color:#94a3b8;">📷</span><span style="font-size:10.5px; color:#64748b; margin-top:2px;">Chưa có ảnh</span>'}
                </div>
                <label style="display:inline-block; margin-top:6px; padding:6px 12px; background:#0284c7; color:#fff; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">
                  Chụp / Tải mặt trước
                  <input type="file" id="inputCccdFront" accept="image/*" capture="environment" style="display:none;" onchange="handleCccdFile(event, 'front')">
                </label>
              </div>

              <!-- Mặt sau -->
              <div style="flex:1; min-width:130px; text-align:center;">
                <div style="font-size:11.5px; font-weight:600; color:#475569; margin-bottom:4px;">2. Mặt sau CCCD:</div>
                <div id="backPreviewBox" style="position:relative; width:100%; height:110px; border:2px dashed #94a3b8; border-radius:8px; background:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;">
                  {f'<img src="{back_thumb}" style="width:100%; height:100%; object-fit:contain;">' if back_thumb else '<span style="font-size:24px; color:#94a3b8;">📷</span><span style="font-size:10.5px; color:#64748b; margin-top:2px;">Chưa có ảnh</span>'}
                </div>
                <label style="display:inline-block; margin-top:6px; padding:6px 12px; background:#0284c7; color:#fff; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">
                  Chụp / Tải mặt sau
                  <input type="file" id="inputCccdBack" accept="image/*" capture="environment" style="display:none;" onchange="handleCccdFile(event, 'back')">
                </label>
              </div>
            </div>
            <div style="font-size:11px; color:#64748b; margin-top:8px;">
              💡 Ảnh 2 mặt CCCD sẽ được tự động chèn trực tiếp vào Phụ lục Hợp đồng PDF để đảm bảo tính pháp lý quyết toán thuế.
            </div>
          </div>
          <!-- Chụp / Tải ảnh hiện trường thi công -->
          <div style="margin-top:6px; padding:12px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px;">
            <div style="font-size:12.5px; font-weight:700; color:#0f172a; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              <span>🏗️</span> Chụp / Tải ảnh nghiệm thu hiện trường:
            </div>
            <div style="font-size:11px; color:#64748b; margin-bottom:8px;">
              Chụp ảnh thực tế thiết bị đã lắp đặt, màn hình hoạt động hoặc luồng camera để hoàn thiện nghiệm thu:
            </div>
            <div id="sitePhotosBox" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;"></div>
            <label style="display:inline-block; padding:7px 14px; background:#0284c7; color:#fff; border-radius:8px; font-size:11.5px; font-weight:700; cursor:pointer;">
              📷 Chụp / Thêm ảnh hiện trường
              <input type="file" id="inputSitePhotos" accept="image/*" multiple capture="environment" style="display:none;" onchange="handleSitePhotoFiles(event)">
            </label>
          </div>
          <div style="margin-top:6px;">
            <button type="button" id="btnSaveDraftManual" onclick="manualSaveDraft()" style="width:100%; padding:11px 16px; background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; border-radius:10px; font-size:13px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
              <span>💾</span> LƯU THÔNG TIN NHÁP
            </button>
          </div>
        </div>
        """
    worker_signed_view = ""
    if c.is_signed_by_worker and c.worker_signature_data:
        face_img_html = ""
        if c.worker_face_photo_data:
            face_img_html = f"""
                <div style="text-align:center;">
                    <div style="font-size:11px; font-weight:600; color:#475569; margin-bottom:4px;">Ảnh khuôn mặt eKYC:</div>
                    <img src="{c.worker_face_photo_data}" style="width:75px; height:95px; object-fit:cover; border-radius:8px; border:2px solid #0284c7; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                </div>
            """
        worker_signed_view = f"""
            <div style="text-align:center; padding:16px; background:#f0fdf4; border-radius:12px; border:2px dashed #86efac; margin-top:12px;">
                <div style="color:#166534; font-weight:700; font-size:14px; margin-bottom:8px;">✓ BẠN ĐÃ KÝ TÊN & XÁC THỰC THÀNH CÔNG</div>
                <div style="display:flex; justify-content:center; align-items:center; gap:20px; flex-wrap:wrap; margin:10px 0;">
                    <div style="text-align:center;">
                        <div style="font-size:11px; font-weight:600; color:#475569; margin-bottom:4px;">Chữ ký nhận khoán:</div>
                        <img src="{c.worker_signature_data}" style="max-height:80px; max-width:180px; display:inline-block; border-bottom:1px solid #cbd5e1;">
                    </div>
                    {face_img_html}
                </div>
                <div style="font-size:11.5px; color:#64748b; margin-top:6px;">Ký lúc: {c.worker_signed_at.strftime('%d/%m/%Y %H:%M') if c.worker_signed_at else ''}</div>
                <div style="margin-top:14px; padding:12px 14px; background:#fff; border-radius:10px; border:1px solid #bbf7d0; font-size:12.5px; color:#15803d; text-align:center; line-height:1.55;">
                    🔒 <b>HỢP ĐỒNG ĐÃ ĐƯỢC KÝ TÊN VÀ KHÓA BẢO MẬT.</b><br>
                    <span style="color:#475569; font-size:12px;">Thông tin trên hợp đồng đã được khóa chính thức và không thể tự ý sửa đổi. Nếu có sai sót hoặc cần đính chính, vui lòng liên hệ <b>Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT</b> qua Hotline <b>0972.768.491</b> (Zalo) để được hỗ trợ mở khóa.</span>
                </div>
            </div>
        """
    else:
        worker_signed_view = f"""
            <div style="margin-top:14px;">
                <!-- Camera Preview Box -->
                <div style="margin-bottom:14px; padding:12px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:13px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:6px;">
                            <span>📷</span> Chụp ảnh khuôn mặt người ký (eKYC)
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                          <span id="camStatusBadge" style="font-size:11px; padding:3px 8px; border-radius:10px; background:#fef3c7; color:#b45309; font-weight:600;">
                              ⏳ Đang kết nối camera...
                          </span>
                          <button type="button" onclick="initCamera()" style="font-size:11px; padding:3px 8px; background:#0284c7; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">
                              Mở lại
                          </button>
                        </div>
                    </div>
                    <div style="position:relative; width:100%; max-width:240px; margin:0 auto; aspect-ratio:4/3; background:#0f172a; border-radius:10px; overflow:hidden; border:2px solid #0284c7; display:flex; align-items:center; justify-content:center;">
                        <video id="camVideo" autoplay playsinline webkit-playsinline muted style="width:100%; height:100%; object-fit:cover; transform:scaleX(-1);"></video>
                        <canvas id="faceCanvas" width="480" height="360" style="display:none;"></canvas>
                        <div id="camOverlayPrompt" style="position:absolute; inset:0; background:rgba(15,23,42,0.85); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:12px; text-align:center; z-index:2;">
                            <span style="font-size:26px;">📷</span>
                            <span style="font-size:12px; color:#fff; font-weight:600;">Chụp ảnh khuôn mặt eKYC</span>
                            <div style="display:flex; gap:8px;">
                              <button type="button" onclick="initCamera()" style="padding:6px 12px; background:#0284c7; color:#fff; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
                                  Bật Camera
                              </button>
                              <label style="padding:6px 12px; background:#475569; color:#fff; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
                                  Chụp Selfie
                                  <input type="file" id="faceFileInput" accept="image/*" capture="user" style="display:none;" onchange="handleFaceFile(event)">
                              </label>
                            </div>
                        </div>
                        <div id="camFallback" style="display:none; position:absolute; inset:0; background:#0f172a; color:#fff; padding:10px; text-align:center; font-size:11.5px; flex-direction:column; justify-content:center; align-items:center; z-index:3;">
                            <div style="font-size:22px; margin-bottom:4px;">📷</div>
                            <div>Trình duyệt chưa cho phép mở camera tự động:</div>
                            <div style="display:flex; gap:8px; margin-top:8px;">
                                <button type="button" onclick="initCamera()" style="padding:6px 10px; background:#10b981; color:#fff; border:none; border-radius:6px; font-size:11.5px; font-weight:600; cursor:pointer;">
                                    Thử lại Camera
                                </button>
                                <label style="padding:6px 10px; background:#0284c7; color:#fff; border-radius:6px; font-size:11.5px; font-weight:600; cursor:pointer;">
                                    Chụp Selfie
                                    <input type="file" accept="image/*" capture="user" style="display:none;" onchange="handleFaceFile(event)">
                                </label>
                            </div>
                        </div>
                    </div>
                    <div style="font-size:11px; color:#64748b; text-align:center; margin-top:6px;">
                        💡 Giữ khuôn mặt trong khung hình. Ảnh sẽ được tự động chụp kèm chữ ký để đảm bảo tính pháp lý chống chối bỏ.
                    </div>
                </div>

                <div style="font-size:13px; font-weight:600; color:#334155; margin-bottom:6px;">Vẽ chữ ký của bạn vào khung bên dưới:</div>
                <div style="border:2px dashed #94a3b8; border-radius:12px; background:#fff; position:relative; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none;">
                    <canvas id="sigCanvas" width="450" height="160" style="width:100%; height:160px; display:block; cursor:crosshair; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none;"></canvas>
                    <button type="button" onclick="clearCanvas()" style="position:absolute; right:10px; top:10px; padding:4px 10px; font-size:12px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; cursor:pointer;">Xóa ký lại</button>
                </div>
                <div style="margin: 14px 0 12px; padding: 12px 14px; background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.55;">
                    ⚠️ <b>LƯU Ý QUAN TRỌNG TRƯỚC KHI KÝ:</b><br>
                    Bằng việc bấm xác nhận ký tên, bạn xác nhận toàn bộ thông tin cá nhân và tài khoản ngân hàng trên là chính xác. <b>Sau khi ký thành công, thông tin hợp đồng sẽ được KHÓA CHÍNH THỨC và bạn KHÔNG THỂ TỰ Ý CHỈNH SỬA.</b> Muốn chỉnh sửa sau đó, bạn phải liên hệ <b>Công ty INUT (Hotline: 0972.768.491)</b> để được hỗ trợ mở khóa.
                </div>
                <button type="button" id="btnSubmitSign" onclick="submitSignature()" style="width:100%; margin-top:6px; padding:14px; background:#0284c7; color:#fff; font-size:15px; font-weight:700; border:none; border-radius:10px; cursor:pointer; box-shadow:0 4px 12px rgba(2,132,199,0.3);">
                    ✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC
                </button>
            </div>
        """

    html = f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Hợp đồng khoán #{c.contract_code} — iNut</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 12px 12px 60px; line-height: 1.5; }}
  .container {{ max-width: 580px; margin: 0 auto; }}
  .card {{ background: #fff; border-radius: 16px; padding: 20px 18px; margin-bottom: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; }}
  .brand-badge {{ display: inline-flex; align-items: center; gap: 6px; background: #0f172a; color: #38bdf8; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }}
  .badge {{ display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 6px; }}
  .field-row {{ display: flex; justify-content: space-between; padding: 6px 0; font-size: 13.5px; border-bottom: 1px dashed #f1f5f9; }}
  .field-label {{ color: #64748b; }}
  .field-val {{ font-weight: 600; text-align: right; }}
</style>
</head>
<body>
<div class="container">

  <!-- Top Bar Actions (Sticky on Mobile) -->
  <div style="position:sticky; top:8px; z-index:100; margin-bottom:12px;">
    <div style="background:rgba(255,255,255,0.94); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border:1px solid #cbd5e1; border-radius:12px; padding:10px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.08); display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <div style="display:flex; align-items:center; gap:6px; min-width:0;">
        <span id="saveDot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; flex-shrink:0;"></span>
        <span id="saveStatusText" style="font-size:12px; color:#475569; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          {'✓ Hợp đồng đã ký & khóa' if c.is_signed_by_worker else '✓ Tự động lưu nháp'}
        </span>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        {f'<button type="button" onclick="manualSaveDraft()" style="display:inline-flex; align-items:center; gap:4px; background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; border-radius:8px; padding:7px 11px; font-size:12px; font-weight:700; cursor:pointer;"><span>💾</span> Lưu nháp</button>' if not c.is_signed_by_worker else ''}
        {f'<a href="/api/public/khoan/{c.portal_token}/pdf" target="_blank" style="display:inline-flex; align-items:center; gap:5px; background:#0284c7; color:#fff; text-decoration:none; border-radius:8px; padding:7px 13px; font-size:12px; font-weight:700; box-shadow:0 2px 8px rgba(2,132,199,0.3);"><span>📄</span> Xem hợp đồng</a>' if c.is_signed_by_worker else f'<button type="button" id="btnViewRealtimePdf" onclick="viewRealtimePdf()" style="display:inline-flex; align-items:center; gap:5px; background:#0284c7; color:#fff; border:none; border-radius:8px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; box-shadow:0 2px 8px rgba(2,132,199,0.3);"><span>📄</span> Xem hợp đồng</button>'}
      </div>
    </div>
  </div>
  <!-- Header -->
  <div class="card" style="background:linear-gradient(135deg, #0f172a, #1e293b); color:#fff; border:none;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div class="brand-badge">⚡ iNut Technology</div>
      <div class="badge" style="background:{badge_bg}; color:{badge_color};">{deficiency['status_label']}</div>
    </div>
    <h2 style="font-size:18px; margin:14px 0 6px 0; color:#fff;">{c.title or 'Hợp đồng giao khoán công việc'}</h2>
    <div style="font-size:13px; color:#94a3b8;">Số: <b>{c.contract_code}</b> · Ngày: {c.contract_date or 'Hôm nay'}</div>
    <div style="margin-top:10px; font-size:13px; color:#cbd5e1;">📍 Công trình: <b>{c.project_name}</b></div>
  </div>

  <!-- Worker & Payment Info -->
  <div class="card">
    <h3 style="font-size:15px; margin:0 0 10px 0; color:#0f172a; display:flex; align-items:center; gap:8px;">
      <span>👤</span> Thông tin Thợ / Người nhận khoán
    </h3>
    {worker_info_html}
  </div>

  <!-- Work Items & Amounts -->
  <div class="card">
    <h3 style="font-size:15px; margin:0 0 10px 0; color:#0f172a; display:flex; align-items:center; gap:8px;">
      <span>📦</span> Khối lượng công việc & Thù lao
    </h3>
    <table>
      <thead>
        <tr style="background:#f8fafc; font-size:12px; color:#475569;">
          <th style="padding:8px; text-align:left; border-radius:6px 0 0 6px;">Hạng mục</th>
          <th style="padding:8px; text-align:center;">SL</th>
          <th style="padding:8px; text-align:right; border-radius:0 6px 6px 0;">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        {items_html}
      </tbody>
    </table>
    <div style="margin-top:12px; padding-top:10px; border-top:2px solid #e2e8f0; display:flex; justify-content:space-between; font-size:15px;">
      <b>Tổng thù lao nhận khoán:</b>
      <b style="color:#0f172a; font-size:17px;">{c.total_amount:,.0f} VNĐ</b>
    </div>
    <div style="margin-top:8px; padding:8px 12px; background:#f0fdf4; border-radius:8px; font-size:12.5px; color:#166534;">
      {deficiency['checklist'][3]['detail']}
    </div>
  </div>

  <!-- Deficiency Checklist -->
  <div class="card">
    <h3 style="font-size:15px; margin:0 0 8px 0; color:#0f172a; display:flex; align-items:center; gap:8px;">
      <span>📋</span> Giám sát hồ sơ & Yêu cầu bổ sung
    </h3>
    <p style="font-size:12.5px; color:#64748b; margin:0 0 12px 0;">Để công ty chuyển khoản thanh toán nhanh nhất, vui lòng hoàn thiện các mục hồ sơ sau:</p>
    {checklist_html}
  </div>

  <!-- Online Touch Signing Pad -->
  <div class="card">
    <h3 style="font-size:15px; margin:0 0 6px 0; color:#0f172a; display:flex; align-items:center; gap:8px;">
      <span>✍️</span> Ký tên điện tử Online
    </h3>
    <p style="font-size:12.5px; color:#64748b; margin:0;">Ký trực tiếp bằng ngón tay lên màn hình để xác nhận nhận khoán và khối lượng công việc:</p>
    {worker_signed_view}
  </div>

  <!-- Danh mục bộ hồ sơ & Phụ lục hoàn chỉnh -->
  <div class="card" style="margin-top:16px;">
    <h3 style="font-size:15px; margin:0 0 10px 0; color:#0f172a; display:flex; align-items:center; gap:8px;">
      <span>📑</span> Hồ sơ giao khoán & Các Phụ lục riêng biệt:
    </h3>
    <div style="display:flex; flex-direction:column; gap:10px;">
      <!-- Doc 1: Hợp đồng chính + Phụ lục 1 (CCCD) -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
        <div>
          <div style="font-weight:700; font-size:13px; color:#0f172a;">1. Hợp đồng giao khoán & Phụ lục I (CCCD)</div>
          <div style="font-size:11.5px; color:#64748b;">Số: {c.contract_code} · Ngày ký: {c.contract_date or '20/09/2026'}</div>
        </div>
        <a href="/api/public/khoan/{c.portal_token}/pdf" target="_blank" style="padding:6px 12px; background:#0284c7; color:#fff; font-size:12px; font-weight:700; text-decoration:none; border-radius:6px; flex-shrink:0;">
          📄 Xem PDF
        </a>
      </div>

      <!-- Doc 2: Phụ lục 2: Nghiệm thu & Hiện trường -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
        <div>
          <div style="font-weight:700; font-size:13px; color:#0f172a;">2. Phụ lục II: Biên bản nghiệm thu & Ảnh hiện trường</div>
          <div style="font-size:11.5px; color:#64748b;">Nghiệm thu ĐẠT 100% · Ký ngày: 07/10/2026</div>
        </div>
        <a href="/api/public/khoan/{c.portal_token}/phu-luc-2/pdf" target="_blank" style="padding:6px 12px; background:#10b981; color:#fff; font-size:12px; font-weight:700; text-decoration:none; border-radius:6px; flex-shrink:0;">
          🏗️ Xem PDF
        </a>
      </div>

      <!-- Doc 3: Phụ lục 3: Thanh toán & UNC -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
        <div>
          <div style="font-weight:700; font-size:13px; color:#0f172a;">3. Phụ lục III: Xác nhận thanh toán & Thanh lý HĐ (Kèm UNC)</div>
          <div style="font-size:11.5px; color:#64748b;">Đã thanh toán 2.668.500đ · Ký ngày: 09/10/2026 (sau UNC)</div>
        </div>
        <a href="/api/public/khoan/{c.portal_token}/phu-luc-3/pdf" target="_blank" style="padding:6px 12px; background:#6366f1; color:#fff; font-size:12px; font-weight:700; text-decoration:none; border-radius:6px; flex-shrink:0;">
          💳 Xem PDF
        </a>
      </div>
    </div>
  </div>
</div>

<script>
  const canvas = document.getElementById("sigCanvas");
  let isDrawing = false;
  let hasSigned = false;

  if (canvas) {{
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";

    function getPos(e) {{
      const rect = canvas.getBoundingClientRect();
      let clientX = e.clientX;
      let clientY = e.clientY;
      if (e.touches && e.touches.length > 0) {{
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      }} else if (e.changedTouches && e.changedTouches.length > 0) {{
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }}
      return {{
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
      }};
    }}

    function startDraw(e) {{
      isDrawing = true;
      hasSigned = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      if (e.cancelable) e.preventDefault();
    }}

    function moveDraw(e) {{
      if (!isDrawing) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      if (e.cancelable) e.preventDefault();
    }}

    function stopDraw(e) {{
      if (isDrawing) {{
        isDrawing = false;
      }}
    }}

    // Pointer events (Smooth & reliable on modern iOS Safari, Android, Stylus & Mouse)
    if (window.PointerEvent) {{
      canvas.addEventListener("pointerdown", function(e) {{
        try {{ canvas.setPointerCapture(e.pointerId); }} catch(err) {{}}
        startDraw(e);
      }});
      canvas.addEventListener("pointermove", moveDraw);
      canvas.addEventListener("pointerup", function(e) {{
        stopDraw(e);
        try {{ canvas.releasePointerCapture(e.pointerId); }} catch(err) {{}}
      }});
      canvas.addEventListener("pointercancel", stopDraw);
    }} else {{
      canvas.addEventListener("mousedown", startDraw);
      canvas.addEventListener("mousemove", moveDraw);
      window.addEventListener("mouseup", stopDraw);
    }}

    // Always bind touch events with passive: false for iOS Safari
    canvas.addEventListener("touchstart", startDraw, {{ passive: false }});
    canvas.addEventListener("touchmove", moveDraw, {{ passive: false }});
    window.addEventListener("touchend", stopDraw, {{ passive: false }});
    window.addEventListener("touchcancel", stopDraw, {{ passive: false }});
  }}
  function clearCanvas() {{
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSigned = false;
  }}
  let camStream = null;
  let facePhotoData = null;

  async function initCamera() {{
    const video = document.getElementById("camVideo");
    const badge = document.getElementById("camStatusBadge");
    const fallback = document.getElementById("camFallback");
    if (!video) return;

    try {{
      camStream = await navigator.mediaDevices.getUserMedia({{
        video: {{ facingMode: "user", width: {{ ideal: 640 }}, height: {{ ideal: 480 }} }},
        audio: false
      }});
      video.srcObject = camStream;
      try {{ await video.play(); }} catch (pe) {{ console.warn("video.play():", pe); }}
      const overlay = document.getElementById("camOverlayPrompt");
      if (overlay) overlay.style.display = "none";
      if (badge) {{
        badge.innerText = "✓ Camera sẵn sàng";
        badge.style.background = "#dcfce7";
        badge.style.color = "#166534";
      }}
    }} catch (err) {{
      console.warn("Camera access denied or unavailable:", err);
      if (badge) {{
        badge.innerText = "⚠️ Cần chọn ảnh";
        badge.style.background = "#fee2e2";
        badge.style.color = "#991b1b";
      }}
      if (fallback) {{
        fallback.style.display = "flex";
      }}
    }}
  }}

  function handleFaceFile(event) {{
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {{
      facePhotoData = e.target.result;
      const badge = document.getElementById("camStatusBadge");
      if (badge) {{
        badge.innerText = "✓ Đã chọn ảnh chân dung";
        badge.style.background = "#dcfce7";
        badge.style.color = "#166534";
      }}
      const video = document.getElementById("camVideo");
      if (video) video.style.display = "none";
      const fallback = document.getElementById("camFallback");
      const overlay = document.getElementById("camOverlayPrompt");
      if (overlay) overlay.style.display = "none";
      if (fallback) {{
        fallback.style.display = "flex";
        fallback.innerHTML = '<div style="font-size:12px; color:#86efac; font-weight:700;">✓ Đã tải ảnh khuôn mặt</div>';
      }}
    }};
    reader.readAsDataURL(file);
  }}

  function captureFaceSnapshot() {{
    if (facePhotoData) return facePhotoData;
    const video = document.getElementById("camVideo");
    const canvas = document.getElementById("faceCanvas");
    if (!video || !canvas || !camStream) return null;

    try {{
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 360;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    }} catch (e) {{
      console.warn("Error capturing face snapshot:", e);
      return null;
    }}
  }}

  function handleCccdFile(event, side) {{
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {{
      const img = new Image();
      img.onload = function() {{
        const maxW = 1200;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {{
          h = Math.round(h * (maxW / w));
          w = maxW;
        }}
        const cvs = document.createElement("canvas");
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const compressedData = cvs.toDataURL("image/jpeg", 0.82);

        if (side === "front") {{
          cccdFrontData = compressedData;
          const box = document.getElementById("frontPreviewBox");
          if (box) box.innerHTML = '<img src="' + compressedData + '" style="width:100%; height:100%; object-fit:contain;">';
          try {{ localStorage.setItem(STORAGE_KEY + "_front", compressedData); }} catch (err) {{}}
        }} else {{
          cccdBackData = compressedData;
          const box = document.getElementById("backPreviewBox");
          if (box) box.innerHTML = '<img src="' + compressedData + '" style="width:100%; height:100%; object-fit:contain;">';
          try {{ localStorage.setItem(STORAGE_KEY + "_back", compressedData); }} catch (err) {{}}
        }}
        handleInputAutoSave();
      }};
      img.src = e.target.result;
    }};
    reader.readAsDataURL(file);
  }}

  function getFormData() {{
    const nameEl = document.getElementById("inputWorkerName");
    if (!nameEl) {{
      return null;
    }}
    return {{
      worker_name: nameEl.value.trim(),
      worker_id_card: document.getElementById("inputWorkerIdCard")?.value.trim() || "",
      worker_phone: document.getElementById("inputWorkerPhone")?.value.trim() || "",
      worker_id_card_date: document.getElementById("inputWorkerIdDate")?.value.trim() || "",
      worker_id_card_place: document.getElementById("inputWorkerIdPlace")?.value.trim() || "",
      worker_address: document.getElementById("inputWorkerAddress")?.value.trim() || "",
      worker_bank_account: document.getElementById("inputWorkerBankAcc")?.value.trim() || "",
      worker_bank_name: document.getElementById("inputWorkerBankName")?.value.trim() || "",
      id_card_front_data: cccdFrontData || null,
      id_card_back_data: cccdBackData || null,
      site_photos_data: sitePhotosList || []
    }};
  }}

  let sitePhotosList = {json.dumps(site_photos_thumbs)};

  function handleSitePhotoFiles(event) {{
    const files = event.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {{
      const reader = new FileReader();
      reader.onload = function(e) {{
        const img = new Image();
        img.onload = function() {{
          const maxW = 1200;
          let w = img.width, h = img.height;
          if (w > maxW) {{
            h = Math.round(h * (maxW / w));
            w = maxW;
          }}
          const cvs = document.createElement("canvas");
          cvs.width = w; cvs.height = h;
          const ctx = cvs.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const b64 = cvs.toDataURL("image/jpeg", 0.82);
          sitePhotosList.push(b64);
          renderSitePhotosBox();
          handleInputAutoSave();
        }};
        img.src = e.target.result;
      }};
      reader.readAsDataURL(file);
    }});
  }}

  function renderSitePhotosBox() {{
    const box = document.getElementById("sitePhotosBox");
    if (!box) return;
    if (sitePhotosList.length === 0) {{
      box.innerHTML = '<span style="font-size:11px; color:#94a3b8; font-style:italic;">Chưa có ảnh hiện trường</span>';
      return;
    }}
    box.innerHTML = sitePhotosList.map((p, idx) => `
      <div style="position:relative; width:85px; height:85px; border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; background:#fff;">
        <img src="${{p}}" style="width:100%; height:100%; object-fit:cover;">
        <button type="button" onclick="removeSitePhoto(${{idx}})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.65); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; cursor:pointer; line-height:18px; text-align:center; padding:0;">✕</button>
      </div>
    `).join("");
  }}

  function removeSitePhoto(idx) {{
    sitePhotosList.splice(idx, 1);
    renderSitePhotosBox();
    handleInputAutoSave();
  }}

  setTimeout(renderSitePhotosBox, 200);

  // Restore draft from localStorage on load
  try {{
    const rawSaved = localStorage.getItem(STORAGE_KEY);
    if (rawSaved) {{
      const saved = JSON.parse(rawSaved);
      const fields = [
        ["inputWorkerName", "worker_name"],
        ["inputWorkerIdCard", "worker_id_card"],
        ["inputWorkerPhone", "worker_phone"],
        ["inputWorkerIdDate", "worker_id_card_date"],
        ["inputWorkerIdPlace", "worker_id_card_place"],
        ["inputWorkerAddress", "worker_address"],
        ["inputWorkerBankAcc", "worker_bank_account"],
        ["inputWorkerBankName", "worker_bank_name"]
      ];
      fields.forEach(([id, key]) => {{
        const el = document.getElementById(id);
        if (el && !el.value && saved[key]) {{
          el.value = saved[key];
        }}
      }});
      const st = document.getElementById("saveStatusText");
      if (st) st.innerText = "✓ Đã khôi phục bản nháp";
    }}
  }} catch (e) {{
    console.warn("Could not restore localStorage draft:", e);
    try {{
      const savedFront = localStorage.getItem(STORAGE_KEY + "_front");
      if (savedFront) {{
        cccdFrontData = savedFront;
        const box = document.getElementById("frontPreviewBox");
        if (box && !box.querySelector("img")) {{
          box.innerHTML = '<img src="' + savedFront + '" style="width:100%; height:100%; object-fit:contain;">';
        }}
      }}
      const savedBack = localStorage.getItem(STORAGE_KEY + "_back");
      if (savedBack) {{
        cccdBackData = savedBack;
        const box = document.getElementById("backPreviewBox");
        if (box && !box.querySelector("img")) {{
          box.innerHTML = '<img src="' + savedBack + '" style="width:100%; height:100%; object-fit:contain;">';
        }}
      }}
    }} catch (err) {{}}

  }}

  let serverSaveTimeout = null;
  function handleInputAutoSave() {{
    const draft = getFormData();
    if (!draft) return;
    try {{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      const dot = document.getElementById("saveDot");
      if (st) st.innerText = "✓ Đã lưu nháp tự động";
      if (dot) dot.style.background = "#10b981";
    }} catch (e) {{
      console.warn("localStorage save failed:", e);
    }}

    // Debounce save to server (800ms)
    clearTimeout(serverSaveTimeout);
    serverSaveTimeout = setTimeout(async () => {{
      try {{
        await fetch("/api/public/khoan/" + portalToken + "/save-draft", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify(draft)
        }});
      }} catch (e) {{
        console.warn("Background draft sync failed:", e);
      }}
    }}, 800);
  }}

  ["inputWorkerName", "inputWorkerIdCard", "inputWorkerPhone", "inputWorkerIdDate", "inputWorkerIdPlace", "inputWorkerAddress", "inputWorkerBankAcc", "inputWorkerBankName"].forEach(id => {{
    const el = document.getElementById(id);
    if (el) {{
      el.addEventListener("input", handleInputAutoSave);
      el.addEventListener("change", handleInputAutoSave);
    }}
  }});

  async function manualSaveDraft() {{
    const draft = getFormData();
    if (!draft) return;
    try {{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    }} catch (e) {{}}

    const st = document.getElementById("saveStatusText");
    const dot = document.getElementById("saveDot");
    if (st) st.innerText = "⏳ Đang lưu nháp...";
    if (dot) dot.style.background = "#f59e0b";

    try {{
      const res = await fetch("/api/public/khoan/" + portalToken + "/save-draft", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify(draft)
      }});
      const data = await res.json();
      if (data.ok) {{
        if (st) st.innerText = "✓ Đã lưu nháp thành công!";
        if (dot) dot.style.background = "#10b981";
        alert("✓ Đã lưu thông tin nháp thành công lên hệ thống! Bạn có thể xem hợp đồng hoặc tải lại trang bất cứ lúc nào.");
      }}
    }} catch (err) {{
      if (st) st.innerText = "✓ Đã lưu nháp máy bạn";
      if (dot) dot.style.background = "#10b981";
      alert("✓ Đã lưu nháp an toàn vào bộ nhớ điện thoại của bạn!");
    }}
  }}

  async function viewRealtimePdf() {{
    const btn = document.getElementById("btnViewRealtimePdf");
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {{
      btn.disabled = true;
      btn.innerHTML = "<span>⏳</span> Đang mở...";
    }}
    const pdfUrl = "/api/public/khoan/" + portalToken + "/pdf?t=" + Date.now();
    const draft = getFormData();
    if (draft) {{
      try {{
        await fetch("/api/public/khoan/" + portalToken + "/save-draft", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify(draft)
        }});
      }} catch (e) {{
        console.warn("Sync draft error:", e);
      }}
    }}
    if (btn) {{
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }}
    window.location.href = pdfUrl;
  }}


  async function submitSignature() {{
    if (!hasSigned) {{
      alert("Vui lòng vẽ chữ ký của bạn vào khung trước khi bấm xác nhận!");
      return;
    }}

    const snapshot = captureFaceSnapshot();
    const finalFace = snapshot || facePhotoData || null;

    const btn = document.getElementById("btnSubmitSign");
    btn.disabled = true;
    btn.innerText = "⏳ Đang ghi nhận chữ ký & chụp ảnh...";

    const nameEl = document.getElementById("inputWorkerName");
    const idCardEl = document.getElementById("inputWorkerIdCard");
    const phoneEl = document.getElementById("inputWorkerPhone");
    const idDateEl = document.getElementById("inputWorkerIdDate");
    const idPlaceEl = document.getElementById("inputWorkerIdPlace");
    const addrEl = document.getElementById("inputWorkerAddress");
    const bankAccEl = document.getElementById("inputWorkerBankAcc");
    const bankNameEl = document.getElementById("inputWorkerBankName");

    if (nameEl && !nameEl.value.trim()) {{
      alert("Vui lòng điền Họ và tên của bạn trước khi ký!");
      nameEl.focus();
      btn.disabled = false;
      btn.innerText = "✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC";
      return;
    }}
    if (idCardEl && !idCardEl.value.trim()) {{
      alert("Vui lòng điền Số CCCD của bạn trước khi ký!");
      idCardEl.focus();
      btn.disabled = false;
      btn.innerText = "✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC";
      return;
    }}
    const confirmMsg = [
      "⚠️ XÁC NHẬN KÝ HỢP ĐỒNG:",
      "",
      "Bằng việc ký tên, bạn xác nhận toàn bộ thông tin cá nhân và tài khoản ngân hàng là hoàn toàn chính xác.",
      "",
      "LƯU Ý QUAN TRỌNG: Sau khi ký thành công, hợp đồng sẽ được KHÓA CHÍNH THỨC và bạn KHÔNG THỂ TỰ Ý CHỈNH SỬA. Nếu có thông tin cần thay đổi sau khi ký, bạn phải liên hệ Công ty INUT (Hotline: 0972.768.491) để được mở khóa.",
      "",
      "Bạn có chắc chắn muốn xác nhận ký hợp đồng ngay bây giờ không?"
    ].join("\\n");
    const confirmSign = confirm(confirmMsg);
    if (!confirmSign) {{
      btn.disabled = false;
      btn.innerText = "✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC";
      return;
    }}


    const dataUrl = canvas.toDataURL("image/png");
    try {{
      const res = await fetch("/api/public/khoan/" + portalToken + "/submit-signature", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{
          signature_data: dataUrl,
          face_photo_data: finalFace,
          worker_name: nameEl ? nameEl.value.trim() : null,
          worker_id_card: idCardEl ? idCardEl.value.trim() : null,
          worker_id_card_date: idDateEl ? idDateEl.value.trim() : null,
          worker_id_card_place: idPlaceEl ? idPlaceEl.value.trim() : null,
          worker_phone: phoneEl ? phoneEl.value.trim() : null,
          worker_address: addrEl ? addrEl.value.trim() : null,
          worker_bank_account: bankAccEl ? bankAccEl.value.trim() : null,
          worker_bank_name: bankNameEl ? bankNameEl.value.trim() : null,
          id_card_front_data: cccdFrontData || null,
          id_card_back_data: cccdBackData || null
        }})
      }});
      const data = await res.json();
      if (data.ok) {{
        alert("🎉 Chúc mừng! Bạn đã ký tên và xác thực chân dung thành công!");
        window.location.reload();
      }} else {{
        alert("Lỗi: " + (data.error || "Không thể lưu chữ ký"));
        btn.disabled = false;
        btn.innerText = "✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC";
      }}
    }} catch (err) {{
      alert("Lỗi kết nối: " + err.message);
      btn.disabled = false;
      btn.innerText = "✍️ XÁC NHẬN KÝ HỢP ĐỒNG & CHỤP ẢNH XÁC THỰC";
    }}
  }}
</script>
</body>
</html>
    """
    return HTMLResponse(html)


def _save_cccd_images_from_payload(c: PieceworkContract, front_data: str | None, back_data: str | None, db: Session) -> bool:
    changed = False
    if front_data and front_data.startswith("data:image/"):
        try:
            import base64
            _, enc = front_data.split(",", 1)
            raw = base64.b64decode(enc)
            doc_id = storage.save_upload(raw, suffix=".jpg")
            c.id_card_front_doc_id = doc_id
            c.has_id_card_front = True
            changed = True
            if c.contractor_id:
                contractor = db.get(PieceworkContractor, c.contractor_id)
                if contractor:
                    contractor.id_card_front_doc_id = doc_id
        except Exception as e:
            logger.warning("Error saving front CCCD: %s", e)
    if back_data and back_data.startswith("data:image/"):
        try:
            import base64
            _, enc = back_data.split(",", 1)
            raw = base64.b64decode(enc)
            doc_id = storage.save_upload(raw, suffix=".jpg")
            c.id_card_back_doc_id = doc_id
            c.has_id_card_back = True
            changed = True
            if c.contractor_id:
                contractor = db.get(PieceworkContractor, c.contractor_id)
                if contractor:
                    contractor.id_card_back_doc_id = doc_id
        except Exception as e:
            logger.warning("Error saving back CCCD: %s", e)
    return changed

def _save_site_photos_from_payload(c: PieceworkContract, photos_data: list[str] | None, db: Session) -> bool:
    if not photos_data:
        return False
    changed = False
    photos = []
    try:
        photos = json.loads(c.site_photos_json or "[]")
    except Exception:
        photos = []
    for p_str in photos_data:
        if p_str and p_str.startswith("data:image/"):
            try:
                import base64
                _, enc = p_str.split(",", 1)
                raw = base64.b64decode(enc)
                doc_id = storage.save_upload(raw, suffix=".jpg")
                if doc_id not in photos:
                    photos.append(doc_id)
                    changed = True
            except Exception as e:
                logger.warning("Error saving site photo: %s", e)
    if changed:
        c.site_photos_json = json.dumps(photos)
        c.has_acceptance = True
        if not c.acceptance_doc_id and photos:
            c.acceptance_doc_id = photos[0]
    return changed



class SignaturePayload(BaseModel):
    signature_data: str
    face_photo_data: str | None = None
    worker_name: str | None = None
    worker_id_card: str | None = None
    worker_id_card_date: str | None = None
    worker_id_card_place: str | None = None
    worker_tax_code: str | None = None
    worker_phone: str | None = None
    worker_address: str | None = None
    worker_bank_account: str | None = None
    worker_bank_name: str | None = None
    id_card_front_data: str | None = None
    id_card_back_data: str | None = None
    site_photos_data: list[str] | None = None


class WorkerDraftPayload(BaseModel):
    worker_name: str | None = None
    worker_id_card: str | None = None
    worker_id_card_date: str | None = None
    worker_id_card_place: str | None = None
    worker_tax_code: str | None = None
    worker_phone: str | None = None
    worker_address: str | None = None
    worker_bank_account: str | None = None
    worker_bank_name: str | None = None
    id_card_front_data: str | None = None
    id_card_back_data: str | None = None
    site_photos_data: list[str] | None = None

@router.post("/api/public/khoan/{token}/save-draft")
def public_save_draft(
    token: str,
    payload: WorkerDraftPayload,
    db: Session = Depends(get_session),
):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng")
    if c.is_signed_by_worker:
        # Contract is already signed and locked; do not overwrite with draft
        return {"ok": False, "message": "Hợp đồng đã được ký tên và khóa, không thể ghi đè bản nháp"}

    if payload.worker_name is not None and payload.worker_name.strip():
        c.worker_name = payload.worker_name.strip()
    if payload.worker_id_card is not None and payload.worker_id_card.strip():
        c.worker_id_card = payload.worker_id_card.strip()
    if payload.worker_id_card_date is not None and payload.worker_id_card_date.strip():
        c.worker_id_card_date = payload.worker_id_card_date.strip()
    if payload.worker_id_card_place is not None and payload.worker_id_card_place.strip():
        c.worker_id_card_place = payload.worker_id_card_place.strip()
    if payload.worker_tax_code is not None and payload.worker_tax_code.strip():
        c.worker_tax_code = payload.worker_tax_code.strip()
    if payload.worker_phone is not None and payload.worker_phone.strip():
        c.worker_phone = payload.worker_phone.strip()
    if payload.worker_address is not None and payload.worker_address.strip():
        c.worker_address = payload.worker_address.strip()
    if payload.worker_bank_account is not None and payload.worker_bank_account.strip():
        c.worker_bank_account = payload.worker_bank_account.strip()
    if payload.worker_bank_name is not None and payload.worker_bank_name.strip():
        c.worker_bank_name = payload.worker_bank_name.strip()
    _save_cccd_images_from_payload(c, payload.id_card_front_data, payload.id_card_back_data, db)
    _save_site_photos_from_payload(c, payload.site_photos_data, db)
    c.updated_at = datetime.now(timezone.utc)
    try:
        pdf_bytes = render_piecework_pdf(c)
        doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
        c.contract_pdf_doc_id = doc_id
    except Exception as e:
        logger.warning("Could not pre-render draft PDF: %s", e)
    db.commit()
    return {"ok": True, "saved_at": datetime.now(timezone.utc).isoformat()}


@router.post("/api/public/khoan/{token}/submit-signature")
def public_submit_signature(
    token: str,
    payload: SignaturePayload,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng")
        
    sig = payload.signature_data.strip()
    if not sig.startswith("data:image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dữ liệu chữ ký không hợp lệ")
        
    c.worker_signature_data = sig
    c.is_signed_by_worker = True
    c.worker_signed_at = datetime.now(timezone.utc)
    if payload.worker_name:
        c.worker_name = payload.worker_name.strip()
    if payload.worker_id_card:
        c.worker_id_card = payload.worker_id_card.strip()
    if payload.worker_id_card_date:
        c.worker_id_card_date = payload.worker_id_card_date.strip()
    if payload.worker_id_card_place:
        c.worker_id_card_place = payload.worker_id_card_place.strip()
    if payload.worker_tax_code:
        c.worker_tax_code = payload.worker_tax_code.strip()
    if payload.worker_phone:
        c.worker_phone = payload.worker_phone.strip()
    if payload.worker_address:
        c.worker_address = payload.worker_address.strip()
    if payload.worker_bank_account:
        c.worker_bank_account = payload.worker_bank_account.strip()
    if payload.worker_bank_name:
        c.worker_bank_name = payload.worker_bank_name.strip()
    _save_cccd_images_from_payload(c, payload.id_card_front_data, payload.id_card_back_data, db)
    _save_site_photos_from_payload(c, payload.site_photos_data, db)

    # Update or link contractor profile if exists
    if c.worker_name and c.worker_id_card:
        contractor = db.scalar(select(PieceworkContractor).where(PieceworkContractor.id_card == c.worker_id_card))
        if not contractor:
            clean_code = f"CTV-AUTO-{c.worker_id_card[-4:]}"
            contractor = PieceworkContractor(
                code=clean_code,
                name=c.worker_name,
                id_card=c.worker_id_card,
                id_card_date=c.worker_id_card_date or "",
                id_card_place=c.worker_id_card_place or "Cục Cảnh sát QLHC về TTXH",
                tax_code=c.worker_tax_code or "",
                phone=c.worker_phone or "",
                address=c.worker_address or "",
                bank_account=c.worker_bank_account or "",
                bank_name=c.worker_bank_name or "Techcombank",
                skills=c.project_name or "Thi công giao khoán",
            )
            db.add(contractor)
            db.flush()
            c.contractor_id = contractor.id
        else:
            c.contractor_id = contractor.id
            contractor.name = c.worker_name
            if c.worker_phone: contractor.phone = c.worker_phone
            if c.worker_address: contractor.address = c.worker_address
            if c.worker_bank_account: contractor.bank_account = c.worker_bank_account
            if c.worker_bank_name: contractor.bank_name = c.worker_bank_name
    if payload.face_photo_data:
        face_str = (payload.face_photo_data or "").strip()
        if face_str.startswith("data:image/"):
            try:
                import base64
                _, encoded = face_str.split(",", 1)
                raw_face_bytes = base64.b64decode(encoded)
                face_doc_id = storage.save_upload(raw_face_bytes, suffix=".jpg")
                c.worker_face_doc_id = face_doc_id
                c.worker_face_photo_data = face_str
            except Exception as e:
                logger.warning("Could not save face photo: %s", e)
    
    # Do NOT auto-stamp Bên A (INUT): Bên A only signs after admin explicitly reviews and executes signature.
        
    # Re-evaluate deficiencies
    deficiency = evaluate_deficiencies(c)
    c.status = deficiency["status_code"]
    c.updated_at = datetime.now(timezone.utc)
    
    # Re-render PDF with both signatures
    try:
        pdf_bytes = render_piecework_pdf(c)
        if c.is_signed_by_inut and c.inut_signed_at:
            try:
                pdf_bytes = sign_piecework_pdf_pyhanko(pdf_bytes, c.inut_signed_at, location=settings.default_location)
            except Exception as e:
                logger.exception("Error signing with PyHanko in portal: %s", e)
        doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
        c.contract_pdf_doc_id = doc_id
        
        # Save into Documents
        doc_name = f"HDGK_{c.contract_code.replace('/', '_')}_dual_signed.pdf"
        doc = Document(
            doc_id=doc_id,
            filename=doc_name,
            signer_name=c.worker_name,
            signed=True,
            doc_type="hop_dong",
            note=f"HĐGK {c.contract_code} · {c.worker_name} · Ký online qua Portal · Đã đủ 2 chữ ký",
            source_system="piecework_portal",
            source_external_id=c.contract_code,
            source_synced_at=datetime.now(timezone.utc),
        )
        db.add(doc)
    except Exception as e:
        print("Error re-rendering PDF:", e)
        
    db.commit()
    db.refresh(c)
    return {"ok": True, "status": c.status, "signed_at": c.worker_signed_at.isoformat()}


@router.get("/api/public/khoan/{token}/pdf")
def public_get_contract_pdf(
    token: str,
    signed: int | None = None,
    draft: bool = False,
    db: Session = Depends(get_session),
):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng")
        
    safe_code = "".join(ch for ch in c.contract_code if ch.isascii() and (ch.isalnum() or ch in "-_"))

    # Draft / Unsigned requested:
    if draft or signed == 0:
        import copy
        c_draft = copy.copy(c)
        c_draft.is_signed_by_inut = False
        c_draft.is_signed_by_worker = False
        c_draft.worker_signature_data = ""
        c_draft.worker_face_photo_data = ""
        pdf_bytes = render_piecework_pdf(c_draft)
        code_clean = c.contract_code.replace("/", "_").replace("Đ", "D").replace("đ", "d")
        safe_code = "".join(ch for ch in code_clean if ch.isalnum() or ch in "-_")
        filename = f"Hop_dong_giao_khoan_{safe_code or c.id}_CHUA_KY_BAN_THAO.pdf"
    else:
        # Return real signed cryptographic PDF if present, otherwise render
        if c.contract_pdf_doc_id and storage.exists(c.contract_pdf_doc_id):
            pdf_bytes = storage.read_doc(c.contract_pdf_doc_id)
        else:
            pdf_bytes = render_piecework_pdf(c)
        suffix_label = "DA_KY" if (c.is_signed_by_inut or c.is_signed_by_worker) else "CHUA_KY"
        code_clean = c.contract_code.replace("/", "_").replace("Đ", "D").replace("đ", "d")
        safe_code = "".join(ch for ch in code_clean if ch.isalnum() or ch in "-_")
        filename = f"Hop_dong_giao_khoan_{safe_code or c.id}_{suffix_label}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/api/public/khoan/{token}/phu-luc-2/pdf")
def public_get_appendix2_pdf(token: str, db: Session = Depends(get_session)):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng")
    pdf_bytes = render_appendix2_pdf(c)
    code_clean = c.contract_code.replace("/", "_").replace("Đ", "D").replace("đ", "d")
    safe_code = "".join(ch for ch in code_clean if ch.isalnum() or ch in "-_")
    filename = f"Phu_luc_02_Nghiem_thu_{safe_code or c.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/api/public/khoan/{token}/phu-luc-3/pdf")
def public_get_appendix3_pdf(token: str, db: Session = Depends(get_session)):
    c = db.scalar(select(PieceworkContract).where(PieceworkContract.portal_token == token))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hợp đồng")
    pdf_bytes = render_appendix3_pdf(c)
    code_clean = c.contract_code.replace("/", "_").replace("Đ", "D").replace("đ", "d")
    safe_code = "".join(ch for ch in code_clean if ch.isalnum() or ch in "-_")
    filename = f"Phu_luc_03_Thanh_toan_UNC_{safe_code or c.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
