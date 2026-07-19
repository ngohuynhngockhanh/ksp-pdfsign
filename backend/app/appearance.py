"""Ve hinh chu ky (appearance) bang Pillow: logo chim + du truong, kieu Foxit.

Tu ve bang Pillow de tranh loi gian chu cua font TrueType trong pyHanko, va de
kiem soat pixel: can trai, tu xuong dong ten dai, tieng Viet chuan, logo chim.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .config import Settings

_VN_TZ = timezone(timedelta(hours=7))


def now_vn_str() -> str:
    return datetime.now(_VN_TZ).strftime("%H:%M:%S %d/%m/%Y")


def _bold_font_path(regular: str) -> str:
    b = regular.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
    return b if Path(b).exists() else regular


def render_signature(
    settings: Settings,
    box_w_pt: float,
    box_h_pt: float,
    signer: str,
    mst: str = "",
    reason: str = "",
    location: str = "",
    ts: str | None = None,
) -> Image.Image:
    """Tra ve anh RGBA cua hinh chu ky, ty le dung bang khung nguoi dung ve."""
    ts = ts or now_vn_str()
    scale = 4
    W, H = max(1, int(box_w_pt * scale)), max(1, int(box_h_pt * scale))
    img = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # Logo chim o giua
    logo_path = settings.logo_path
    if logo_path.exists():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            lh = int(H * 0.85)
            lw = max(1, int(logo.width * lh / logo.height))
            logo = logo.resize((lw, lh))
            alpha = logo.split()[3].point(lambda p: int(p * settings.logo_opacity))
            logo.putalpha(alpha)
            img.alpha_composite(logo, ((W - lw) // 2, (H - lh) // 2))
        except Exception:
            pass

    # Vien mong
    bw = max(1, scale // 2)
    draw.rectangle([1, 1, W - 2, H - 2], outline=(30, 111, 217, 180), width=bw)

    rows = [f"Ký bởi: {signer}"]
    if mst:
        rows.append(f"MST: {mst}")
    if reason:
        rows.append(f"Lý do: {reason}")
    if location:
        rows.append(f"Nơi ký: {location}")
    rows.append(f"Ngày ký: {ts}")

    pad = int(6 * scale)
    font_path = settings.signature_font

    def wrap(rows, font):
        out = []
        for r in rows:
            words, cur = r.split(" "), ""
            for w in words:
                t = (cur + " " + w).strip()
                if draw.textlength(t, font=font) <= W - 2 * pad:
                    cur = t
                else:
                    if cur:
                        out.append(cur)
                    cur = w
            out.append(cur)
        return out

    # Tu dong chon co chu lon nhat ma van vua khung
    wrapped, line_h, total = rows, 0, 0
    for fs in range(int(H * 0.18), max(7, 5 * scale), -1):
        font = ImageFont.truetype(font_path, fs)
        wrapped = wrap(rows, font)
        line_h = fs * 1.3
        total = line_h * len(wrapped)
        fits_w = all(draw.textlength(x, font=font) <= W - 2 * pad for x in wrapped)
        if total <= H - 2 * pad and fits_w:
            break

    y = (H - total) / 2
    for line in wrapped:
        draw.text((pad, y), line, fill=(11, 37, 64, 255), font=font)
        y += line_h

    return img
