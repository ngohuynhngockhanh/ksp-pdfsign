"""Allowlisted public iNut catalog used by the Facebook Hermes boundary.

This module deliberately has no database imports.  Messenger may read only
the three public website pages below; it never falls back to CRM, inventory,
sales invoices, purchase invoices, or internal prices.
"""
from __future__ import annotations

from html import unescape
import re
import threading
import time
import unicodedata
from typing import Any

import httpx


PUBLIC_PRODUCT_SPECS: tuple[dict[str, Any], ...] = (
    {
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485 gateway", "gateway modbus", "rs485", "rs 485"),
    },
    {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": (
            "inut datalogger", "data logger", "datalogger", "datalogger cong nghiep",
            "inut pc", "edge server",
        ),
    },
    {
        "key": "billiard",
        "name": "iNut BilliardLive",
        "url": "https://inut.vn/solutions/billiard-live",
        "aliases": (
            "inut billiardlive", "billiardlive", "billiard live", "billiard", "bida",
            "check var",
        ),
    },
)
_PUBLIC_PRODUCT_URLS = frozenset(spec["url"] for spec in PUBLIC_PRODUCT_SPECS)

# Sales copy is intentionally static and product-level. Prices still come only
# from the live allowlisted pages below.
_SALES_GUIDE: dict[str, dict[str, str]] = {
    "rs485": {
        "benefit": "kết nối và gom dữ liệu thiết bị Modbus/RS485 về hệ thống",
        "fit": "PLC, đồng hồ, cảm biến hoặc thiết bị công nghiệp có RS485",
        "question": "Bạn đang kết nối thiết bị nào và cần khoảng bao nhiêu điểm đo?",
    },
    "datalogger": {
        "benefit": "thu thập, lưu trữ và xử lý dữ liệu tại hiện trường/edge",
        "fit": "nhà máy, trạm đo hoặc dự án cần gateway và dashboard tập trung",
        "question": "Bạn cần thu thập dữ liệu từ giao thức nào và muốn xem ở đâu?",
    },
    "billiard": {
        "benefit": "hỗ trợ CLB bida quản lý nội dung và livestream theo quy mô",
        "fit": "CLB bida cần QR, clip bàn hoặc luồng livestream cho khách",
        "question": "CLB của bạn có khoảng bao nhiêu bàn và đang muốn ưu tiên tính năng nào?",
    },
}

# Strong problem signals used for consultation routing only. These hints must
# never be used to infer a price for a product the customer did not name.
_SOLUTION_HINTS: dict[str, tuple[str, ...]] = {
    "rs485": (
        "rs485", "modbus rtu", "gateway", "cảm biến", "cam bien", "đồng hồ",
        "dong ho", "slave",
    ),
    "datalogger": (
        "plc", "siemens", "omron", "mitsubishi", "scada", "fuxa", "dashboard",
        "edge", "modbus tcp", "điểm đo", "diem do", "trạm đo", "tram do",
        "thu thập dữ liệu", "thu thap du lieu",
    ),
    "billiard": (
        "billiard", "bida", "qr code", "clip bàn",
        "clip ban", "clb bida",
    ),
}

