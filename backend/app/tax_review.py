"""Doc + cham loi file BCT (To khai 01/GTGT + 2 bang ke) ke toan up len.

Khong hardcode toa do o — nhan dien chi tieu theo nhan [NN] va cot thue suat
theo mode, de ben voi truong hop file bi xe dich dong/cot.
"""
from __future__ import annotations

import io
import re
from datetime import datetime

from openpyxl import load_workbook

# Chi tieu chi hop le khi O chi chua dung nhan [NN] (khong phai o cong thuc
# "[27]=[29]+[30]..." — o do co nhieu nhan long nhau, KHONG phai gia tri that).
_CT_FULL = re.compile(r"^\[(\d+[a-z]?)\]$")
_RATES = {0.0, 0.05, 0.08, 0.1}  # thue suat hop le (dang phan so)


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _fmt(v) -> str:
    """Gia tri o -> chuoi hien thi (so co dau phan cach, ngay dd/mm/yyyy)."""
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, bool):
        return "x" if v else ""
    if isinstance(v, (int, float)):
        r = round(v, 2)
        if abs(r - round(r)) < 1e-9:
            return f"{int(round(r)):,}".replace(",", ".")
        s = f"{r:,.2f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
        return s
    return str(v)


# ---------------------------------------------------------------- To khai

def parse_to_khai(ws) -> dict[str, float | None]:
    """Tra ve {ma_chi_tieu: gia_tri}. Gia tri = so dau tien ben PHAI nhan,
    truoc nhan ke tiep cung dong."""
    ct: dict[str, float | None] = {}
    for row in ws.iter_rows():
        labels = []  # (cot, ma)
        for c in row:
            if isinstance(c.value, str):
                m = _CT_FULL.match(c.value.strip())
                if m:
                    labels.append((c.column, m.group(1)))
        if not labels:
            continue
        labels.sort()
        cells = sorted(((c.column, c.value) for c in row), key=lambda x: x[0])
        for i, (col, ma) in enumerate(labels):
            nxt = labels[i + 1][0] if i + 1 < len(labels) else 10**9
            val = None
            for cc, cv in cells:
                if col < cc < nxt and _num(cv) is not None:
                    val = float(cv)
                    break
            ct[ma] = val
    return ct


# ------------------------------------------------------------- Bang ke

def parse_bang_ke(ws) -> list[dict]:
    """Moi dong HD: {ngay, so_hd, ten, doanh_thu, rate, tien_thue}.

    Nhan dien cot thue suat = cot xuat hien gia tri {0.05,0.08,0.1} nhieu nhat;
    dong du lieu = dong co so o cot do VA co so tien ben trai."""
    from collections import Counter

    col_hits: Counter = Counter()
    for row in ws.iter_rows():
        for c in row:
            n = _num(c.value)
            if n is not None and n in {0.05, 0.08, 0.1}:
                col_hits[c.column] += 1
    if not col_hits:
        return []
    rate_col = col_hits.most_common(1)[0][0]

    rows: list[dict] = []
    for row in ws.iter_rows():
        by_col = {c.column: c.value for c in row}
        rv = by_col.get(rate_col)
        rate = _num(rv)
        if rate is None:
            continue
        # doanh thu = so gan nhat ben TRAI cot thue suat
        left = [(cc, _num(cv)) for cc, cv in by_col.items() if cc < rate_col and _num(cv) is not None]
        if not left:
            continue  # dong tieu de / tong -> bo
        dt_col, doanh_thu = max(left, key=lambda x: x[0])
        if doanh_thu is None or doanh_thu <= 0:
            continue
        right = [(cc, _num(cv)) for cc, cv in by_col.items() if cc > rate_col and _num(cv) is not None]
        tien_thue = min(right, key=lambda x: x[0])[1] if right else 0.0
        # ten doi tac = o CHU dai nhat ben trai cot doanh thu (khong phai ngay)
        texts = [cv for cc, cv in by_col.items() if cc < dt_col and isinstance(cv, str) and not _CT_FULL.match(cv.strip())]
        ten = max((t for t in texts), key=len, default="")
        rows.append({
            "doanh_thu": doanh_thu,
            "rate": rate,
            "rate_pct": round(rate * 100),
            "tien_thue": tien_thue or 0.0,
            "ten": ten.strip(),
        })
    return rows


# --------------------------------------------------------------- Grid

