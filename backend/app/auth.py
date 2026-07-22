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
    ip: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def ensure_admin_seed(db: Session, settings: Settings) -> None:
    """Tao/dong bo tai khoan admin tu .env khi khoi dong."""
    admin = db.scalar(select(User).where(User.username == settings.app_admin_username))
    if admin is None:
        if len(settings.app_admin_password) < 10:
            raise RuntimeError("APP_ADMIN_PASSWORD phai duoc dat va co it nhat 10 ky tu")
        db.add(
            User(
                username=settings.app_admin_username,
                password_hash=hash_password(settings.app_admin_password),
                role="admin",
            )
        )
        db.commit()
    elif settings.using_default_secrets and not admin.must_change_password:
        admin.must_change_password = True
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
        "sv": user.session_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.effective_jwt_secret(), algorithm="HS256")


def require_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chua dang nhap")
    try:
        p = jwt.decode(token, settings.effective_jwt_secret(), algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien khong hop le")
    user = db.get(User, int(p.get("uid", 0)))
    if not user or int(p.get("sv", 0)) != user.session_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien da bi thu hoi")
    return CurrentUser(
        id=int(p.get("uid", 0)),
        username=str(p.get("sub", "")),
        role=str(p.get("role", "customer")),
        customer_id=p.get("cid"),
        ip=request.client.host if request.client else "",
    )


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chi admin duoc phep")
    return user