_PRICE_RE = re.compile(
    r"giá\s+(?:niêm\s+yết\s+)?từ\s+([0-9]{1,3}(?:\.[0-9]{3})+)\s*(?:đ|₫|vnd)",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(?:script|style)\b.*?</(?:script|style)>", re.IGNORECASE | re.DOTALL)
_FOLD_RE = re.compile(r"[^a-z0-9]+")
_PRICE_QUERY_STOPWORDS = frozenset({
    "a", "bao", "ban", "bao gia", "bo", "cai", "can", "cho", "chi", "chinh",
    "co", "con", "cost", "cua", "duoc", "gia", "gi", "giup", "goi", "hoi", "khong",
    "la", "mua", "nao", "nhieu", "niem", "o", "price", "tham", "the", "theo",
    "tien", "toi", "tu", "va", "vay", "voi", "web", "website", "xin", "yet",
    "cong", "nghiep", "san", "pham", "cong", "ty", "hang", "mon", "nay", "dang",
    "xem", "vua", "loai", "nhom",
})
_CACHE_LOCK = threading.Lock()
_CACHE: tuple[dict[str, Any], ...] = ()
_CACHE_EXPIRES_AT = 0.0
_CACHE_TTL_SECONDS = 300.0


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").casefold()).replace("đ", "d")
    without_marks = "".join(char for char in normalized if not unicodedata.combining(char))
    return _FOLD_RE.sub(" ", without_marks).strip()


def _visible_text(document: str) -> str:
    without_scripts = _SCRIPT_RE.sub(" ", document)
    without_comments = re.sub(r"<!--.*?-->", " ", without_scripts, flags=re.DOTALL)
    return " ".join(unescape(_TAG_RE.sub(" ", without_comments)).split())


def _parse_price(document: str) -> str:
    match = _PRICE_RE.search(_visible_text(document))
    return f"{match.group(1)}đ" if match else "Liên hệ báo giá theo quy mô"


def _unavailable_entry(spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": spec["key"],
        "name": spec["name"],
        "url": spec["url"],
        "aliases": tuple(spec["aliases"]),
        "price_text": "Chưa đọc được giá công khai",
        "source": "public-web",
    }


def _is_public_entry(entry: dict[str, Any]) -> bool:
    return (
        str(entry.get("url", "")) in _PUBLIC_PRODUCT_URLS
        and str(entry.get("source", "")) == "public-web"
    )


def _fetch_entry(spec: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        response = httpx.get(
            spec["url"],
            headers={"User-Agent": "iNut-Facebook-Public-Catalog/1.0"},
            timeout=timeout,
            follow_redirects=True,
        )
        response.raise_for_status()
        if len(response.content) > 4 * 1024 * 1024:
            return _unavailable_entry(spec)
        final_host = (response.url.host or "").lower()
        if final_host not in {"inut.vn", "www.inut.vn"}:
            return _unavailable_entry(spec)
        return {
            "key": spec["key"],
            "name": spec["name"],
            "url": spec["url"],
            "aliases": tuple(spec["aliases"]),
            "price_text": _parse_price(response.text),
            "source": "public-web",
        }
    except (httpx.HTTPError, UnicodeError):
        return _unavailable_entry(spec)


def clear_cache() -> None:
    global _CACHE, _CACHE_EXPIRES_AT
    with _CACHE_LOCK:
        _CACHE = ()
        _CACHE_EXPIRES_AT = 0.0


def fetch_public_catalog(*, force: bool = False, timeout: float = 5.0) -> list[dict[str, Any]]:
    """Fetch exactly the allowlisted public pages, never internal data."""
    global _CACHE, _CACHE_EXPIRES_AT
    now = time.monotonic()
    with _CACHE_LOCK:
        if _CACHE and not force and now < _CACHE_EXPIRES_AT:
            return [dict(entry) for entry in _CACHE]
        entries = tuple(_fetch_entry(spec, max(1.0, min(float(timeout), 15.0))) for spec in PUBLIC_PRODUCT_SPECS)
        _CACHE = entries
        _CACHE_EXPIRES_AT = now + _CACHE_TTL_SECONDS
        return [dict(entry) for entry in entries]


def matching_products(question: str, entries: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    folded_question = _fold(question)
    if not folded_question:
        return []
    padded_question = f" {folded_question} "
    catalog = entries if entries is not None else fetch_public_catalog()
    return [
        entry for entry in catalog
        if _is_public_entry(entry)
        and any(f" {_fold(alias)} " in padded_question for alias in entry.get("aliases", ()))
    ]


def suggested_products(question: str, entries: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Suggest one public product from a concrete problem signal.

    This is intentionally separate from ``matching_products``: a customer who
    says "PLC Siemens" can receive a useful consultation, but must not receive
    a numeric product price unless they name that product explicitly.
    """
    catalog = [
        entry for entry in (entries if entries is not None else fetch_public_catalog())
        if _is_public_entry(entry)
    ]
    folded = _fold(question)
    if not folded:
        return []
    exact = matching_products(question, catalog)
    if exact:
        return exact
    scores: list[tuple[int, dict[str, Any]]] = []
    for entry in catalog:
        hints = _SOLUTION_HINTS.get(str(entry.get("key") or ""), ())
        score = sum(1 for hint in hints if _fold(hint) in folded)
        if score:
            scores.append((score, entry))
    if not scores:
        return []
    best_score = max(score for score, _entry in scores)
    best = [entry for score, entry in scores if score == best_score]
    return best if best_score >= 1 else []


def has_unknown_price_terms(question: str) -> bool:
    """Reject a price question that mixes an allowlisted product with another item."""
    remaining = _fold(question)
    aliases = sorted(
        {_fold(alias) for spec in PUBLIC_PRODUCT_SPECS for alias in spec["aliases"]},
        key=len,
        reverse=True,
    )
    for alias in aliases:
        remaining = re.sub(
            rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])",
            " ",
            remaining,
        )
    remaining = re.sub(r"\b\d+(?:[.,]\d+)*\b", " ", remaining)
    terms = [term for term in remaining.split() if term not in _PRICE_QUERY_STOPWORDS]
    return bool(terms)


def format_catalog(entries: list[dict[str, Any]] | None = None) -> str:
    catalog = [
        entry for entry in (entries if entries is not None else fetch_public_catalog())
        if _is_public_entry(entry)
    ]
    lines = [
        "Giá tham khảo công khai của iNut (chỉ lấy từ website, không lấy từ hóa đơn hoặc dữ liệu nội bộ):",
    ]
    for entry in catalog:
        lines.append(f"- {entry['name']}: {entry['price_text']} · {entry['url']}")
    return "\n".join(lines)


_QTY_UNIT_DISPLAY = {
    "may": "máy",
    "diem": "điểm",
    "ban": "bàn",
    "bo": "bộ",
    "cai": "cái",
}
_QTY_RE = re.compile(r"(?:khoang\s+)?(\d{1,4})\s*(may|diem|ban|bo|cai)")


def _best_quantity(folded: str, *, near: str = "") -> re.Match[str] | None:
    """Prefer machine/point counts, then the quantity nearest a product cue."""
    matches = list(_QTY_RE.finditer(folded))
    if not matches:
        return None
    ranked = [match for match in matches if match.group(2) in {"may", "diem"}] or matches
    if near:
        position = folded.find(near)
        if position >= 0:
            return min(ranked, key=lambda match: abs(match.start() - position))
    return ranked[-1]


def _quantity_label(match: re.Match[str]) -> str:
    approx = "khoảng " if match.group(0).startswith("khoang") else ""
    unit = _QTY_UNIT_DISPLAY.get(match.group(2), match.group(2))
    return f"{approx}{match.group(1)} {unit}"


def _problem_hook(question: str) -> str:
    """Echo a concrete customer problem so the reply does not sound like a brochure."""
    raw = str(question or "").strip()
    if not raw:
        return ""
    folded = _fold(raw)
    padded = f" {folded} "
    if re.search(r"(?i)\bplc\b", raw) or " plc " in padded:
        brand = ""
        for name in ("Siemens", "Omron", "Mitsubishi"):
            if name.casefold() in folded:
                brand = f" {name}"
                break
        parts = [f"PLC{brand}".strip()]
        quantity = _best_quantity(folded, near="plc")
        if quantity:
            parts.append(_quantity_label(quantity))
        return " ".join(parts)
    if " tram do " in padded:
        return "Trạm đo"
    if " clb bida " in padded or " cau lac bo bida " in padded:
        return "CLB bida"
    if " nha may " in padded:
        return "Nhà máy"
    quantity = _best_quantity(folded)
    if quantity:
        return _quantity_label(quantity)
    return ""


def has_concrete_problem(question: str) -> bool:
    """True when the customer named a specific problem, not just a site or config."""
    hook = _problem_hook(question)
    return hook.startswith("PLC") or hook in {"Trạm đo", "CLB bida"}


def looks_like_follow_up_details(question: str) -> bool:
    """A later turn that adds device/quantity detail instead of naming a new product."""
    return has_concrete_problem(question) or bool(_QTY_RE.search(_fold(question)))


def discovery_already_answered(question: str, product_key: str) -> bool:
    """Skip the stock discovery question when the customer already answered it."""
    hook = _problem_hook(question)
    has_qty = bool(_QTY_RE.search(_fold(question)))
    key = str(product_key or "")
    if key == "rs485":
        return hook.startswith("PLC") and has_qty
    if key == "datalogger":
        return bool(hook) and has_qty
    if key == "billiard":
        return hook == "CLB bida" and has_qty
    return False


def format_sales_catalog(entries: list[dict[str, Any]] | None = None) -> str:
    """Return a short consultant-style overview using only public products."""
    catalog = [
        entry for entry in (entries if entries is not None else fetch_public_catalog())
        if _is_public_entry(entry)
    ]
    count = len(catalog) or 3
    lines = [f"iNut đang có {count} hướng mình tư vấn được luôn:"]
    for entry in catalog:
        guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
        benefit = guide.get("benefit") or "giải pháp IoT theo nhu cầu"
        price = str(entry.get("price_text") or "Chưa đọc được giá công khai")
        price_label = price if price.lower().startswith(("liên hệ", "chưa đọc")) else f"từ {price}"
        lines.append(f"- {entry['name']}: {benefit}; {price_label} · {entry['url']}")
    lines.append("Bạn đang giải quyết bài toán nào?")
    return "\n".join(lines)


def format_price_discovery(entries: list[dict[str, Any]] | None = None) -> str:
    """Answer a vague price question like a consultant, not a data refusal."""
    catalog = [
        entry for entry in (entries if entries is not None else fetch_public_catalog())
        if _is_public_entry(entry)
    ]
    names = ", ".join(str(entry["name"]) for entry in catalog[:3])
    if not names:
        names = "RS485, Datalogger/iNut PC hoặc BilliardLive"
    return (
        "Mình báo giá ngay được ạ, nhưng cần biết bạn đang hỏi sản phẩm nào để không báo nhầm. "
        f"iNut hiện có {names}. Bạn đang quan tâm nhóm nào hoặc đang giải quyết bài toán gì?"
    )


def format_unknown_product_price(question: str = "") -> str:
    """Handle an unknown product name without exposing private catalog data."""
    return (
        "Mình chưa thấy giá công khai của sản phẩm bạn vừa nhắc trên website iNut nên không muốn báo nhầm. "
        "Bạn cho mình biết mục đích sử dụng và số lượng dự kiến; nhân viên iNut sẽ xác nhận cấu hình và giá "
        "phù hợp qua Zalo/điện thoại nếu bạn muốn nhé."
    )


def format_product_consultation(
    entry: dict[str, Any],
    *,
    include_price: bool = False,
    question: str = "",
    skip_discovery: bool = False,
) -> str:
    """Compose a short chat-style answer for one public product."""
    if not _is_public_entry(entry):
        return ""
    guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
    benefit = guide.get("benefit") or "giải pháp IoT theo nhu cầu"
    fit = guide.get("fit") or "dự án IoT của bạn"
    price = str(entry.get("price_text") or "")
    price_line = ""
    if include_price and price and not price.lower().startswith("chưa đọc"):
        price_line = f" Giá tham khảo {price if price.lower().startswith('liên hệ') else 'từ ' + price}."
    discovery = guide.get("question") or "Bạn cho mình biết nhu cầu và số lượng để mình tư vấn chính xác nhé."
    hook = _problem_hook(question)
    if hook:
        opening = f"Với {hook} thì mình hay dùng {entry['name']} để {benefit}."
    else:
        opening = f"Mình hay dùng {entry['name']} để {benefit}, hợp với {fit}."
    if skip_discovery or discovery_already_answered(question, str(entry.get("key") or "")):
        discovery = "Nếu đúng hướng này, mình chuyển nhân viên xác nhận cấu hình nhé."
    return f"{opening}{price_line} Chi tiết đây: {entry['url']}. {discovery}"


def format_purchase_consultation(
    entry: dict[str, Any], *, question: str = "", skip_discovery: bool = False,
) -> str:
    """Answer a buy intent without the brochure formula."""
    if not _is_public_entry(entry):
        return ""
    guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
    benefit = guide.get("benefit") or "giải pháp IoT theo nhu cầu"
    discovery = guide.get("question") or "Bạn cho mình biết nhu cầu và số lượng để tư vấn chính xác nhé."
    hook = _problem_hook(question)
    if hook:
        opening = f"Mình thấy {entry['name']} có thể phù hợp với {hook} vì giúp {benefit}."
    else:
        opening = f"Mình thấy {entry['name']} có thể phù hợp vì giúp {benefit}."
    if skip_discovery or discovery_already_answered(question, str(entry.get("key") or "")):
        discovery = "Nếu đúng hướng này, mình chuyển nhân viên xác nhận cấu hình nhé."
    return f"{opening} Chi tiết đây: {entry['url']}. {discovery}"


def format_product_link(entry: dict[str, Any]) -> str:
    """Return a direct link response without dumping unrelated catalog data."""
    if not _is_public_entry(entry):
        return ""
    guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
    return (
        f"Mình gửi bạn link {entry['name']} đây ạ: {entry['url']} "
        f"Nếu bạn nói thêm bài toán và quy mô, mình sẽ gợi ý cấu hình sát hơn."
    )


def format_custom_order_handoff(entry: dict[str, Any] | None = None) -> str:
    """Move custom/volume requests to a human without exposing internal data."""
    if entry and _is_public_entry(entry):
        product = str(entry.get("name") or "giải pháp iNut")
        # Keep the handoff to one explicit discovery CTA; "bạn đang cần" would
        # look like a second question to clients that enforce one next step.
        opening = f"Mình hiểu nhu cầu {product} theo cấu hình riêng hoặc số lượng lớn."
    else:
        opening = "Mình hiểu nhu cầu cấu hình riêng hoặc đơn số lượng lớn của bạn."
    return (
        f"{opening} Đơn này cần nhân viên xác nhận cấu hình và giá theo quy mô, "
        "mình không tự chốt trên chat. "
        "Bạn cho mình biết số lượng/điểm đo và khu vực triển khai để mình chuyển tiếp nhé."
    )


def format_commercial_handoff(entry: dict[str, Any] | None = None) -> str:
    """Ask for the minimum context needed to confirm delivery or policy details."""
    if entry and _is_public_entry(entry):
        product = str(entry.get("name") or "sản phẩm iNut")
        return (
            f"Giao hàng/bảo hành của {product} mình không tự chốt trên chat, "
            "để nhân viên xác nhận theo khu vực và số lượng cho chuẩn. "
            "Bạn cho mình biết khu vực triển khai và số lượng dự kiến nhé."
        )
    return (
        "Giao hàng/bảo hành mình không tự chốt trên chat, "
        "để nhân viên xác nhận theo khu vực và số lượng cho chuẩn. "
        "Bạn cho mình biết sản phẩm, khu vực triển khai và số lượng dự kiến nhé."
    )


def format_demo_discovery(entry: dict[str, Any] | None = None) -> str:
    """Offer a low-pressure demo conversation without inventing a demo URL."""
    if entry and _is_public_entry(entry):
        product = str(entry.get("name") or "giải pháp iNut")
        link = str(entry.get("url") or "")
        return (
            f"Demo {product} được, mình tư vấn theo bài toán thực tế hơn là gửi tài liệu chung. "
            f"Link: {link}. "
            "Bạn muốn demo kết nối/thu thập dữ liệu hay một tính năng cụ thể nào?"
        )
    return (
        "Demo được, mình tư vấn theo bài toán thực tế hơn là gửi tài liệu chung. "
        "Bạn muốn demo kết nối PLC/Modbus, thu thập dữ liệu hay BilliardLive cho CLB bida?"
    )


def format_matches(entries: list[dict[str, Any]]) -> str:
    entries = [entry for entry in entries if _is_public_entry(entry)]
    if not entries:
        return ""
    discovery = (
        _SALES_GUIDE.get(str(entries[0].get("key") or ""), {}).get("question")
        or "Bạn cho mình biết nhu cầu và số lượng để mình tư vấn cấu hình phù hợp nhé."
    )
    if len(entries) == 1:
        entry = entries[0]
        guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
        benefit = guide.get("benefit") or "giải pháp IoT theo nhu cầu"
        price = str(entry.get("price_text") or "Chưa đọc được giá công khai")
        price_label = price if price.lower().startswith(("liên hệ", "chưa đọc")) else f"từ {price}"
        return (
            f"Giá tham khảo {entry['name']} trên web là {price_label} nhé — {benefit}. "
            f"Chi tiết đây: {entry['url']}. {discovery}"
        )
    lines = ["Mình gửi giá tham khảo trên web luôn nhé:"]
    for entry in entries:
        guide = _SALES_GUIDE.get(str(entry.get("key") or ""), {})
        benefit = guide.get("benefit") or "giải pháp IoT theo nhu cầu"
        price = str(entry.get("price_text") or "Chưa đọc được giá công khai")
        price_label = price if price.lower().startswith(("liên hệ", "chưa đọc")) else f"từ {price}"
        lines.append(f"- {entry['name']}: {price_label} · {benefit} · {entry['url']}")
    lines.append(discovery)
    return "\n".join(lines)


def sales_guide(entry: dict[str, Any]) -> dict[str, str]:
    """Expose only the static sales guidance for an allowlisted product."""
    if not _is_public_entry(entry):
        return {}
    return dict(_SALES_GUIDE.get(str(entry.get("key") or ""), {}))
