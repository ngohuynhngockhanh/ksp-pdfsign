"""Dang nhap trang web + bao ve route bang JWT cookie."""
from __future__ import annotations

import hmac
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt

from .config import Settings, get_settings

COOKIE_NAME = "ksp_session"


def verify_login(username: str, password: str, settings: Settings) -> bool:
    """So khop username/password voi cau hinh admin.

    Mat khau cau hinh la plaintext trong .env; so sanh bang hmac.compare_digest
    de constant-time, tranh ro ri thoi gian.
    """
    user_ok = hmac.compare_digest(username, settings.app_admin_username)
    pass_ok = hmac.compare_digest(password, settings.app_admin_password)
    return user_ok and pass_ok


def create_token(username: str, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode(token: str, settings: Settings) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def require_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> str:
    """Dependency: chan cac route can dang nhap. Tra ve username."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chua dang nhap")
    try:
        payload = _decode(token, settings)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien khong hop le")
    return str(payload.get("sub", ""))