def sheet_grid(ws) -> dict:
    rows = []
    for row in ws.iter_rows():
        rows.append([_fmt(c.value) for c in row])
    # bo cac dong trong o cuoi
    while rows and not any(x.strip() for x in rows[-1]):
        rows.pop()
    ncols = max((len(r) for r in rows), default=0)
    for r in rows:
        r += [""] * (ncols - len(r))
    merges = []
    for mr in ws.merged_cells.ranges:
        merges.append([mr.min_row - 1, mr.min_col - 1, mr.max_row - 1, mr.max_col - 1])
    return {"name": ws.title, "rows": rows, "ncols": ncols, "merges": merges}


# --------------------------------------------------------------- Cham loi

def _g(ct, *keys):
    for k in keys:
        v = ct.get(k)
        if v is not None:
            return v
    return 0.0


def check(ct: dict, ban: list[dict], mua: list[dict]) -> list[dict]:
    """Tra ve list finding: {level: 'do'|'vang', title, detail, cells:[ma...]}."""
    out: list[dict] = []

    def add(level, title, detail, cells=None):
        out.append({"level": level, "title": title, "detail": detail, "cells": cells or []})

    c22 = _g(ct, "22"); c25 = _g(ct, "25"); c35 = _g(ct, "35", "28")
    c36 = _g(ct, "36"); c37 = _g(ct, "37"); c38 = _g(ct, "38"); c39 = _g(ct, "39")
    c40a = ct.get("40a"); c40 = ct.get("40")

    # 1) [40a]/[40] khong duoc am
    tmp = c36 - c22 + c37 - c38 + c39
    am = [ma for ma, val in (("40a", c40a), ("40", c40)) if val is not None and val < -0.5]
    if am:
        carry = max(0.0, -tmp)
        add("do", f"Chỉ tiêu [{'], ['.join(am)}] đang âm ({_fmt(min(v for v in (c40a, c40) if v is not None))})",
            f"Thuế phải nộp không được âm. Vì [36]−[22]+[37]−[38]+[39] = {_fmt(tmp)} < 0, "
            f"phải để [40a]=[40]=0 và chuyển {_fmt(carry)} sang [41]=[43] (khấu trừ chuyển kỳ sau).",
            am + ["41", "43"])

    # 2) Kiem tra cong thuc noi bo
    def formula(ma, expect, comps):
        got = ct.get(ma)
        if got is not None and abs(got - expect) > 1:
            add("do", f"[{ma}] lệch công thức", f"[{ma}]={_fmt(got)} nhưng {comps}={_fmt(expect)}.", [ma])
    formula("36", c35 - c25, "[35]−[25]")
    c26 = _g(ct, "26"); c27 = _g(ct, "27")
    formula("28", _g(ct, "31") + _g(ct, "33"), "[31]+[33]")
    formula("34", c26 + c27, "[26]+[27]")

    # 3) Doi chieu bang ke <-> to khai
    sum_ban_dt = sum(r["doanh_thu"] for r in ban)
    sum_ban_thue = sum(r["tien_thue"] for r in ban)
    sum_mua_dt = sum(r["doanh_thu"] for r in mua)
    sum_mua_thue = sum(r["tien_thue"] for r in mua)
    tk_ban_dt = _g(ct, "34", "27"); tk_ban_thue = _g(ct, "35", "28")
    tk_mua_dt = _g(ct, "23"); tk_mua_thue = _g(ct, "24", "25")
    if ban and abs(sum_ban_dt - tk_ban_dt) > 1:
        add("do", "Doanh thu bảng kê bán ra ≠ tờ khai",
            f"Tổng bảng kê = {_fmt(sum_ban_dt)}, tờ khai [34]/[27] = {_fmt(tk_ban_dt)} (lệch {_fmt(sum_ban_dt - tk_ban_dt)}).", ["34", "27"])
    if ban and abs(sum_ban_thue - tk_ban_thue) > 1:
        add("do", "Thuế bảng kê bán ra ≠ tờ khai",
            f"Tổng thuế bảng kê = {_fmt(sum_ban_thue)}, tờ khai [35]/[28] = {_fmt(tk_ban_thue)}.", ["35", "28"])
    if mua and abs(sum_mua_dt - tk_mua_dt) > 1:
        add("do", "Giá trị mua vào bảng kê ≠ tờ khai",
            f"Tổng bảng kê = {_fmt(sum_mua_dt)}, tờ khai [23] = {_fmt(tk_mua_dt)}.", ["23"])
    if mua and abs(sum_mua_thue - tk_mua_thue) > 1:
        add("do", "Thuế mua vào bảng kê ≠ tờ khai",
            f"Tổng thuế bảng kê = {_fmt(sum_mua_thue)}, tờ khai [24]/[25] = {_fmt(tk_mua_thue)}.", ["24", "25"])

    # 4) HD ban thue suat 0% cho DN noi dia
    zero = [r for r in ban if r["rate_pct"] == 0 and r["doanh_thu"] > 0]
    dn_noi_dia = [r for r in zero if "CÔNG TY" in (r["ten"] or "").upper() or "CTY" in (r["ten"] or "").upper()]
    if dn_noi_dia:
        tong = sum(r["doanh_thu"] for r in dn_noi_dia)
        c29 = ct.get("29")
        detail = (f"{len(dn_noi_dia)} HĐ bán thuế suất 0% cho DN nội địa, tổng doanh thu {_fmt(tong)}. "
                  "0% thường chỉ áp dụng khi đáp ứng điều kiện riêng (ví dụ hàng hóa, dịch vụ xuất khẩu). "
                  f"Nếu đúng 0% phải khai ở [29]; nếu không, cần xác định lại theo mức phổ thông 10% "
                  f"(thuế khoảng {_fmt(tong * 0.1)}) hoặc mức giảm 8% khi hàng hóa, dịch vụ đủ điều kiện "
                  f"(thuế khoảng {_fmt(tong * 0.08)}).")
        if not c29 or c29 < 1:
            detail += " Hiện [29] đang trống."
        add("vang", "HĐ bán thuế suất 0% cho DN nội địa — cần kiểm tra", detail,
            ["29"] + [f"__ten:{r['ten']}" for r in dn_noi_dia[:8]])

    # 4b) Nhom [32]/[33] ghi 10% nhung thue thuc te khac (lan HD 0%/8%)
    c32 = _g(ct, "32"); c33 = _g(ct, "33")
    if c32 > 0 and c33 > 0:
        implied = c33 / c32 * 100
        if abs(implied - 10) > 0.5 and abs(implied - 8) > 0.5:
            add("vang", f"Nhóm [32]/[33] ghi thuế suất 10% nhưng thuế thực chỉ ≈ {implied:.1f}%",
                f"[33]/[32] = {_fmt(c33)}/{_fmt(c32)} ≈ {implied:.2f}%. Nhóm [32] có thể đang lẫn HĐ 0% "
                f"hoặc HĐ giảm thuế 8% — nên tách 0% xuống [29] và ghi đúng nhóm 8%.", ["32", "33"])

    # 5) Thue suat la (suy ra) khong thuoc {0,5,8,10}
    la = sorted({r["rate_pct"] for r in (ban + mua) if r["rate_pct"] not in (0, 5, 8, 10)})
    if la:
        add("vang", "Có thuế suất lạ", f"Xuất hiện thuế suất {', '.join(str(x) + '%' for x in la)} — kiểm tra lại hóa đơn.", [])

    return out


