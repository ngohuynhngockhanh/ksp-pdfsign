"""Sinh Bien ban ban giao (BBBG) tu template HTML (Jinja2) -> PDF (WeasyPrint).

Them mau moi: bo 1 file .html vao templates_bbbg/ va dang ky vao TEMPLATES.
"""
from __future__ import annotations

import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from .config import Settings

_TPL_DIR = Path(__file__).parent / "templates_bbbg"

# Registry template — them mau moi chi can them 1 dong + 1 file HTML.
TEMPLATES: dict[str, dict] = {
    "bbbg_thiet_bi": {"file": "bbbg_thiet_bi.html", "label": "Biên bản bàn giao thiết bị"},
}

_env = Environment(
    loader=FileSystemLoader(str(_TPL_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


def list_templates() -> list[dict]:
    return [{"key": k, "label": v["label"]} for k, v in TEMPLATES.items()]


def _logo_data_uri(settings: Settings) -> str:
    p = settings.logo_path
    if p.exists():
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
    return ""


def default_ben_a(settings: Settings) -> dict:
    return {
        "company": settings.bbbg_company,
        "address": settings.bbbg_address,
        "mst": settings.bbbg_mst,
        "phone": settings.bbbg_phone,
        "rep": settings.bbbg_rep,
        "title": settings.bbbg_rep_title,
    }


def render_bbbg(settings: Settings, data: dict) -> bytes:
    key = data.get("template_key") or "bbbg_thiet_bi"
    if key not in TEMPLATES:
        raise ValueError(f"Template khong ton tai: {key}")
    ngay = data.get("ngay") or {"day": 1, "month": 1, "year": 2026}
    ctx = {
        "so_bb": data.get("so_bb", ""),
        "noi_lap": data.get("noi_lap") or "Đắk Lắk",
        "ngay": {
            "day": int(ngay.get("day", 1)),
            "month": int(ngay.get("month", 1)),
            "year": int(ngay.get("year", 2026)),
        },
        "ben_a": {**default_ben_a(settings), **(data.get("ben_a") or {})},
        "ben_b": data.get("ben_b") or {},
        "items": data.get("items") or [],
        "logo_data_uri": _logo_data_uri(settings),
    }
    html = _env.get_template(TEMPLATES[key]["file"]).render(**ctx)
    return HTML(string=html).write_pdf()
