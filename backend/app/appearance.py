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

    pad = int(5 * scale)
    font_path = settings.signature_font

    def wrap_balanced(r: str, font) -> list[str]:
        if draw.textlength(r, font=font) <= W - 2 * pad:
            return [r]
        words = [w for w in r.split(" ") if w]
        if not words:
            return []
        lines: list[str] = []
        cur = ""
        for w in words:
            t = (cur + " " + w).strip()
            if draw.textlength(t, font=font) <= W - 2 * pad:
                cur = t
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        # Cân đối từ ngữ: tránh để chữ đơn côi (orphan word như 'INUT') đứng một mình ở dòng cuối
        if len(lines) >= 2 and len(lines[-1].split()) == 1:
            prev_words = lines[-2].split()
            if len(prev_words) > 2:
                candidate_last = prev_words[-1] + " " + lines[-1]
                candidate_prev = " ".join(prev_words[:-1])
                if draw.textlength(candidate_last, font=font) <= W - 2 * pad:
                    lines[-2] = candidate_prev
                    lines[-1] = candidate_last
        return lines

    def wrap(rows_list, font):
        out = []
        for r in rows_list:
            out.extend(wrap_balanced(r, font))
        return out

    # Tự động chọn cỡ chữ phù hợp nhất: ưu tiên dòng Ký bởi không bị xuống dòng nếu vừa
    min_fs = max(8, int(2.5 * scale))
    max_fs = max(min_fs + 1, int(H * 0.22))
    best_wrapped = wrap(rows, ImageFont.truetype(font_path, min_fs))
    best_fs = min_fs
    best_line_h = min_fs * 1.3

    # Bước 1: Thử tìm cỡ chữ lớn nhất mà "Ký bởi: {signer}" không bị rớt dòng
    for fs in range(max_fs, min_fs - 1, -1):
        font = ImageFont.truetype(font_path, fs)
        if draw.textlength(rows[0], font=font) <= W - 2 * pad:
            w_lines = wrap(rows, font)
            lh = fs * 1.3
            tot = lh * len(w_lines)
            if tot <= H - 2 * pad:
                best_wrapped = w_lines
                best_fs = fs
                best_line_h = lh
                break
    else:
        # Bước 2: Nếu không thể trên 1 dòng, tìm cỡ chữ lớn nhất vừa khung mà ngắt dòng cân đối
        for fs in range(max_fs, min_fs - 1, -1):
            font = ImageFont.truetype(font_path, fs)
            w_lines = wrap(rows, font)
            lh = fs * 1.3
            tot = lh * len(w_lines)
            fits_w = all(draw.textlength(x, font=font) <= W - 2 * pad for x in w_lines)
            has_orphan = any(len(line.split()) <= 1 for line in w_lines if len(line) < 6)
            if tot <= H - 2 * pad and fits_w and not has_orphan:
                best_wrapped = w_lines
                best_fs = fs
                best_line_h = lh
                break

    y = max(pad // 2, (H - best_line_h * len(best_wrapped)) / 2)
    font = ImageFont.truetype(font_path, best_fs)
    for line in best_wrapped:
        draw.text((pad, y), line, fill=(11, 37, 64, 255), font=font)
        y += best_line_h
    return img
