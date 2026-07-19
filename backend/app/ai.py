"""Client AI tuong thich OpenAI /chat/completions.

Cam duoc vao 9router (local), OpenRouter, hay bat ky endpoint OpenAI-compat nao —
cau hinh qua .env: AI_ENABLED, AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_MAX_TOKENS.

Luu y 9router: body tra ve co the kem duoi "data: [DONE]" sau JSON -> parse bang
JSONDecoder().raw_decode() (lay object JSON dau tien). Model reasoning can
max_tokens lon (>=3500), neu nho content se rong.
"""
from __future__ import annotations

import json

import httpx

from .config import Settings


class AIError(RuntimeError):
    """Loi goi AI (mang, HTTP, response khong hop le)."""


class AINotConfigured(AIError):
    """Chua bat/cau hinh AI trong .env."""


def _parse_json_loose(text: str) -> dict:
    """Lay object JSON dau tien, bo qua duoi thua (vd 'data: [DONE]')."""
    obj, _ = json.JSONDecoder().raw_decode(text.strip())
    if not isinstance(obj, dict):
        raise AIError("Response AI khong phai JSON object")
    return obj


def chat(settings: Settings, messages: list[dict], temperature: float = 0.7) -> str:
    """Goi /chat/completions, tra ve content cua message dau tien."""
    if not settings.ai_enabled:
        raise AINotConfigured("Chưa cấu hình AI (đặt AI_ENABLED=true trong .env)")
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    try:
        resp = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.ai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.ai_model,
                "messages": messages,
                "max_tokens": settings.ai_max_tokens,
                "temperature": temperature,
            },
            timeout=settings.ai_timeout,
        )
    except httpx.HTTPError as e:
        raise AIError(f"Không gọi được AI ({url}): {e}")
    if resp.status_code != 200:
        raise AIError(f"AI trả lỗi HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        data = _parse_json_loose(resp.text)
    except (json.JSONDecodeError, AIError):
        raise AIError(f"Không đọc được response AI: {resp.text[:300]}")
    choices = data.get("choices") or []
    if not choices:
        raise AIError(f"AI không trả về choices: {resp.text[:300]}")
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not content:
        raise AIError(
            "AI trả về nội dung rỗng — thử tăng AI_MAX_TOKENS (model reasoning cần ≥3500)"
        )
    return content


def _json_from_content(content: str) -> dict:
    """Trich JSON tu content model tra ve (bo ```json fence / loi dan neu co)."""
    import re as _re

    s = content.strip()
    m = _re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, _re.S)
    if m:
        s = m.group(1)
    else:
        i, j = s.find("{"), s.rfind("}")
        if i >= 0 and j > i:
            s = s[i : j + 1]
    return json.loads(s)


