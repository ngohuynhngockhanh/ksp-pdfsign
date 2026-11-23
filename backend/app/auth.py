"""Dang nhap + phan quyen (admin/khach hang) bang JWT cookie (PyJWT), nguoi dung trong DB."""
from __future__ import annotations

import hmac
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWTError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import RevokedToken, User, get_session
from .security import hash_password, verify_password

COOKIE_NAME = "ksp_session"
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
_MUST_CHANGE_ALLOWLIST = {"/api/me", "/api/me/password", "/api/logout"}


@dataclass
class CurrentUser:
    id: int
    username: str
    role: str
    customer_id: int | None
    training_access: bool = False
    ip: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def portal_scope(self) -> str:
        return "pymid_coop" if self.role == "pymid_staff" else "full"


def require_full_portal(user: CurrentUser) -> None:
    if user.portal_scope != "full":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Tài khoản nhân viên PYMID chỉ được truy cập INUT - PYMID CO.OP",
        )


def _read_private_token_file(path_str: str) -> str | None:
    if not path_str:
        return None
    token_file = Path(path_str)
    try:
        mode = token_file.stat().st_mode & 0o777
        if mode & 0o077:
            return None
        expected = token_file.read_text(encoding="utf-8").strip()
        return expected or None
    except (OSError, UnicodeError):
        return None


def _is_direct_loopback(request: Request) -> tuple[bool, str]:
    client_host = (request.client.host if request.client else "").replace("::ffff:", "")
    if client_host not in _LOOPBACK_HOSTS:
        return False, client_host
    if request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip"):
        return False, client_host
    return True, client_host


def _extract_bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return None
    supplied = header[7:].strip()
    return supplied or None


def _admin_service_user(db: Session, client_host: str) -> CurrentUser | None:
    user = db.scalar(select(User).where(User.role == "admin").order_by(User.id.asc()))
    if user is None:
        return None
    return CurrentUser(
        id=user.id,
        username=user.username,
        role=user.role,
        customer_id=user.customer_id,
        training_access=bool(user.training_access),
        ip=client_host,
    )


def authenticate_mcp_bearer(request: Request, db: Session) -> CurrentUser | None:
    """Authenticate the local MCP backend service without requiring a second admin password.

    When INUT_CRM_BACKEND_TOKEN_FILE is configured, ONLY that dedicated backend token
    is accepted (ensuring external/client MCP tokens cannot call backend APIs directly).
    Falls back to INUT_CRM_MCP_TOKEN_FILE when no split backend token file is configured.
    """
    ok_loopback, client_host = _is_direct_loopback(request)
    if not ok_loopback:
        return None
    supplied = _extract_bearer(request)
    if not supplied:
        return None

    settings = get_settings()
    backend_token_path = (
        os.environ.get("INUT_CRM_BACKEND_TOKEN_FILE", "").strip()
        or (settings.inut_crm_backend_token_file or "").strip()
    )
    if backend_token_path:
        token_path = backend_token_path
    else:
        token_path = os.environ.get(
            "INUT_CRM_MCP_TOKEN_FILE",
            str(Path.home() / ".config" / "inut-crm" / "inut-crm.token"),
        )

    expected = _read_private_token_file(token_path)
    if not expected or not hmac.compare_digest(supplied, expected):
        return None
    return _admin_service_user(db, client_host)


def authenticate_loopback_bearer(request: Request, db: Session) -> CurrentUser | None:
    """Authenticate trusted local loopback services (9router, BLE/Clabel scripts, MCP).

    Accepts a valid private (0600) token from LOOPBACK_SERVICE_TOKEN_FILE,
    INUT_CRM_BACKEND_TOKEN_FILE, or (when no split backend token file is set)
    INUT_CRM_MCP_TOKEN_FILE — strictly from direct loopback without proxy headers.
    """
    ok_loopback, client_host = _is_direct_loopback(request)
    if not ok_loopback:
        return None
    supplied = _extract_bearer(request)
    if not supplied:
        return None

    settings = get_settings()
    candidate_files: list[str] = []
    loopback_file = (
        os.environ.get("LOOPBACK_SERVICE_TOKEN_FILE", "").strip()
        or (settings.loopback_service_token_file or "").strip()
    )
    if loopback_file:
        candidate_files.append(loopback_file)

    backend_file = (
        os.environ.get("INUT_CRM_BACKEND_TOKEN_FILE", "").strip()
        or (settings.inut_crm_backend_token_file or "").strip()
    )
    if backend_file:
        candidate_files.append(backend_file)
    else:
        mcp_file = os.environ.get(
            "INUT_CRM_MCP_TOKEN_FILE",
            str(Path.home() / ".config" / "inut-crm" / "inut-crm.token"),
        )
        if mcp_file:
            candidate_files.append(mcp_file)

    for path_str in candidate_files:
        expected = _read_private_token_file(path_str)
        if expected and hmac.compare_digest(supplied, expected):
            return _admin_service_user(db, client_host)
    return None


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
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_ttl_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.effective_jwt_secret(), algorithm="HS256")


def extract_request_token(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
    return token or ""


def revoke_token(db: Session, token: str, settings: Settings) -> bool:
    """Revoke a single JWT session by persisting its jti in revoked_tokens."""
    if not token:
        return False
    try:
        payload = jwt.decode(
            token,
            settings.effective_jwt_secret(),
            algorithms=["HS256"],
            options={"verify_exp": False},
        )
    except PyJWTError:
        return False
    jti = str(payload.get("jti") or "").strip()
    if not jti:
        return False
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    exp_raw = payload.get("exp")
    if isinstance(exp_raw, (int, float)):
        exp_dt = datetime.fromtimestamp(exp_raw, tz=timezone.utc).replace(tzinfo=None)
    else:
        exp_dt = now_naive + timedelta(minutes=settings.jwt_ttl_minutes)
    try:
        db.execute(delete(RevokedToken).where(RevokedToken.expires_at < now_naive))
        if db.get(RevokedToken, jti) is None:
            db.add(RevokedToken(jti=jti, expires_at=exp_dt))
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False


def require_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    mcp_user = authenticate_mcp_bearer(request, db)
    if mcp_user is not None:
        return mcp_user
    token = extract_request_token(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chua dang nhap")
    try:
        p = jwt.decode(token, settings.effective_jwt_secret(), algorithms=["HS256"])
    except PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien khong hop le")
    try:
        uid = int(p.get("uid", 0))
        sv = int(p.get("sv", 0))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien khong hop le")
    jti = str(p.get("jti") or "").strip()
    if jti and db.get(RevokedToken, jti) is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien da dang xuat")
    user = db.get(User, uid)
    if not user or sv != user.session_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phien da bi thu hoi")
    if user.must_change_password and request.url.path not in _MUST_CHANGE_ALLOWLIST:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Bắt buộc đổi mật khẩu lần đầu",
        )
    return CurrentUser(
        id=user.id,
        username=user.username,
        role=user.role,
        customer_id=user.customer_id,
        training_access=bool(user.training_access),
        ip=request.client.host if request.client else "",
    )


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chi admin duoc phep")
    return user


def require_training(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin and not user.training_access:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tai khoan chua duoc cap quyen iNut Training")
    return user
