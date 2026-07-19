"""Tien te: doc so tien bang chu tieng Viet + tinh tien bao gia/de nghi TT."""
from __future__ import annotations

_DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
_GROUP_UNITS = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"]


def _read_three(n: int, full: bool) -> str:
    """Doc nhom 3 chu so (0..999). full=True: doc ca 'không trăm' (nhom giua)."""
    tram, chuc, dvi = n // 100, (n % 100) // 10, n % 10
    parts: list[str] = []
    if full or tram:
        parts.append(_DIGITS[tram] + " trăm")
    if chuc == 0:
        if dvi and (tram or full):
            parts.append("lẻ")
    elif chuc == 1:
        parts.append("mười")
    else:
        parts.append(_DIGITS[chuc] + " mươi")
    if dvi:
        if chuc >= 2 and dvi == 1:
            parts.append("mốt")
        elif chuc >= 1 and dvi == 5:
            parts.append("lăm")
        else:
            parts.append(_DIGITS[dvi])
    return " ".join(parts)


def so_tien_bang_chu(amount: float | int) -> str:
    """Doc so tien VND bang chu: 60000000 -> 'Sáu mươi triệu đồng chẵn'."""
    n = int(round(float(amount)))
    if n < 0:
        s = so_tien_bang_chu(-n)
        return "Âm " + s[0].lower() + s[1:]
    if n == 0:
        return "Không đồng"
    groups: list[int] = []
    while n:
        groups.append(n % 1000)
        n //= 1000
    parts: list[str] = []
    for i in range(len(groups) - 1, -1, -1):
        if groups[i] == 0:
            continue
        parts.append(_read_three(groups[i], full=i != len(groups) - 1) + _GROUP_UNITS[i])
    s = " ".join(parts) + " đồng chẵn"
    return s[0].upper() + s[1:]


def parse_num(v) -> float:
    """Doc so tu form/hoa don. Chap nhan nhieu dinh dang VN/quoc te:
    '1.500.000', '1,500,000', '1500000', '1.5', '652.777,77' (phay = thap phan),
    '652,777.77', '15000,50'.
    """
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "")
    if not s:
        return 0.0
    has_dot = "." in s
    has_comma = "," in s
    if has_dot and has_comma:
        # Dau xuat hien SAU cung la dau thap phan (VN: 652.777,77 | US: 652,777.77)
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma:
        parts = s.split(",")
        # Quy uoc VN: dau phay = thap phan. 1 dau phay -> thap phan ('1,0000'->1,
        # '0,08'->0.08); nhieu dau phay = phan nghin kieu US ('1,500,000').
        if len(parts) == 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_dot:
        parts = s.split(".")
        # Nhieu dau cham hoac 1 dau cham voi dung 3 chu so sau -> phan nghin ('1.500.000', '1.500')
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3):
            s = s.replace(".", "")
        # nguoc lai giu nguyen ('1.5' -> 1.5)
    try:
        return float(s)
    except ValueError:
        return 0.0


def compute_totals(items: list[dict]) -> dict:
    """Tinh thanh tien tung dong + tong truoc thue + thue theo suat + tong thanh toan.

    Moi item: ten, dvt, so_luong, don_gia, thue_suat (%: 0/5/8/10).
    Tra ve dict: items (kem thanh_tien), tong_truoc_thue, tong_thue, tong_thanh_toan.
    """
    out_items: list[dict] = []
    tong_truoc_thue = 0.0
    tong_thue = 0.0
    for it in items:
        sl = parse_num(it.get("so_luong"))
        dg = parse_num(it.get("don_gia"))
        ts = parse_num(it.get("thue_suat"))
        thanh_tien = round(sl * dg)
        thue = round(thanh_tien * ts / 100)
        tong_truoc_thue += thanh_tien
        tong_thue += thue
        out_items.append({
            "ten": it.get("ten", ""),
            "dvt": it.get("dvt", ""),
            "so_luong": sl,
            "don_gia": dg,
            "thue_suat": ts,
            "thanh_tien": thanh_tien,
            "tien_thue": thue,
        })
    tong = round(tong_truoc_thue) + round(tong_thue)
    return {
        "items": out_items,
        "tong_truoc_thue": round(tong_truoc_thue),
        "tong_thue": round(tong_thue),
        "tong_thanh_toan": tong,
    }


def vnd(n: float | int) -> str:
    """Dinh dang 1234567 -> '1.234.567' (kieu Viet Nam)."""
    return f"{int(round(float(n or 0))):,}".replace(",", ".")