def suggest_bom(
    settings: Settings,
    ten_bo: str,
    gia_ban: float,
    stock_items: list[dict],
    target_margin: tuple[float, float] = (0.15, 0.20),
    context: str = "",
    existing: list[dict] | None = None,
) -> dict:
    """AI boc tach 1 'bo thiet bi camera' thanh danh sach LINH KIEN cau thanh.

    stock_items: [{ma_hang, ten, dvt, don_gia_bq}] de AI uu tien dung ten co san trong kho.
    context: huong dan tu do cua user cho TUNG KEO cu the (vd doi hang, dieu kien lap dat...).
    existing: [{ten, so_luong, dvt}] cac dong DA CHON san (nut "AI goi y THEM") — AI se doi chieu
    quy mo thuc te va CHI tra ve phan CON THIEU/CAN BO SUNG, khong lap lai dong da du.
    Tra ve {"components":[{"ten","so_luong","ly_do"}], "cost_est","margin_est","note"}.
    """
    from .money import parse_num, vnd

    lo, hi = target_margin
    kho = "\n".join(
        f"- {i.get('ten','')} | ĐVT {i.get('dvt','')} | giá vốn {vnd(i.get('don_gia_bq') or 0)}đ"
        for i in stock_items[:200]
        if i.get("ten")
    )
    sys = (
        "Bạn là kỹ sư hệ thống camera giám sát của công ty iNut. Nhiệm vụ: bóc tách một "
        "'bộ thiết bị camera' bán cho khách thành danh sách LINH KIỆN cấu thành (camera, "
        "đầu ghi NVR/DVR, ổ cứng, nguồn, switch PoE, dây mạng, phụ kiện, công lắp đặt...).\n"
        "QUY TẮC SỐ LƯỢNG BẮT BUỘC: mọi thiết bị có GIỚI HẠN số kênh/cổng (đầu ghi NVR/DVR chỉ "
        "nối được đúng số kênh của nó — vd loại '8 kênh' chỉ nối 8 camera; switch PoE tương tự chỉ "
        "cấp nguồn được đúng số cổng). Nếu hệ thống có N camera, số đầu ghi cần = ceil(N / số kênh "
        "mỗi đầu ghi), số switch PoE cần = ceil(N / số cổng mỗi switch). KHÔNG BAO GIỜ để 1 đầu ghi "
        "8 kênh phục vụ hệ thống có hơn 8 camera. Trước khi trả lời, tự kiểm tra lại phép tính này "
        "cho TỪNG thiết bị có giới hạn kênh/cổng.\n"
        "QUY TẮC KHÔNG TRÙNG LẶP BẮT BUỘC: mỗi LOẠI linh kiện chỉ được xuất hiện ĐÚNG 1 LẦN trong "
        "mảng 'components' — nếu cần nhiều hơn 1 đơn vị, gộp vào MỘT dòng duy nhất với so_luong "
        "tương ứng, TUYỆT ĐỐI không tách 2 dòng riêng cho cùng một loại thiết bị (dù diễn đạt tên "
        "khác đi). Trước khi trả lời, tự rà lại 'components' xem có 2 dòng nào cùng bản chất thiết "
        "bị không — nếu có, gộp lại thành 1. Chỉ trả về JSON thuần, không markdown, không lời dẫn."
    )
    parts = [
        f'Bộ cần bóc tách: "{ten_bo}"',
        f"Giá bán chưa thuế: {vnd(gia_ban)}đ. Mục tiêu lợi nhuận {int(lo*100)}-{int(hi*100)}% "
        f"→ tổng giá vốn linh kiện nên khoảng {vnd(gia_ban*(1-hi))}–{vnd(gia_ban*(1-lo))}đ.",
        f"Mặt hàng ĐANG CÓ trong kho (ưu tiên đặt 'ten' TRÙNG các tên này nếu phù hợp):\n"
        f"{kho or '(kho trống)'}",
    ]
    if existing:
        existing_txt = "\n".join(
            f"- {e.get('ten','')} x{e.get('so_luong','')} {e.get('dvt','')}"
            for e in existing
            if e.get("ten")
        )
        parts.append(
            "Bộ này ĐÃ CHỌN SẴN các linh kiện sau (số lượng có thể ĐÚNG hoặc CHƯA ĐỦ so với quy "
            f"mô thực tế):\n{existing_txt}\n"
            "YÊU CẦU: đối chiếu lại với quy mô thực tế (đặc biệt quy tắc số kênh/cổng ở trên). "
            "Chỉ trả về trong 'components' phần CÒN THIẾU: (a) linh kiện hoàn toàn chưa có trong "
            "danh sách trên, HOẶC (b) nếu 1 linh kiện đã có nhưng số lượng đã chọn KHÔNG ĐỦ, hãy "
            "thêm 1 dòng ghi rõ SỐ LƯỢNG CẦN BỔ SUNG THÊM (không phải tổng số cần) và giải thích lý "
            "do trong 'ly_do'. TUYỆT ĐỐI KHÔNG lặp lại nguyên trạng các dòng đã đủ."
        )
    if context.strip():
        parts.append(
            "HƯỚNG DẪN THÊM CỦA NGƯỜI DÙNG cho tình huống NÀY (ưu tiên tuân theo, quan trọng hơn "
            f"suy đoán mặc định của bạn):\n{context.strip()}"
        )
    parts.append(
        'Trả về JSON: {"components":[{"ten":"...","so_luong":số,"ly_do":"..."}],'
        '"cost_est":số,"margin_est":số,"note":"..."}. '
        "Ước lượng thận trọng, KHÔNG bịa mã. Không chắc số lượng thì để 1 và ghi lý do."
    )
    user = "\n\n".join(parts)
    content = chat(
        settings,
        [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        temperature=0.2,
    )
    try:
        data = _json_from_content(content)
    except (json.JSONDecodeError, ValueError):
        raise AIError(f"AI không trả JSON hợp lệ: {content[:200]}")
    comps = []
    for c in data.get("components") or []:
        ten = str(c.get("ten") or "").strip()
        if not ten:
            continue
        comps.append({
            "ten": ten,
            "so_luong": parse_num(c.get("so_luong")) or 1.0,
            "ly_do": str(c.get("ly_do") or "")[:200],
        })
    return {
        "components": comps,
        "cost_est": parse_num(data.get("cost_est")),
        "margin_est": parse_num(data.get("margin_est")),
        "note": str(data.get("note") or "")[:400],
    }


def quote_narrative(
    settings: Settings,
    items: list[dict],
    khach: str = "",
    tong: float = 0,
    note: str = "",
    loai: str = "bao_gia",
) -> str:
    """Sinh doan thuyet minh tieng Viet cho bao gia / de nghi thanh toan."""
    from .money import vnd  # tranh import vong

    ds = "\n".join(
        f"- {it.get('ten','')} (SL {it.get('so_luong','')} {it.get('dvt','')})"
        for it in items
        if it.get("ten")
    )
    doc_label = "đề nghị thanh toán" if loai == "de_nghi_tt" else "báo giá"
    user = (
        f"Viết đoạn thuyết minh ngắn (2–3 đoạn văn, không quá 180 từ) cho bản {doc_label} "
        f"gửi khách hàng {khach or '(chưa rõ tên)'}.\n"
        f"Danh mục hàng hóa/dịch vụ:\n{ds or '- (chưa có)'}\n"
        f"Tổng giá trị: {vnd(tong)} đồng.\n"
        + (f"Ghi chú thêm: {note}\n" if note else "")
        + "Yêu cầu: văn phong lịch sự, chuyên nghiệp, nêu ngắn gọn lợi ích/giá trị "
        "của giải pháp, cam kết hỗ trợ; KHÔNG dùng markdown, KHÔNG gạch đầu dòng, "
        "KHÔNG bịa thông số kỹ thuật; trả về đúng phần văn bản thuyết minh."
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Bạn là trợ lý soạn thảo văn bản thương mại tiếng Việt của "
                "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (inut.vn). "
                "Chỉ trả về nội dung thuyết minh, không lời dẫn."
            ),
        },
        {"role": "user", "content": user},
    ]
    return chat(settings, messages)
