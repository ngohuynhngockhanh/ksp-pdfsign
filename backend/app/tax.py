"""Ket noi cong Hoa don dien tu Tong cuc Thue (hoadondientu.gdt.gov.vn).

Dung API NOI BO ma chinh web app cua cong goi (cong dong da reverse-engineer):
- GET  /api/captcha                         -> {key, content(svg)}
- POST /api/security-taxpayer/authenticate  -> {token}  (can captcha)
- GET  /api/query/invoices/purchase         -> HD mua CO MA CQT (can Bearer token)
- GET  /api/sco-query/invoices/purchase     -> HD mua KHONG MA (may tinh tien)
- GET  /api/query/invoices/sold             -> HD ban ra

Chi dung cho MST cua CHINH doanh nghiep (du lieu hoa don cua minh, muc dich ke
toan/doi chieu). KHONG luu mat khau; token chi giu trong bo nho phien lam viec.
Gioi han: khoang tim kiem toi da 1 THANG/lan, size toi da 50, phan trang bang 'state'.
"""
from __future__ import annotations

import calendar
import re
from datetime import datetime
from zoneinfo import ZoneInfo
import uuid
from zoneinfo import ZoneInfo

import httpx

BASE = "https://hoadondientu.gdt.gov.vn/api"
_TIMEOUT = 30.0
_LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Origin": "https://hoadondientu.gdt.gov.vn",
    "Referer": "https://hoadondientu.gdt.gov.vn/",
    "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Action": "",
    "End-Point": "/",
}


def _client(session_cookies: dict | None = None) -> httpx.Client:
    headers = dict(_BROWSER_HEADERS)
    headers["request-id"] = str(uuid.uuid4())
    return httpx.Client(
        timeout=_TIMEOUT,
        verify=False,
        headers=headers,
        cookies=session_cookies,
        follow_redirects=True,
    )

class TaxError(RuntimeError):
    pass


