"""Cau hinh dong (KV) — override len Settings tu .env, sua duoc tu web.

Chi cho phep override cac key AI (ai_*) va NAS (nas_*). Gia tri luu dang chuoi
trong bang app_settings, coerce ve dung kieu khi ap len Settings.
"""
from __future__ import annotations

from typing import Any

# Key duoc phep override tu web -> kieu de coerce chuoi ve dung type.
ALLOWED_KEYS: dict[str, str] = {
    "ai_enabled": "bool",
    "ai_base_url": "str",
    "ai_api_key": "str",
    "ai_model": "str",
    "ai_max_tokens": "int",
    "ai_timeout": "float",
    "nas_enabled": "bool",
    "nas_host": "str",
    "nas_share": "str",
    "nas_user": "str",
    "nas_password": "str",
    "nas_base_path": "str",
    "nas_timeout": "int",
    "ihoadon_enabled": "bool",
    "ihoadon_base_url": "str",
    "ihoadon_tax_code": "str",
    "ihoadon_username": "str",
    "ihoadon_password": "str",
    "ihoadon_timeout": "float",
}

# Key bi mat — che khi tra ra web (GET /settings)
SECRET_KEYS = {"ai_api_key", "nas_password", "ihoadon_password"}


def _coerce(kind: str, raw: str) -> Any:
    if kind == "bool":
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
    if kind == "int":
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            return 0
    if kind == "float":
        try:
            return float(raw)
        except (TypeError, ValueError):
            return 0.0
    return str(raw)


def get_overrides() -> dict[str, str]:
    """Doc toan bo override tu DB -> {key: value_str}. Loi/khong co bang -> {}."""
    try:
        from . import db as dbmod

        dbmod._init_engine()
        with dbmod._SessionLocal() as s:
            rows = s.query(dbmod.AppSetting).all()
            return {r.key: r.value for r in rows if r.key in ALLOWED_KEYS}
    except Exception:
        return {}


def apply_overrides(settings) -> None:
    """Ap override tu DB len object Settings (mutate tai cho)."""
    ov = get_overrides()
    for key, raw in ov.items():
        kind = ALLOWED_KEYS.get(key)
        if not kind:
            continue
        try:
            setattr(settings, key, _coerce(kind, raw))
        except Exception:
            pass


def set_overrides(values: dict[str, Any]) -> None:
    """Ghi/ cap nhat cac key vao DB. Bo qua key khong hop le. Coi None/'' cua key
    bi mat la 'khong doi' (khong xoa gia tri cu — de khong bat user nhap lai pass)."""
    from . import db as dbmod

    dbmod._init_engine()
    with dbmod._SessionLocal() as s:
        for key, val in values.items():
            if key not in ALLOWED_KEYS:
                continue
            if key in SECRET_KEYS and (val is None or str(val).strip() == ""):
                continue  # khong doi secret khi de trong
            sval = "" if val is None else str(val).strip() if isinstance(val, str) else (
                "true" if val is True else "false" if val is False else str(val)
            )
            row = s.get(dbmod.AppSetting, key)
            if row:
                row.value = sval
            else:
                s.add(dbmod.AppSetting(key=key, value=sval))
        s.commit()


def reload_settings() -> None:
    """Xoa cache get_settings + reset NAS session -> config moi co hieu luc ngay."""
    from . import config, nas

    config.get_settings.cache_clear()
    nas._registered_host = None  # buoc re-register session SMB voi user/pass moi