# --------------------------------------------------------------- Entry

def review_bytes(xlsx_bytes: bytes) -> dict:
    """Parse + cham loi 1 file BCT. Tra {ct, ban, mua, findings, grids, summary}."""
    wb = load_workbook(io.BytesIO(xlsx_bytes), data_only=True)

    def find_sheet(*kw):
        for ws in wb.worksheets:
            t = ws.title.lower()
            if all(k in t for k in kw):
                return ws
        return None

    ws_tk = find_sheet("khai") or wb.worksheets[0]
    ws_ban = find_sheet("bán") or find_sheet("ban")
    ws_mua = find_sheet("mua")

    ct = parse_to_khai(ws_tk)
    ban = parse_bang_ke(ws_ban) if ws_ban else []
    mua = parse_bang_ke(ws_mua) if ws_mua else []
    findings = check(ct, ban, mua)
    grids = [sheet_grid(ws) for ws in wb.worksheets]

    summary = {
        "ban_ra_dt": _g(ct, "34", "27"), "ban_ra_thue": _g(ct, "35", "28"),
        "mua_vao_dt": _g(ct, "23"), "mua_vao_thue": _g(ct, "24", "25"),
        "khau_tru_ky_truoc": _g(ct, "22"),
        "ct_36": ct.get("36"), "ct_40": ct.get("40", ct.get("40a")),
        "ct_41": ct.get("41"), "ct_43": ct.get("43"),
        "so_hd_ban": len(ban), "so_hd_mua": len(mua),
        "do": sum(1 for f in findings if f["level"] == "do"),
        "vang": sum(1 for f in findings if f["level"] == "vang"),
    }
    return {"ct": ct, "ban": ban, "mua": mua, "findings": findings, "grids": grids, "summary": summary}