def _invoice_date(value: object) -> str:
    """Convert tax API timestamps to the invoice date in Vietnam time."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(_LOCAL_TZ)
        return parsed.date().isoformat()
    except ValueError:
        return raw[:10]


def get_captcha() -> dict:
    """Lay 1 captcha moi -> {key, svg}. FE hien svg cho user go."""
    with _client() as c:
        try:
            c.get("https://hoadondientu.gdt.gov.vn/")
        except Exception:
            pass
        c.headers["request-id"] = str(uuid.uuid4())
        r = c.get(f"{BASE}/captcha")
    if r.status_code != 200:
        raise TaxError(f"Không lấy được captcha ({r.status_code})")
    j = r.json()
    return {"key": j.get("key", ""), "svg": j.get("content", "")}


def authenticate(mst: str, password: str, ckey: str, cvalue: str) -> str:
    """Dang nhap -> tra JWT token. Loi captcha/sai mat khau -> TaxError."""
    with _client() as c:
        try:
            c.get("https://hoadondientu.gdt.gov.vn/")
        except Exception:
            pass
        c.headers["request-id"] = str(uuid.uuid4())
        r = c.post(
            f"{BASE}/security-taxpayer/authenticate",
            json={"ckey": ckey, "cvalue": cvalue, "username": mst, "password": password},
        )
    if r.status_code == 200:
        tok = r.json().get("token")
        if tok:
            return tok
        raise TaxError("Đăng nhập không trả token")
    msg = ""
    try:
        msg = r.json().get("message", "")
    except Exception:  # noqa: BLE001
        msg = r.text[:120]
    raise TaxError(msg or f"Đăng nhập thất bại ({r.status_code})")
def _query_range(token: str, url: str, tu: str, den: str, chunk_days: int = 7) -> list[dict]:
    """Query 1 endpoint theo khoang [tu, den] (ISO yyyy-mm-dd).

    Chia nho theo TUAN (chunk_days ngay/lan) — cong thue rat cham, khoang nho thi
    nhanh + it timeout. Tuan nao loi -> BO QUA tuan do (fallback), khong mat ca nam.
    Phan trang bang 'state'. Dedup theo (khhdon, khmshdon, shdon) phong cua so chong lan.
    """
    import time as _t
    from datetime import date, timedelta

    d0 = date(int(tu[:4]), int(tu[5:7]), int(tu[8:10]))
    d1 = date(int(den[:4]), int(den[5:7]), int(den[8:10]))
    seen: set = set()
    out: list[dict] = []
    with _client() as c:
        c.headers["Authorization"] = f"Bearer {token}"
        cur = d0
        while cur <= d1:
            hi = min(cur + timedelta(days=chunk_days - 1), d1)
            srch = (f"tdlap=ge={cur.strftime('%d/%m/%Y')}T00:00:00;"
                    f"tdlap=le={hi.strftime('%d/%m/%Y')}T23:59:59")
            state = None
            for _ in range(30):  # backstop phan trang trong tuan
                params = {"sort": "tdlap:desc", "size": "50", "search": srch}
                if state:
                    params["state"] = state
                r = None
                for _try in range(5):  # retry moi request
                    try:
                        c.headers["request-id"] = str(uuid.uuid4())
                        r = c.get(url, params=params)
                        break
                    except Exception:  # noqa: BLE001
                        _t.sleep(2)
                if r is None or r.status_code != 200:
                    break  # tuan loi -> bo qua, sang tuan sau (fallback)
                j = r.json()
                d = j.get("datas") or []
                for h in d:
                    k = ((h.get("khhdon") or ""), h.get("khmshdon"), h.get("shdon"))
                    if k not in seen:
                        seen.add(k)
                        out.append(h)
                state = j.get("state")
                if not state or len(d) < 50:
                    break
            cur = hi + timedelta(days=1)
    return out


def fetch_invoices(token: str, tu: str, den: str) -> dict:
    """Lay HD mua (co ma + khong ma) va ban ra trong khoang. Tra {mua, ban}."""
    mua = _query_range(token, f"{BASE}/query/invoices/purchase", tu, den)
    mua += _query_range(token, f"{BASE}/sco-query/invoices/purchase", tu, den)
    ban = _query_range(token, f"{BASE}/query/invoices/sold", tu, den)
    return {"mua": mua, "ban": ban}


def check_token(token: str) -> bool:
    """Token con hieu luc? Query 1 dong thu; 200 -> con, khac -> het han/sai."""
    if not token:
        return False
    try:
        with _client() as c:
            c.headers["Authorization"] = f"Bearer {token}"
            c.headers["request-id"] = str(uuid.uuid4())
            r = c.get(
                f"{BASE}/query/invoices/purchase",
                params={"sort": "tdlap:desc", "size": "1",
                        "search": "tdlap=ge=01/01/2026T00:00:00;tdlap=le=31/01/2026T23:59:59"},
            )
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False

def invoice_detail(token: str, h: dict) -> dict | None:
    """Lay chi tiet 1 HD (co dong hang hdhhdvu). Thu ca endpoint co ma va khong ma."""
    qp = {
        "nbmst": h.get("nbmst"), "khhdon": h.get("khhdon"),
        "khmshdon": h.get("khmshdon"), "shdon": h.get("shdon"), "tdlap": h.get("tdlap"),
    }
    import time as _t

    with _client() as c:
        c.headers["Authorization"] = f"Bearer {token}"
        for path in ("/query/invoices/detail", "/sco-query/invoices/detail"):
            for _ in range(5):  # cong cham -> retry 5 lan
                try:
                    c.headers["request-id"] = str(uuid.uuid4())
                    r = c.get(f"{BASE}{path}", params=qp)
                except Exception:  # noqa: BLE001
                    _t.sleep(2)
                    continue
                if r.status_code == 200:
                    return r.json()
                if r.status_code == 404:
                    break  # sai dataset -> thu endpoint kia
                _t.sleep(2)
    return None


def download_invoice_xml(token: str, h: dict) -> bytes | None:
    """Tai ZIP export-xml cua 1 HD tu cong, boc ra invoice.xml (ban goc phap ly).

    Cong KHONG co API PDF; XML la ban goc (co chu ky so). Thu ca 2 endpoint.
    """
    import io
    import zipfile

    import time as _t

    qp = {
        "nbmst": h.get("nbmst"), "khhdon": h.get("khhdon"),
        "khmshdon": h.get("khmshdon"), "shdon": h.get("shdon"), "tdlap": h.get("tdlap"),
    }
    with _client() as c:
        c.headers["Authorization"] = f"Bearer {token}"
        for path in ("/sco-query/invoices/export-xml", "/query/invoices/export-xml"):
            for _ in range(5):  # cong cham -> retry
                try:
                    c.headers["request-id"] = str(uuid.uuid4())
                    r = c.get(f"{BASE}{path}", params=qp)
                except Exception:  # noqa: BLE001
                    _t.sleep(2)
                    continue
                if r.status_code == 200 and r.content[:2] == b"PK":
                    try:
                        z = zipfile.ZipFile(io.BytesIO(r.content))
                        for name in z.namelist():
                            if name.lower().endswith(".xml"):
                                return z.read(name)
                    except Exception:  # noqa: BLE001
                        pass
                    break  # tra ve 200 nhung khong co xml -> thu endpoint khac
                if r.status_code == 404:
                    break  # sai dataset -> thu endpoint khac
                _t.sleep(2)  # 500/timeout khac -> retry
    return None


def download_invoice_html(token: str, h: dict) -> bytes | None:
    """Tai ZIP tu cong, boc invoice.html + nhung inline (details.js + anh base64)
    -> 1 file HTML TU CHUA (mo trinh duyet la hien full hoa don, ca chu ky so)."""
    import base64
    import io
    import zipfile

    import time as _t

    headers = {"Authorization": f"Bearer {token}", "User-Agent": "Mozilla/5.0"}
    qp = {
        "nbmst": h.get("nbmst"), "khhdon": h.get("khhdon"),
        "khmshdon": h.get("khmshdon"), "shdon": h.get("shdon"), "tdlap": h.get("tdlap"),
    }
    zc = None
    with _client() as c:
        for path in ("/sco-query/invoices/export-xml", "/query/invoices/export-xml"):
            for _ in range(5):
                try:
                    r = c.get(f"{BASE}{path}", params=qp, headers=headers)
                except Exception:  # noqa: BLE001
                    _t.sleep(2)
                    continue
                if r.status_code == 200 and r.content[:2] == b"PK":
                    zc = r.content
                    break
                if r.status_code == 404:
                    break
                _t.sleep(2)
            if zc:
                break
    if not zc:
        return None
    try:
        z = zipfile.ZipFile(io.BytesIO(zc))
        names = z.namelist()
        html = z.read("invoice.html").decode("utf-8", errors="ignore")
        # nhung details.js
        if "details.js" in names:
            js = z.read("details.js").decode("utf-8", errors="ignore")
            html = html.replace(
                '<script src="details.js"></script>', f"<script>{js}</script>"
            ).replace('src="details.js"', "").replace(
                "<script></script>", f"<script>{js}</script>", 1
            )
            if "<script>" + js[:20] not in html:  # chac chan nhung duoc
                html = html.replace("</body>", f"<script>{js}</script></body>")
        # nhung anh base64
        for img in [n for n in names if n.lower().endswith((".jpg", ".jpeg", ".png"))]:
            b64 = base64.b64encode(z.read(img)).decode("ascii")
            mime = "image/png" if img.lower().endswith(".png") else "image/jpeg"
            html = html.replace(img, f"data:{mime};base64,{b64}")
        return html.encode("utf-8")
    except Exception:  # noqa: BLE001
        return None


def html_to_pdf(html_bytes: bytes) -> bytes | None:
    """Render HTML tu chua -> PDF (chromium qua Node). Dung cho nut convert PDF de share."""
    import os
    import subprocess
    import tempfile
    from pathlib import Path

    script = Path(__file__).resolve().parent.parent / "scripts" / "html2pdf.mjs"
    with tempfile.TemporaryDirectory() as td:
        inp = os.path.join(td, "in.html")
        out = os.path.join(td, "out.pdf")
        with open(inp, "wb") as f:
            f.write(html_bytes)
        env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH="/home/ksp/.cache/ms-playwright")
        try:
            subprocess.run(["node", str(script), inp, out], env=env, timeout=60, capture_output=True)
        except Exception:  # noqa: BLE001
            return None
        if os.path.exists(out):
            data = open(out, "rb").read()
            return data if data[:4] == b"%PDF" else None
    return None


def detail_to_purchase(d: dict) -> dict:
    """Map chi tiet HD cong thue -> data cho inv_import.create_purchase_draft."""
    items = []
    for i, ln in enumerate(d.get("hdhhdvu") or [], start=1):
        # thue suat: cong tra 'tsuat'=0.08 (so) + 'ltsuat'='8%' (chuoi). parse_num('8%')
        # =0 (dau % hong) -> PHAI dung so tsuat*100. KCT/khong chiu thue -> tsuat None -> 0.
        tsuat = ln.get("tsuat")
        ts_num = round(float(tsuat) * 100, 2) if isinstance(tsuat, (int, float)) else 0
        items.append({
            "stt": ln.get("stt") or i,
            "ten": ln.get("ten") or "",
            "dvt": ln.get("dvtinh") or "",
            "so_luong": ln.get("sluong") or 0,
            "don_gia": ln.get("dgia") or 0,
            "thanh_tien": ln.get("thtien") or 0,
            "thue_suat": ts_num,  # SO (vd 8), khong phai '8%' (parse_num hong dau %)
        })
    line_total = sum(float(item["thanh_tien"] or 0) for item in items)
    before_tax = d.get("tgtcthue")
    tax_total = d.get("tgtthue") or 0
    total = d.get("tgtttbso")
    if not before_tax and line_total:
        before_tax = line_total
    if not total and before_tax:
        total = float(before_tax) + float(tax_total or 0)
    return {
        "source": "tax_gdt",
        "so_hd": str(d.get("shdon") or ""),
        "ky_hieu": str(d.get("khhdon") or ""),
        "mst_ban": str(d.get("nbmst") or ""),
        "ten_ban": str(d.get("nbten") or ""),
        "ngay": _invoice_date(d.get("tdlap")),
        "tong_truoc_thue": before_tax or 0,
        "tong_thue": tax_total,
        "tong_tien": total or 0,
        "items": items,
        "confidence": 0.9,
        "warnings": [{
            "code": "tax_gdt",
            "msg": "Nạp tự động từ cổng Tổng cục Thuế — kiểm tra dòng hàng + khớp mã kho trước khi ghi sổ",
        }],
    }


def import_missing_purchases(db, token: str, missing: list[dict]) -> dict:
    """Nap cac HD mua thieu (tu ket qua reconcile) vao he thong dang draft.

    missing: list dict co 'so_hd','mst_ban','ky_hieu','ngay' (de goi lai detail).
    Tra {imported, skipped, errors}. create_purchase_draft tu chong trung (MST+so HD).
    """
    from . import inv_import

    imported = skipped = errors = 0
    for m in missing:
        h = {
            "nbmst": m.get("mst_ban"), "khhdon": m.get("ky_hieu"),
            "khmshdon": m.get("khmshdon", 1), "shdon": m.get("so_hd"),
            "tdlap": m.get("tdlap") or ((m.get("ngay") or "") + "T00:00:00Z"),
        }
        d = invoice_detail(token, h)
        if not d:
            errors += 1
            continue
        try:
            data = detail_to_purchase(d)
            inv = inv_import.create_purchase_draft(db, data)
            if inv.dup_of:
                skipped += 1
            else:
                imported += 1
                # Gan luon XML goc (ban phap ly) — luu tru + sync NAS
                _attach_xml(db, token, inv, h)
        except Exception:  # noqa: BLE001
            errors += 1
    return {"imported": imported, "skipped": skipped, "errors": errors}


def _attach_xml(db, token: str, inv, h: dict) -> bool:
    """Gan XML goc (phap ly) + HTML ban the hien vao HD. Best-effort, khong raise.

    Luu {doc_id}.xml (doc_suffix) + {doc_id}.html cung ten -> co ca ban goc lan ban
    the hien de xem/share (nut convert PDF render tu HTML nay).
    """
    import os

    from . import storage

    try:
        if not inv.doc_id:
            xml = download_invoice_xml(token, h)
            if not xml:
                return False
            inv.doc_id = storage.save_upload(xml, suffix=".xml")
            inv.doc_suffix = ".xml"
            db.commit()
        # luu them HTML ban the hien (neu chua co)
        if inv.doc_id and not storage.exists(inv.doc_id, ".html"):
            html = download_invoice_html(token, h)
            if html:
                p = storage.path_for(inv.doc_id, ".html")
                os.makedirs(p.parent, exist_ok=True)
                p.write_bytes(html)
        return True
    except Exception:  # noqa: BLE001
        db.rollback()
        return bool(inv.doc_id)


def attach_missing_xml(db, token: str, tax_mua: list[dict]) -> dict:
    """Gan XML goc cho moi HD source=tax_gdt chua co file. Tra {attached, failed}."""
    from sqlalchemy import select

    from .db import InvPurchase

    byso = {_norm(x.get("shdon")): x for x in tax_mua}
    attached = failed = 0
    for inv in db.scalars(select(InvPurchase).where(InvPurchase.source == "tax_gdt", InvPurchase.doc_id == "")):
        h0 = byso.get(_norm(inv.so_hd))
        if not h0:
            failed += 1
            continue
        ok = _attach_xml(db, token, inv, {
            "nbmst": h0.get("nbmst"), "khhdon": h0.get("khhdon"),
            "khmshdon": h0.get("khmshdon"), "shdon": h0.get("shdon"), "tdlap": h0.get("tdlap"),
        })
        attached += 1 if ok else 0
        failed += 0 if ok else 1
    return {"attached": attached, "failed": failed}


def _norm(s) -> str:
    return re.sub(r"^0+", "", str(s or "").strip()) or "0"


def _base_mst(s) -> str:
    """MST goc, bo hau to chi nhanh '-075'. So sanh HD phai theo MST goc."""
    return (str(s or "").strip().split("-")[0]).strip()


def reconcile(db, tax: dict, tu: str, den: str) -> dict:
    """Doi chieu HD cong thue vs he thong -> danh sach THIEU (co tren cong, chua nap).

    Mua: khop theo (so HD chuan hoa, MST GOC ben ban). Ban: (ky hieu, so HD).
    So HD lap giua cac NCC nen KHONG duoc match chi theo so HD.
    """
    from sqlalchemy import select

    from .db import InvPurchase, InvSale

    sys_mua = list(db.scalars(select(InvPurchase).where(InvPurchase.ngay >= tu, InvPurchase.ngay <= den)))
    # Khoa duy nhat HD = (so HD chuan hoa, MST GOC ben ban). KHONG match theo mot
    # minh so HD — so HD lap giua cac NCC (vd '114' cua 2 cong ty khac nhau).
    sys_mua_keys = {(_norm(p.so_hd), _base_mst(p.mst_ban)) for p in sys_mua}
    sys_mua_tien = {(_norm(p.so_hd), _base_mst(p.mst_ban)): (p.tong_tien or 0) for p in sys_mua}
    missing_mua = []
    mismatch_mua = []  # co ca 2 ben nhung LECH tien so voi co quan thue
    for h in tax.get("mua", []):
        so = _norm(h.get("shdon"))
        mst = _base_mst(h.get("nbmst"))
        if (so, mst) in sys_mua_keys:
            tien_cong = h.get("tgtttbso") or 0
            tien_ht = sys_mua_tien.get((so, mst), 0)
            if abs(tien_cong - tien_ht) > 1:
                mismatch_mua.append({
                    "ngay": _invoice_date(h.get("tdlap")),
                    "so_hd": h.get("shdon"), "ky_hieu": h.get("khhdon", ""),
                    "ten_ban": h.get("nbten", ""), "mst_ban": h.get("nbmst", ""),
                    "tien_he_thong": tien_ht, "tien_cong_thue": tien_cong,
                    "lech": tien_ht - tien_cong,
                })
            continue
        missing_mua.append({
            "ngay": _invoice_date(h.get("tdlap")),
            "so_hd": h.get("shdon"),
            "ky_hieu": h.get("khhdon", ""),
            "khmshdon": h.get("khmshdon"),
            "tdlap": h.get("tdlap"),
            "ten_ban": h.get("nbten", ""),
            "mst_ban": h.get("nbmst", ""),
            "tong_tien": h.get("tgtttbso", 0),
            "co_ma": bool(h.get("khmshdon")),
        })

    sys_ban = list(db.scalars(select(InvSale).where(InvSale.ngay >= tu, InvSale.ngay <= den)))
    # Ban ra: nguoi ban luon la minh -> khoa = (ky hieu, so HD chuan hoa)
    sys_ban_keys = {((s.ky_hieu or "").strip().upper(), _norm(s.so_hd)) for s in sys_ban}
    cong_ban_keys = {((h.get("khhdon") or "").strip().upper(), _norm(h.get("shdon"))) for h in tax.get("ban", [])}
    missing_ban = []
    for h in tax.get("ban", []):
        if ((h.get("khhdon") or "").strip().upper(), _norm(h.get("shdon"))) not in sys_ban_keys:
            missing_ban.append({
                "ngay": _invoice_date(h.get("tdlap")),
                "so_hd": h.get("shdon"),
                "ky_hieu": h.get("khhdon", ""),
                "ten_mua": h.get("nmten", ""),
                "tong_tien": h.get("tgtttbso", 0),
            })

    # HD MO COI: co trong he thong nhung KHONG co tren co quan thue -> NGHI LOI.
    # AN TOAN: chi xet trong khoang NGAY ma cong THUC SU tra ve (cong cham hay
    # timeout thang sau -> neu xet ngoai khoang se BAO NHAM HD that thanh mo coi).
    def _span(rows, key):
        ds = [d for d in (_invoice_date(r.get(key)) for r in rows) if d]
        return (min(ds), max(ds)) if ds else (None, None)

    cong_mua_keys = {(_norm(h.get("shdon")), _base_mst(h.get("nbmst"))) for h in tax.get("mua", [])}
    mua_lo, mua_hi = _span(tax.get("mua", []), "tdlap")
    orphan_mua = [
        {"ngay": p.ngay, "so_hd": p.so_hd, "ten_ban": p.ten_ban, "mst_ban": p.mst_ban,
         "tong_tien": p.tong_tien or 0, "source": p.source, "status": p.status}
        for p in sys_mua
        if p.mst_ban and mua_lo and mua_lo <= (p.ngay or "") <= mua_hi
        and (_norm(p.so_hd), _base_mst(p.mst_ban)) not in cong_mua_keys
    ]
    ban_lo, ban_hi = _span(tax.get("ban", []), "tdlap")
    orphan_ban = [
        {"ngay": s.ngay, "so_hd": s.so_hd, "ky_hieu": s.ky_hieu, "ten_mua": s.ten_mua,
         "tong_tien": s.tong_tien or 0, "status": s.status, "is_dieu_chinh": s.is_dieu_chinh}
        for s in sys_ban
        if not s.is_dieu_chinh and ban_lo and ban_lo <= (s.ngay or "") <= ban_hi
        and ((s.ky_hieu or "").strip().upper(), _norm(s.so_hd)) not in cong_ban_keys
    ]

    return {
        "mua_cong": len(tax.get("mua", [])), "mua_he_thong": len(sys_mua),
        "ban_cong": len(tax.get("ban", [])), "ban_he_thong": len(sys_ban),
        "missing_mua": sorted(missing_mua, key=lambda x: x["ngay"]),
        "missing_ban": sorted(missing_ban, key=lambda x: x["ngay"]),
        "mismatch_mua": sorted(mismatch_mua, key=lambda x: abs(x["lech"]), reverse=True),
        "orphan_mua": sorted(orphan_mua, key=lambda x: x["ngay"]),
        "orphan_ban": sorted(orphan_ban, key=lambda x: x["ngay"]),
    }
