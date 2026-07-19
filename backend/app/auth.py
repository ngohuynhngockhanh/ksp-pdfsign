"""Dang nhap + phan quyen (admin/khach hang) bang JWT cookie, nguoi dung trong DB."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import User, get_session
from .security import hash_password, verify_password

COOKIE_NAME = "ksp_session"


@dataclass
class CurrentUser:
    id: int
    username: str
    role: str
    customer_id: int | None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def ensure_admin_seed(db: Session, settings: Settings) -> None:
    """Tao/dong bo tai khoan admin tu .env khi khoi dong."""
    admin = db.scalar(select(User).where(User.username == settings.app_admin_username))
    if admin is None:
        db.add(
            User(
                username=settings.app_admin_username,
                password_hash=hash_password(settings.app_admin_password),
                role="admin",
            )
        )
        db.commit()


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if user and verify_password(password, user.password_hash):
        return user
    return None


def create_token(user: User, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.username,
        "uid": user.id,
        "role": user.role,
        "cid": user.customer_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.effective_jwt_secret(), algorithm="HS256")


def require_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chua dang nhap")
    try:
        p = jwt.decode(token, settings.effective_jwt_secret(), algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien khong hop le")
    return CurrentUser(
        id=int(p.get("uid", 0)),
        username=str(p.get("sub", "")),
        role=str(p.get("role", "customer")),
        customer_id=p.get("cid"),
    )


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chi admin duoc phep")
    return user
