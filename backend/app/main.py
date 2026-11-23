"""FastAPI app: dang nhap, ky, kiem tra, quan ly khach hang & ho so."""
from __future__ import annotations

import hashlib
import hmac
import io as _io
import html
import json
import logging
import math
import re
import secrets
import threading
import time
import zipfile

logger = logging.getLogger("ksp_pdfsign")
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import (
    BackgroundTasks,
    Body,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import (
    doc_tracking,
    docx_preview,
    markdown_preview,
    xlsx_preview,
    gov_radar,
    accounts,
    ai,
    audit,
    bbbg,
    classify,
    crypto,
    invoice,
    ihoadon_sync,
    money,
    nas,
    security_utils,
    settings_store,
    signing,
    tax,
    tax_ops,
    tax_policy,
    tax_review,
    training,
    training_jobs,
    public_training,
    public_training_jobs,
    storage,
    token_backend,
    telegram,
    tts,
    verify,
)
from .customs_drive_api import router as customs_drive_router
from .pymid_api import router as pymid_router
from .auth import (
    COOKIE_NAME,
    CurrentUser,
    authenticate,
    authenticate_loopback_bearer,
    create_token,
    ensure_admin_seed,
    extract_request_token,
    require_admin,
    require_full_portal,
    require_training,
    require_user,
    revoke_token,
)
from .config import REPO_ROOT, Settings, get_settings
from .db import (
    AuditLog,
    Customer,
    CustomerAlias,
    ContractDraft,
    Document,
    InvIssue,
    IhoadonInvoice,
    JobRun,
    LoginLink,
    InvSale,
    Order,
    Product,
    Share,
    DocumentTracking,
    DocumentView,
    GovDocument,
    TaxReviewUpload,
    TaxReport,
    TrainingShare,
    TrainingQuery,
    TrainingKnowledge,
    TrainingPublicSession,
    TrainingPublicQuery,
    FacebookMessage,
    User,
    get_session,
    init_db,
)
from .inventory import normalize_name
from .schemas import (
    BilliardQuotePayload,
    AccountCreate,
    AccountInfo,
    AgentTarget,
    AssignRequest,
    AuditOut,
    AuditPage,
    BBBGGenerate,
    BulkAssign,
    BulkIds,
    CustomerCreate,
    CustomerMerge,
    DocTypeUpdate,
    DocumentRename,
    OrderAssign,
    OrderCreate,
    OrderOut,
    CustomerOut,
    CustomerUpdate,
    ContractAIRequest,
    ContractDraftSave,
    ContractGenerate,
    FactoryCertificateGenerate,
    DocumentOut,
    DocumentsPage,
    LoginRequest,
    PasswordChange,
    PasswordReset,
    ProductOut,
    QuoteGenerate,
    QuoteNarrativeRequest,
    ShareRequest,
    ShareResponse,
    SignRequest,
    SignResponse,
    UserOut,
    VerifyResponse,
)
from .security import hash_password, verify_password

from .inv_api import router as inv_router  # noqa: E402
from .payroll_api import router as payroll_router  # noqa: E402
from .facebook_api import router as facebook_router  # noqa: E402
from .spx_api import router as spx_router  # noqa: E402
from .bidding_api import router as bidding_router  # noqa: E402
from .standards_api import resume_tqc_import_jobs, router as standards_router  # noqa: E402
from .tax_defense_api import router as tax_defense_router  # noqa: E402
from .trademark_api import router as trademark_router  # noqa: E402
from .piecework_api import router as piecework_router  # noqa: E402
from .clabel_api import router as clabel_router  # noqa: E402
from .web_ads_api import router as web_ads_router  # noqa: E402

app = FastAPI(title="ksp-pdfsign", version="2.0.0")
app.include_router(inv_router)
app.include_router(payroll_router)
app.include_router(customs_drive_router)
app.include_router(pymid_router)
app.include_router(facebook_router)
app.include_router(spx_router)
app.include_router(bidding_router)
app.include_router(standards_router)
app.include_router(tax_defense_router)
app.include_router(trademark_router)
app.include_router(piecework_router)
app.include_router(clabel_router)
app.include_router(web_ads_router)



def _training_error(exc: training.TrainingError) -> HTTPException:
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        security_utils.error_detail("Lỗi kết nối dịch vụ iNut Training", exc, "ksp.training"),
    )


_DEV_CORS_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:2032",
    "http://127.0.0.1:2032",
}

_CSRF_REFERER_EXEMPT_PREFIXES = (
    "/webhooks/",
    "/api/lio-signer/webhook",
    "/internal/",
    "/api/mail/send",
    "/api/login",
    "/api/logout",
    "/api/doc-telemetry",
    "/api/public/",
)


def _inject_viewer_nonce(html_out: str, csp_nonce: str) -> str:
    """Gan nonce CSP vao the <script> cuoi cung cua trinh xem tai lieu noi bo."""
    if not csp_nonce or not html_out:
        return html_out
    idx = html_out.rfind("<script>")
    if idx == -1:
        return html_out
    safe_nonce = html.escape(csp_nonce, quote=True)
    return html_out[:idx] + f'<script nonce="{safe_nonce}">' + html_out[idx + len("<script>"):]


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Chan CSRF theo Origin/Referer va gan header bao mat + CSP nonce cho API/frontend."""
    csp_nonce = secrets.token_urlsafe(16)
    request.state.csp_nonce = csp_nonce
    settings = get_settings()

    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        parsed = urlsplit(settings.public_base_url)
        public_origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
        allowed = {o for o in (public_origin,) if o}
        if settings.app_dev_cors:
            allowed.update(_DEV_CORS_ORIGINS)
        if request.client and request.client.host == "testclient":
            allowed.add("http://testserver")

        origin = (request.headers.get("origin") or "").strip()
        if origin:
            if origin not in allowed:
                return JSONResponse({"detail": "Nguon yeu cau khong hop le"}, status_code=403)
        elif (
            COOKIE_NAME in request.cookies
            and not (request.headers.get("authorization") or "").startswith("Bearer ")
            and not request.url.path.startswith(_CSRF_REFERER_EXEMPT_PREFIXES)
        ):
            sec_fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
            if sec_fetch_site == "cross-site":
                return JSONResponse({"detail": "Nguon yeu cau khong hop le"}, status_code=403)
            referer = (request.headers.get("referer") or "").strip()
            if referer:
                rp = urlsplit(referer)
                ref_origin = f"{rp.scheme}://{rp.netloc}" if rp.scheme and rp.netloc else ""
                if ref_origin not in allowed:
                    return JSONResponse({"detail": "Nguon yeu cau khong hop le"}, status_code=403)

    response = await call_next(request)
    if not settings.app_dev_cors:
        acao = response.headers.get("access-control-allow-origin", "")
        if acao in _DEV_CORS_ORIGINS:
            del response.headers["access-control-allow-origin"]
            if "access-control-allow-credentials" in response.headers:
                del response.headers["access-control-allow-credentials"]

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    p_path = request.url.path
    is_portal = (
        p_path.startswith("/khoan/")
        or p_path.startswith("/s/")
        or p_path.startswith("/md/")
        or p_path.startswith("/api/share/")
        or p_path.startswith("/api/documents/")
        or p_path.lower().endswith((".md", ".markdown"))
    )
    script_src = f"'self' 'nonce-{csp_nonce}'" if is_portal else "'self'"
    connect_sources = ["'self'"]
    if settings.app_dev_cors:
        connect_sources.extend(["http://localhost:5173", "ws://localhost:5173"])
    if p_path.startswith("/s/"):
        connect_sources.extend(["https://ipwho.is", "https://1.1.1.1"])
    response.headers["Content-Security-Policy"] = (
        f"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        f"script-src {script_src}; connect-src {' '.join(connect_sources)}; "
        "frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    )
    return response


def _content_disposition(filename: str) -> str:
    """Content-Disposition an toan cho ten file tieng Viet (RFC 5987)."""
    return security_utils.safe_content_disposition(filename, disposition="attachment")


def _audit(db, user, action: str, target: str = "", detail: str = "") -> None:
    audit.record(db, user.username, user.role, user.ip, action, target, detail)


def _bg_nas_sync(doc_id: int) -> None:
    """Dong bo 1 ho so len NAS (chay nen, mo session DB rieng)."""
    settings = get_settings()
    if not settings.nas_enabled:
        return
    gen = get_session()
    db = next(gen)
    try:
        doc = db.get(Document, doc_id)
        if doc:
            nas.sync_document(settings, db, doc)
    except Exception:  # noqa: BLE001
        pass
    finally:
        gen.close()


def _bg_ihoadon_sync() -> None:
    gen = get_session()
    db = next(gen)
    try:
        ihoadon_sync.run_sync(db, get_settings())
    except ihoadon_sync.SyncBusy:
        pass
    finally:
        gen.close()

_init_cors_settings = get_settings()
_init_cors_parsed = urlsplit(_init_cors_settings.public_base_url)
_init_cors_origins = (
    [f"{_init_cors_parsed.scheme}://{_init_cors_parsed.netloc}"]
    if _init_cors_parsed.scheme and _init_cors_parsed.netloc
    else []
)
if _init_cors_settings.app_dev_cors:
    _init_cors_origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_init_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()
    settings_store.migrate_plaintext_secrets()
    settings = get_settings()
    db_file = settings.data_path / "ksp.db"
    if db_file.exists():
        try:
            db_file.chmod(0o600)
        except OSError:
            pass
    # Seed admin
    gen = get_session()
    db = next(gen)
    try:
        ensure_admin_seed(db, settings)
        _cleanup_public_training_data(db, settings)
        _cleanup_facebook_messages(db, settings)
        telegram.start_poller(settings)
        from . import customs_check_runner
        customs_check_runner.auto_seed_tasks_from_decls(db)
        customs_check_runner.start_customs_check_worker(settings)
        gov_radar.start_gov_radar_worker(settings)
        from . import lio_signer
        lio_signer.start_lio_signer_worker(settings)
    finally:
        gen.close()
    resume_tqc_import_jobs()


def _cleanup_public_training_data(db: Session, settings: Settings) -> None:
    """Xóa lead/hội thoại công khai quá hạn lưu trữ, không đụng dữ liệu CRM."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, settings.public_training_retention_days))
    old_ids = list(db.scalars(select(TrainingPublicSession.id).where(TrainingPublicSession.created_at < cutoff)))
    if not old_ids:
        return
    db.execute(delete(TrainingPublicQuery).where(TrainingPublicQuery.session_id.in_(old_ids)))
    db.execute(delete(TrainingPublicSession).where(TrainingPublicSession.id.in_(old_ids)))
    db.commit()


def _cleanup_facebook_messages(db: Session, settings: Settings) -> None:
    """Giữ hội thoại Messenger trong thời hạn cấu hình, tránh phình DB/PII."""
    from .db import FacebookMessage

    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, settings.facebook_retention_days))
    db.query(FacebookMessage).filter(FacebookMessage.created_at < cutoff).delete(
        synchronize_session=False
    )
    db.commit()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/public/site-config")
def public_site_config(settings: Settings = Depends(get_settings)):
    """Return the small, non-sensitive contact surface used by iNut.vn.

    The website consumes this through its own server-side BFF. Keep this
    response deliberately narrow: payment details, credentials, AI settings,
    and operational URLs must never become public site configuration.
    """
    return {
        "brand": {
            "name": settings.bbbg_company,
            "website": settings.dntt_website,
        },
        "contact": {
            "company": settings.bbbg_company,
            "address": settings.bbbg_address,
            "phone": settings.bbbg_phone,
            "email": settings.dntt_email,
            "website": settings.dntt_website,
        },
    }


# Chong do mat khau: sai lien tiep >= N lan trong cua so -> khoa IP 30 phut
LOGIN_LOCK_FAILS = 5
LOGIN_LOCK_MINUTES = 30


def _recent_consecutive_fails(db: Session, ip: str, username: str = "") -> tuple[int, datetime | None]:
    """(so lan login_fail lien tiep trong 30 phut, thoi diem sai gan nhat).

    Khoa theo cap (ip, username.lower()) de chong DoS khoa ca cong ty sau proxy/NAT
    nhung van chan brute-force vao tung tai khoan.
    """
    if not ip:
        return 0, None
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        minutes=LOGIN_LOCK_MINUTES
    )
    q = select(AuditLog).where(
        AuditLog.ip == ip,
        AuditLog.action.in_(["login", "login_fail"]),
        AuditLog.ts >= since,
    )
    uname_norm = (username or "").strip().lower()
    if uname_norm:
        q = q.where(func.lower(AuditLog.username) == uname_norm)
    rows = db.scalars(q.order_by(AuditLog.ts.desc()).limit(LOGIN_LOCK_FAILS * 4))
    fails = 0
    last_fail = None
    for r in rows:
        if r.action == "login":
            break
        fails += 1
        if last_fail is None:
            last_fail = r.ts
    return fails, last_fail


def _count_recent_fails(db: Session, ip: str, username: str = "") -> int:
    return _recent_consecutive_fails(db, ip, username)[0]


def _login_lock_remaining(db: Session, ip: str, username: str = "") -> int:
    """So phut tai khoan/IP con bi khoa (0 = khong khoa)."""
    fails, last_fail = _recent_consecutive_fails(db, ip, username)
    if fails < LOGIN_LOCK_FAILS or last_fail is None:
        return 0
    if last_fail.tzinfo is not None:
        last_fail = last_fail.astimezone(timezone.utc).replace(tzinfo=None)
    elapsed = datetime.now(timezone.utc).replace(tzinfo=None) - last_fail
    remaining = LOGIN_LOCK_MINUTES - int(elapsed.total_seconds() // 60)
    return max(1, remaining) if remaining > 0 else 0


@app.post("/api/login")
def login(
    body: LoginRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    ip = request.client.host if request.client else ""
    uname_norm = (body.username or "").strip().lower()
    locked = _login_lock_remaining(db, ip, uname_norm)
    if locked:
        audit.record(db, uname_norm, "?", ip, "login_locked", detail=f"còn {locked} phút")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Tài khoản tạm khóa {LOGIN_LOCK_MINUTES} phút do nhập sai mật khẩu "
            f"{LOGIN_LOCK_FAILS} lần liên tiếp — thử lại sau {locked} phút",
        )
    user = authenticate(db, body.username, body.password)
    if user is None:
        audit.record(db, uname_norm, "?", ip, "login_fail")
        con_lai = LOGIN_LOCK_FAILS - _count_recent_fails(db, ip, uname_norm)
        if con_lai <= 0:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                f"Sai tai khoan hoac mat khau — tài khoản bị khóa {LOGIN_LOCK_MINUTES} phút",
            )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sai tai khoan hoac mat khau")
    audit.record(db, user.username, user.role, ip, "login")
    token = create_token(user, settings)
    resp = JSONResponse({"ok": True, "username": user.username, "role": user.role})
    resp.set_cookie(
        COOKIE_NAME, token, httponly=True, samesite="lax",
        secure=(request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"),
        max_age=settings.jwt_ttl_minutes * 60,
    )
    return resp


@app.post("/api/logout")
def logout(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    token = extract_request_token(request)
    if token:
        revoke_token(db, token, settings)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp


@app.get("/api/me")
def me(
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    customer_name = None
    db_user = db.get(User, user.id)
    if user.customer_id:
        c = db.get(Customer, user.customer_id)
        customer_name = c.name if c else None
    return {
        "username": user.username,
        "role": user.role,
        "portal_scope": user.portal_scope,
        "customer_id": user.customer_id,
        "customer_name": customer_name,
        "agent_default_ip": settings.agent_default_ip,
        "default_location": settings.default_location,
        "using_default_secrets": settings.using_default_secrets,
        "must_change_password": bool(db_user and db_user.must_change_password),
        "training_access": bool(db_user and (db_user.role == "admin" or db_user.training_access)),
    }


# ---------------------------------------------------------------------------
# Telegram notifications (admin account linking)
# ---------------------------------------------------------------------------
@app.get("/api/telegram/status")
def telegram_status(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    connected = telegram.connection_status(db, user.id)
    configured = telegram.is_configured(settings)
    return {
        "enabled": configured,
        "bot_username": settings.telegram_bot_username.lstrip("@"),
        **connected,
    }


@app.post("/api/telegram/connect")
def telegram_connect(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    if not telegram.is_configured(settings):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram chưa được cấu hình trên máy chủ")
    try:
        return {"ok": True, **telegram.create_connect_link(db, user.id, settings)}
    except telegram.TelegramError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@app.delete("/api/telegram/connection")
def telegram_disconnect(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    telegram.revoke_connection(db, user.id)
    return {"ok": True}


def require_telegram_send_access(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    """Chi cho phep Admin JWT/Cookie hoac loopback service Bearer token hop le."""
    lb_user = authenticate_loopback_bearer(request, db)
    if lb_user is not None:
        return lb_user
    user = require_user(request=request, settings=settings, db=db)
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chi admin duoc phep")
    return user


class TelegramSendMessageIn(BaseModel):
    message: str
    chat_id: str | None = None
    speak_tts: bool = True
    parse_mode: str = ""


@app.post("/api/telegram/send")
def telegram_send_message(
    payload: TelegramSendMessageIn,
    user: CurrentUser = Depends(require_telegram_send_access),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Gửi tin nhắn Telegram trực tiếp tới Admin chat hoặc chat_id chỉ định (kèm phát TTS ra loa BLE nếu bật)."""
    if not telegram.is_configured(settings):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram chưa được cấu hình trên máy chủ")

    chats = [payload.chat_id] if payload.chat_id else telegram.admin_chat_ids(db)
    if not chats:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chưa có tài khoản Telegram Admin nào được liên kết")

    client = telegram.TelegramClient(settings)
    delivered = 0
    try:
        for cid in chats:
            if cid and str(cid).lstrip("-").isdigit():
                try:
                    client.send_message(cid, payload.message, speak_tts=payload.speak_tts, parse_mode=payload.parse_mode)
                    delivered += 1
                except Exception as e:
                    logger.warning("Lỗi gửi Telegram tới chat %s: %s", cid, e)
    finally:
        client.close()

    return {"ok": True, "delivered_count": delivered, "message": payload.message}


class TtsSpeakIn(BaseModel):
    text: str
    voice: str | None = None
    speed: int | None = None
    provider: str = "auto"
    alarm_sound: str | None = None


class TtsConfigUpdateIn(BaseModel):
    telegram_tts_speaker_enabled: bool | None = None
    telegram_tts_filter_enabled: bool | None = None
    telegram_tts_regex: str | None = None
    telegram_tts_alarm_sound: str | None = None
    tts_default_provider: str | None = None
    tts_default_voice: str | None = None
    tts_default_speed: int | None = None


class TtsRegexTestIn(BaseModel):
    message: str
    regex: str | None = None
    filter_enabled: bool | None = None


class TtsVolumeIn(BaseModel):
    volume: int


class TtsSoundIn(BaseModel):
    sound: str = "notification"


@app.get("/api/tts/status")
def tts_status_api(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Trạng thái hệ thống TTS Tiếng Việt (Kokoro / VNMap / 9Router Google & Microsoft) và Loa BLE 77.88.207.23."""
    speaker_info: dict[str, Any] = {"ok": False}
    try:
        speaker_info = tts.get_ble_speaker_status(settings)
    except Exception as exc:
        speaker_info = {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "tts_enabled": settings.tts_enabled,
        "ble_speaker_enabled": settings.ble_speaker_enabled,
        "telegram_tts_speaker_enabled": settings.telegram_tts_speaker_enabled,
        "telegram_tts_filter_enabled": settings.telegram_tts_filter_enabled,
        "telegram_tts_regex": settings.telegram_tts_regex,
        "telegram_tts_alarm_sound": settings.telegram_tts_alarm_sound,
        "default_provider": settings.tts_default_provider,
        "default_voice": settings.tts_default_voice,
        "default_speed": settings.tts_default_speed,
        "providers": [
            {"id": "auto", "label": "Tự động (Kokoro → VNMap → Chị Google → Microsoft)"},
            {"id": "kokoro", "label": f"Kokoro ({settings.tts_kokoro_base_url})"},
            {"id": "vnmap-tts", "label": f"VNMap TTS ({settings.tts_vnmap_base_url})"},
            {"id": "google", "label": f"AppHub 9Router · Chị Google ({settings.tts_google_model})"},
            {"id": "microsoft", "label": f"AppHub 9Router · Microsoft ({settings.tts_microsoft_model})"},
        ],
        "voices": {
            "kokoro": [{"id": k, "label": v} for k, v in tts.KOKORO_VOICES.items()],
            "google": [{"id": k, "label": v} for k, v in tts.GOOGLE_VOICES.items()],
            "microsoft": [{"id": k, "label": v} for k, v in tts.MICROSOFT_VOICES.items()],
        },
        "ble_speaker_base_url": settings.ble_speaker_base_url,
        "speaker_status": speaker_info,
    }


@app.put("/api/tts/config")
def tts_config_update_api(
    payload: TtsConfigUpdateIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Lưu cấu hình lọc Regex Telegram (RK Burner), âm báo động và giọng TTS mặc định."""
    if payload.telegram_tts_regex is not None and payload.telegram_tts_regex.strip():
        try:
            re.compile(payload.telegram_tts_regex.strip())
        except re.error as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Biểu thức Regex không hợp lệ: {exc}") from exc

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    settings_store.set_overrides(updates)
    settings_store.reload_settings()
    _audit(db, user, "tts_config_update", "telegram_tts", json.dumps(updates, ensure_ascii=False))
    fresh = get_settings()
    return {
        "ok": True,
        "telegram_tts_speaker_enabled": fresh.telegram_tts_speaker_enabled,
        "telegram_tts_filter_enabled": fresh.telegram_tts_filter_enabled,
        "telegram_tts_regex": fresh.telegram_tts_regex,
        "telegram_tts_alarm_sound": fresh.telegram_tts_alarm_sound,
        "default_provider": fresh.tts_default_provider,
        "default_voice": fresh.tts_default_voice,
        "default_speed": fresh.tts_default_speed,
    }


@app.post("/api/tts/test-regex")
def tts_test_regex_api(
    payload: TtsRegexTestIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Kiểm thử tin nhắn mẫu với biểu thức Regex lọc thông báo Telegram ra loa BLE."""
    match_res = tts.matches_telegram_tts_filter(
        payload.message,
        settings,
        custom_regex=payload.regex,
        filter_enabled=payload.filter_enabled,
    )
    return {
        "ok": True,
        **match_res,
        "resolved_alarm_sound": tts.resolve_telegram_alarm_sound(payload.message, settings.telegram_tts_alarm_sound),
        "spoken_preview": tts.format_telegram_tts_text(payload.message),
    }


@app.post("/api/tts/synthesize")
def tts_synthesize_api(
    payload: TtsSpeakIn,
    response_format: str = "audio",
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Tổng hợp giọng nói Tiếng Việt (trả về file WAV/MP3 hoặc JSON base64)."""
    try:
        res = tts.synthesize_vietnamese_tts(
            payload.text,
            settings,
            voice=payload.voice,
            speed=payload.speed,
            provider=payload.provider,
        )
    except tts.TtsError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi tổng hợp giọng nói TTS", exc, "ksp.tts"),
        ) from exc

    if response_format == "json":
        import base64

        return {
            "ok": True,
            "provider": res.provider,
            "voice": res.voice,
            "audio_format": res.audio_format,
            "content_type": res.content_type,
            "text": res.text,
            "request_id": res.request_id,
            "async_url": res.async_url,
            "fallback_errors": res.fallback_errors,
            "audio_base64": base64.b64encode(res.audio_bytes).decode("ascii"),
        }
    return Response(
        content=res.audio_bytes,
        media_type=res.content_type,
        headers={
            "X-TTS-Provider": res.provider,
            "X-TTS-Voice": res.voice,
            "X-TTS-Format": res.audio_format,
        },
    )


@app.post("/api/tts/speak")
def tts_speak_api(
    payload: TtsSpeakIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Tổng hợp giọng nói Tiếng Việt và phát trực tiếp ra loa BLE tại 77.88.207.23:8080."""
    try:
        return tts.speak_on_ble_speaker(
            payload.text,
            settings,
            voice=payload.voice,
            speed=payload.speed,
            provider=payload.provider,
            alarm_sound=payload.alarm_sound,
        )
    except tts.TtsError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi phát âm thanh ra loa BLE", exc, "ksp.tts"),
        ) from exc


@app.post("/api/tts/speaker/volume")
def tts_speaker_volume_api(
    payload: TtsVolumeIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        return tts.set_ble_speaker_volume(payload.volume, settings)
    except tts.TtsError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi điều chỉnh âm lượng loa BLE", exc, "ksp.tts"),
        ) from exc


@app.post("/api/tts/speaker/sound")
def tts_speaker_sound_api(
    payload: TtsSoundIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        return tts.play_ble_speaker_sound(payload.sound, settings)
    except tts.TtsError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi phát âm báo loa BLE", exc, "ksp.tts"),
        ) from exc


@app.post("/api/tts/speaker/stop")
def tts_speaker_stop_api(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        return tts.stop_ble_speaker(settings)
    except tts.TtsError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi dừng loa BLE", exc, "ksp.tts"),
        ) from exc

class MailSendIn(BaseModel):
    to: str
    subject: str
    body: str | None = None
    html: str | None = None
    username: str | None = None
    otp_code: str | None = None
    expiry_minutes: int | None = 15


_MAIL_RATE_LOCK = threading.Lock()
_MAIL_RATE_BUCKETS: dict[str, list[float]] = {}
_MAIL_RATE_LIMIT = 30
_MAIL_RATE_WINDOW = 60.0


def _check_mail_rate_limit(key: str) -> None:
    now = time.monotonic()
    with _MAIL_RATE_LOCK:
        hits = [t for t in _MAIL_RATE_BUCKETS.get(key, []) if now - t < _MAIL_RATE_WINDOW]
        if len(hits) >= _MAIL_RATE_LIMIT:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Quá giới hạn gửi email (tối đa 30 thư/phút)",
            )
        hits.append(now)
        _MAIL_RATE_BUCKETS[key] = hits


@app.post("/api/mail/send")
async def mail_send_api(
    payload: MailSendIn,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """API phát email tập trung cho hệ sinh thái iNut qua cấu hình SMTP của KSP.

    Yêu cầu 1 trong các cơ chế xác thực:
    - Header `X-INUT-Mail-Signature` (HMAC-SHA256 trên raw body với `MAIL_HMAC_SECRET`)
    - Header `Authorization: Bearer <MAIL_API_TOKEN>`
    - Loopback service token hợp lệ
    - Hoặc phiên Admin (`require_admin`).
    """
    ip = request.client.host if request.client else ""
    actor = ""
    role = "service"

    sig_header = (request.headers.get("x-inut-mail-signature") or "").strip()
    if sig_header and settings.mail_hmac_secret:
        raw_body = await request.body()
        expected_hex = hmac.new(
            settings.mail_hmac_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()
        supplied_hex = sig_header[7:].strip() if sig_header.lower().startswith("sha256=") else sig_header
        if hmac.compare_digest(supplied_hex.lower(), expected_hex.lower()):
            actor = "mail-hmac"

    if not actor and settings.mail_api_token:
        auth_header = (request.headers.get("authorization") or "").strip()
        if auth_header.startswith("Bearer "):
            supplied_tok = auth_header[7:].strip()
            if supplied_tok and hmac.compare_digest(supplied_tok, settings.mail_api_token):
                actor = "mail-token"

    if not actor:
        lb_user = authenticate_loopback_bearer(request, db)
        if lb_user is not None:
            actor = lb_user.username
            role = lb_user.role

    if not actor:
        user = require_user(request=request, settings=settings, db=db)
        if not user.is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Chi admin duoc phep")
        actor = user.username
        role = user.role

    _check_mail_rate_limit(f"{actor}:{ip}")

    to_email = payload.to.strip()
    if not to_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu địa chỉ email người nhận")

    html_content = payload.html or payload.body or ""
    plain_content = payload.body or ""

    ok = tax_ops.send_custom_email(
        db,
        to_email=to_email,
        subject=payload.subject,
        plain_body=plain_content,
        html_body=html_content,
    )
    if not ok:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Không thể gửi email qua SMTP của KSP (chưa cấu hình hoặc lỗi kết nối)")

    audit.record(db, actor, role, ip, "mail_send", to_email, (payload.subject or "")[:160])
    return {"ok": True, "message": "Email đã được gửi thành công", "to": to_email}

# ---------------------------------------------------------------------------
# Ky so (admin)
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...), user: CurrentUser = Depends(require_admin)):
    content = await storage.read_upload_limited(file, max_bytes=25 * 1024 * 1024)
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    doc_id = storage.save_upload(content)
    return {"doc_id": doc_id, "filename": file.filename}


# Chong zip-bomb: gioi han tong dung luong (giai nen) va so PDF trong 1 ZIP.
_ZIP_MAX_TOTAL_SIZE = 200 * 1024 * 1024  # 200MB
_ZIP_MAX_FILES = 50


@app.post("/api/upload-zip")
async def upload_zip(file: UploadFile = File(...), user: CurrentUser = Depends(require_admin)):
    """Tai len 1 file ZIP chua nhieu PDF, tach tung file de ky lan luot."""
    content = await storage.read_upload_limited(file, max_bytes=100 * 1024 * 1024)
    if not content.startswith(b"PK"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai ZIP hop le")
    try:
        zf = zipfile.ZipFile(_io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File ZIP bi loi, khong doc duoc")

    total_size = 0
    pdf_infos = []
    for info in zf.infolist():
        if info.is_dir() or "__MACOSX" in info.filename:
            continue
        if not info.filename.lower().endswith(".pdf"):
            continue
        total_size += info.file_size
        pdf_infos.append(info)

    if total_size > _ZIP_MAX_TOTAL_SIZE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ZIP qua lon (giai nen > 200MB)")
    if len(pdf_infos) > _ZIP_MAX_FILES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"ZIP co qua nhieu file (> {_ZIP_MAX_FILES})")

    files = []
    running_uncompressed = 0
    for info in pdf_infos:
        chunks: list[bytes] = []
        with zf.open(info, "r") as zf_stream:
            while True:
                chunk = zf_stream.read(65536)
                if not chunk:
                    break
                running_uncompressed += len(chunk)
                if running_uncompressed > _ZIP_MAX_TOTAL_SIZE:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "ZIP qua lon (giai nen > 200MB)")
                chunks.append(chunk)
        data = b"".join(chunks)
        if not data.startswith(b"%PDF"):
            continue  # bo qua file khong phai PDF that
        doc_id = storage.save_upload(data)
        files.append({
            "doc_id": doc_id,
            "filename": Path(info.filename).name,  # bo thu muc con trong zip
            "size": len(data),
        })

    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ZIP khong chua PDF nao")
    return {"files": files}


@app.get("/api/doc/{doc_id}")
def get_doc(doc_id: str, user: CurrentUser = Depends(require_admin)):
    if not storage.exists(doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    return Response(content=storage.read_doc(doc_id), media_type="application/pdf")


@app.post("/api/certs")
def list_certs(
    body: AgentTarget,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        certs = token_backend.list_certs(settings, body.ip, body.admin_password)
    except token_backend.BackendError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Không thể kết nối máy ký số USB Token", e, "ksp.sign"),
        )
    return {"certs": [c.model_dump() for c in certs]}


@app.post("/api/sign", response_model=SignResponse)
def sign(
    body: SignRequest,
    background: BackgroundTasks,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    if not storage.exists(body.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    try:
        signed_id, signer_label = signing.sign_document(settings, body)
    except token_backend.BackendError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi kết nối máy ký số USB Token", e, "ksp.sign"),
        )
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Ký số thất bại", e, "ksp.sign"),
        )

    # Phan loai: uu tien loai chi dinh (vd BBBG), nguoc lai tu nhan dien.
    dtype = body.doc_type
    if not dtype:
        try:
            dtype = classify.detect_doc_type(storage.read_doc(signed_id))
        except Exception:
            dtype = ""

    # Luu ho so (cap nhat ho so co san neu existing_document_id duoc truyen, nguoc lai tao moi)
    doc: Document | None = None
    if body.existing_document_id:
        doc = db.get(Document, body.existing_document_id)
    if doc is not None:
        doc.doc_id = signed_id
        doc.signed_upload_id = signed_id
        clean_name = doc.filename if doc.filename.lower().endswith(".pdf") else f"{doc.filename}.pdf"
        doc.signed_upload_name = f"da-ky-2-ben-{clean_name}"
        doc.signed_upload_at = datetime.utcnow()
        doc.signed = True
        if signer_label and signer_label.upper() not in (doc.signer_name or "").upper():
            doc.signer_name = f"{doc.signer_name} · {signer_label}" if (doc.signer_name or "").strip() else signer_label
        if body.customer_id is not None:
            doc.customer_id = body.customer_id
        if dtype:
            doc.doc_type = dtype
        if body.order_id is not None:
            doc.order_id = body.order_id
        db.commit()
        db.refresh(doc)
        _audit(db, user, "sign", doc.filename, f"ký tiếp hồ sơ #{doc.id} loại={dtype or '?'}")
        if doc.lio_session_id and doc.lio_status == "signed":
            try:
                from . import lio_signer
                doc = lio_signer.submit_countersigned_document(
                    db,
                    settings,
                    doc,
                    pdf_bytes=storage.read_doc(signed_id),
                    filename=doc.signed_upload_name,
                )
                _audit(
                    db,
                    user,
                    "lio_countersigned",
                    doc.filename,
                    f"session={doc.lio_session_id} file_id={doc.lio_countersigned_file_id}",
                )
            except Exception as exc:
                logger.warning("Tự động gửi bản ký 2 bên về LIO cho hồ sơ #%s chưa thành công: %s", doc.id, exc)
    else:
        doc = Document(
            doc_id=signed_id,
            filename=body.filename or f"signed-{signed_id}.pdf",
            signer_name=signer_label,
            signed=True,
            customer_id=body.customer_id,
            doc_type=dtype,
            order_id=body.order_id,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        _audit(db, user, "sign", doc.filename, f"loại={dtype or '?'}")
    background.add_task(_bg_nas_sync, doc.id)  # backup len NAS (nen)
    return SignResponse(
        doc_id=signed_id, signed=True, download_url=f"/api/download/{signed_id}",
        document_id=doc.id,
    )


@app.get("/api/download/{doc_id}")
def download(doc_id: str, user: CurrentUser = Depends(require_admin)):
    if not storage.exists(doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    data = storage.read_doc(doc_id)
    return StreamingResponse(
        iter([data]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="signed-{doc_id}.pdf"'},
    )


@app.post("/api/verify", response_model=VerifyResponse)
def verify_upload(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
):
    require_full_portal(user)
    content = storage.read_upload_limited_sync(file, max_bytes=25 * 1024 * 1024)
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    doc_id = storage.save_upload(content)
    return verify.verify_document(settings, content, doc_id)


# ---------------------------------------------------------------------------
# Khach hang (admin)
# ---------------------------------------------------------------------------
def _customer_out(db: Session, c: Customer) -> CustomerOut:
    doc_count = db.scalar(
        select(func.count(Document.id)).where(Document.customer_id == c.id)
    )
    usernames = [u.username for u in c.users]
    aliases = list(
        db.scalars(
            select(CustomerAlias.name_norm).where(CustomerAlias.customer_id == c.id)
        )
    )
    return CustomerOut(
        id=c.id, name=c.name, tax_code=c.tax_code, contact=c.contact,
        address=c.address or "", email=c.email or "", logo_url=c.logo_url or "", note=c.note,
        created_at=c.created_at.isoformat(), document_count=doc_count or 0,
        account_usernames=usernames, aliases=aliases,
    )


@app.post("/api/customers", response_model=CustomerOut)
def create_customer(
    body: CustomerCreate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    c = Customer(
        name=body.name, tax_code=body.tax_code, contact=body.contact, note=body.note,
        logo_url=body.logo_url,
    )
    db.add(c)
    db.flush()
    _audit(db, user, "customer_create", body.name, body.tax_code)
    # Tao luon tai khoan neu co
    if body.account_username and body.account_password:
        if db.scalar(select(User).where(User.username == body.account_username)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Ten tai khoan da ton tai")
        db.add(User(
            username=body.account_username,
            password_hash=hash_password(body.account_password),
            role="customer", customer_id=c.id, must_change_password=True,
        ))
    db.commit()
    db.refresh(c)
    return _customer_out(db, c)


@app.get("/api/customers", response_model=list[CustomerOut])
def list_customers(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    return [_customer_out(db, c) for c in db.scalars(select(Customer).order_by(Customer.name))]


@app.get("/api/customers/{cid}", response_model=CustomerOut)
def get_customer(cid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    return _customer_out(db, c)


@app.patch("/api/customers/{cid}", response_model=CustomerOut)
def update_customer(
    cid: int, body: CustomerUpdate,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    for f in ("name", "tax_code", "contact", "note", "logo_url"):
        v = getattr(body, f)
        if v is not None:
            setattr(c, f, v)
    db.commit()
    db.refresh(c)
    return _customer_out(db, c)


@app.delete("/api/customers/{cid}")
def delete_customer(cid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    # Bo gan ho so, xoa tai khoan khach hang
    for d in db.scalars(select(Document).where(Document.customer_id == cid)):
        d.customer_id = None
    for inv in db.scalars(select(IhoadonInvoice).where(IhoadonInvoice.customer_id == cid)):
        inv.customer_id = None
        inv.match_source = ""
    _audit(db, user, "customer_delete", c.name)
    for u in list(c.users):
        db.delete(u)
    db.delete(c)
    db.commit()
    return {"ok": True}


@app.post("/api/customers/{cid}/account")
def create_account(
    cid: int, body: AccountCreate,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    existing = db.scalar(select(User).where(User.username == body.username))
    if existing:
        if existing.customer_id != cid:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ten tai khoan da ton tai")
        existing.password_hash = hash_password(body.password)  # doi mat khau
        existing.session_version += 1
        existing.must_change_password = True
    else:
        db.add(User(
            username=body.username, password_hash=hash_password(body.password),
            role="customer", customer_id=cid, must_change_password=True,
        ))
    db.commit()
    _audit(db, user, "account_set", c.name, body.username)
    return {"ok": True, "username": body.username}


@app.post("/api/customers/{cid}/account-auto")
def create_account_auto(
    cid: int, user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings), db: Session = Depends(get_session),
):
    """Tao moi hoac cap lai tai khoan dau tien, tra mat khau tam dung mot lan."""
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
    password = accounts.default_password(c.tax_code)
    existing = db.scalar(select(User).where(User.customer_id == cid).order_by(User.id))
    if existing:
        username = existing.username
        existing.password_hash = hash_password(password)
        existing.session_version += 1
        existing.must_change_password = True
    else:
        username = accounts.default_username(c.name, c.tax_code, c.id)
        if db.scalar(select(User).where(User.username == username)):
            username = f"{username}_{c.id}"
        db.add(User(
            username=username, password_hash=hash_password(password), role="customer",
            customer_id=c.id, must_change_password=True,
        ))
    db.commit()
    _audit(db, user, "account_auto", c.name, username)
    return {
        "ok": True, "username": username, "password": password,
        "login_url": settings.public_base_url.rstrip("/") + "/",
    }


@app.post("/api/customers/{cid}/login-link")
def create_customer_login_link(
    cid: int, days: int = 7, user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings), db: Session = Depends(get_session),
):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
    account = db.scalar(select(User).where(User.customer_id == cid).order_by(User.id))
    if not account:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Khách hàng chưa có tài khoản")
    days = min(max(days, 1), 30)
    for old in db.scalars(select(LoginLink).where(LoginLink.user_id == account.id)):
        old.revoked = True
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(days=days)
    db.add(LoginLink(token=token, user_id=account.id, expires_at=expires))
    db.commit()
    _audit(db, user, "account_login_link", c.name, f"{days} ngày")
    return {
        "url": f"{settings.public_base_url.rstrip('/')}/api/login-link/{token}",
        "expires_at": expires.isoformat(), "username": account.username,
    }


@app.get("/api/login-link/{token}")
def login_by_link(
    token: str, request: Request, settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    link = db.scalar(select(LoginLink).where(LoginLink.token == token))
    if not link or link.revoked or datetime.utcnow() > link.expires_at:
        raise HTTPException(status.HTTP_410_GONE, "Link đăng nhập không còn hiệu lực")
    account = link.user
    # Link dang nhap chi dung 1 lan (single-use)
    link.revoked = True
    db.commit()
    jwt_token = create_token(account, settings)
    audit.record(
        db, account.username, account.role,
        request.client.host if request.client else "", "login_link",
    )
    # Cho phép chuyển hướng nội bộ an toàn (chặn open-redirect dạng /\evil.com hay https://...)
    target = (request.query_params.get("next") or request.query_params.get("redirect") or "").strip()
    parsed_target = urlsplit(target) if target else None
    is_safe_target = bool(
        target
        and target.startswith("/")
        and not target.startswith("//")
        and "\\" not in target
        and "\r" not in target
        and "\n" not in target
        and parsed_target is not None
        and not parsed_target.scheme
        and not parsed_target.netloc
    )
    if is_safe_target:
        landing = target
    else:
        landing = "/training" if account.role == "admin" or account.training_access else "/ho-so-cua-toi"
    resp = RedirectResponse(url=landing, status_code=302)
    resp.set_cookie(
        COOKIE_NAME, jwt_token, httponly=True, samesite="lax",
        secure=(request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"),
        max_age=settings.jwt_ttl_minutes * 60,
    )
    return resp


@app.post("/api/customers/merge")
def merge_customers(
    body: CustomerMerge,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Gop cong ty NGUON vao cong ty DICH: chuyen (khong xoa) tai khoan/don
    hang/ho so/hoa don ban/phieu xuat sang dich, hoc ten nguon lam alias,
    roi xoa cong ty nguon."""
    if body.source_id == body.target_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Khong the gop mot cong ty vao chinh no")
    src = db.get(Customer, body.source_id)
    tgt = db.get(Customer, body.target_id)
    if not src or not tgt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")

    moved = {
        "users": db.scalar(select(func.count(User.id)).where(User.customer_id == src.id)) or 0,
        "orders": db.scalar(select(func.count(Order.id)).where(Order.customer_id == src.id)) or 0,
        "documents": db.scalar(select(func.count(Document.id)).where(Document.customer_id == src.id)) or 0,
        "sales": db.scalar(select(func.count(InvSale.id)).where(InvSale.customer_id == src.id)) or 0,
        "issues": db.scalar(select(func.count(InvIssue.id)).where(InvIssue.customer_id == src.id)) or 0,
    }

    # Chuyen (KHONG xoa) 5 FK tro nguon -> dich.
    # Users/documents co Customer.users/documents (back_populates) -> phai gan
    # qua thuoc tinh quan he (.customer = tgt), khong chi doi cot customer_id,
    # neu khong khi xoa src ben duoi ORM se tu NULL lai FK (cascade ngam dinh).
    for u in db.scalars(select(User).where(User.customer_id == src.id)):
        u.customer = tgt
        u.session_version += 1
    for d in db.scalars(select(Document).where(Document.customer_id == src.id)):
        d.customer = tgt
    # Order/InvSale/InvIssue chi co quan he 1 chieu (Customer khong co orders/
    # sales/issues) nen doi thang cot la du, khong bi cascade null.
    for o in db.scalars(select(Order).where(Order.customer_id == src.id)):
        o.customer_id = tgt.id
    for s in db.scalars(select(InvSale).where(InvSale.customer_id == src.id)):
        s.customer_id = tgt.id
    for i in db.scalars(select(InvIssue).where(InvIssue.customer_id == src.id)):
        i.customer_id = tgt.id
    for inv in db.scalars(select(IhoadonInvoice).where(IhoadonInvoice.customer_id == src.id)):
        inv.customer_id = tgt.id

    # Field mem: dich trong ma nguon co thi lay sang
    for f in ("tax_code", "contact", "address", "email", "note"):
        if not getattr(tgt, f) and getattr(src, f):
            setattr(tgt, f, getattr(src, f))

    # Hoc alias: ten nguon -> tro ve dich (de nhan dien lai o cac lan sau)
    norm = normalize_name(src.name)
    if norm:
        existing = db.scalar(select(CustomerAlias).where(CustomerAlias.name_norm == norm))
        if existing:
            existing.customer_id = tgt.id
        else:
            db.add(CustomerAlias(name_norm=norm, customer_id=tgt.id))
    # Cac alias khac dang tro ve nguon -> chuyen sang dich (bo dong trung ten_norm)
    for al in list(db.scalars(select(CustomerAlias).where(CustomerAlias.customer_id == src.id))):
        dup = db.scalar(
            select(CustomerAlias).where(
                CustomerAlias.name_norm == al.name_norm, CustomerAlias.customer_id == tgt.id
            )
        )
        if dup:
            db.delete(al)
        else:
            al.customer_id = tgt.id

    db.delete(src)
    _audit(db, user, "customer_merge", f"{src.name} → {tgt.name}", f"gộp #{src.id} vào #{tgt.id}")
    db.commit()
    db.refresh(tgt)
    return {"target": _customer_out(db, tgt), "moved": moved}


# ---------------------------------------------------------------------------
# Ho so
# ---------------------------------------------------------------------------
def _doc_out(d: Document) -> DocumentOut:
    try:
        cs_sigs = json.loads(d.lio_countersigned_signatures_json or "[]")
        if not isinstance(cs_sigs, list):
            cs_sigs = []
    except Exception:
        cs_sigs = []
    return DocumentOut(
        id=d.id, doc_id=d.doc_id, filename=d.filename, signer_name=d.signer_name,
        signed=d.signed, note=d.note, customer_id=d.customer_id,
        customer_name=d.customer.name if d.customer else None,
        created_at=d.created_at.isoformat(),
        download_url=f"/api/documents/{d.id}/download",
        view_url=f"/api/documents/{d.id}/view",
        nas_synced=d.nas_synced_at is not None,
        doc_type=d.doc_type or "",
        signed_upload_name=d.signed_upload_name or "",
        order_id=d.order_id,
        order_code=f"{d.order.code} · {d.order.name}" if d.order else "",
        lio_session_id=d.lio_session_id or "",
        lio_status=d.lio_status or "",
        lio_placement_method=d.lio_placement_method or "",
        lio_reason=d.lio_reason or "",
        lio_signed_at=d.lio_signed_at or "",
        lio_expires_at=d.lio_expires_at or "",
        lio_countersigned_status=d.lio_countersigned_status or "",
        lio_countersigned_at=d.lio_countersigned_at or "",
        lio_countersigned_file_id=d.lio_countersigned_file_id or "",
        lio_countersigned_error=d.lio_countersigned_error or "",
        lio_countersigned_signatures=cs_sigs,
    )


@app.get("/api/documents", response_model=DocumentsPage)
def list_documents(
    customer_id: int | None = None,
    unassigned: bool = False,
    order_id: int | None = None,
    search: str = "",
    page: int = 1,
    per_page: int = 20,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    page = max(1, page)
    per_page = min(max(1, per_page), 200)
    conds = []
    if unassigned:
        conds.append(Document.customer_id.is_(None))
    elif customer_id is not None:
        conds.append(Document.customer_id == customer_id)
    if order_id is not None:
        conds.append(Document.order_id == order_id)
    if search.strip():
        like = f"%{search.strip()}%"
        conds.append(Document.filename.ilike(like) | Document.signer_name.ilike(like))

    base = select(Document)
    for c in conds:
        base = base.where(c)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(Document.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return DocumentsPage(
        items=[_doc_out(d) for d in rows], total=total, page=page, per_page=per_page
    )


@app.post("/api/documents/{doc_pk}/assign", response_model=DocumentOut)
def assign_document(
    doc_pk: int, body: AssignRequest, background: BackgroundTasks,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if body.customer_id is not None and not db.get(Customer, body.customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    d.customer_id = body.customer_id
    db.commit()
    db.refresh(d)
    _audit(db, user, "assign", d.filename, d.customer.name if d.customer else "—")
    background.add_task(_bg_nas_sync, d.id)  # day sang thu muc khach moi
    return _doc_out(d)


@app.post("/api/documents/{doc_pk}/rename", response_model=DocumentOut)
def rename_document(
    doc_pk: int, body: DocumentRename, background: BackgroundTasks,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    """Doi ten bo ho so (mac dinh la ten file luc tao) de de quan ly."""
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    name = body.filename.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ten khong duoc de trong")
    found = storage.find_doc_path(d.doc_id)
    ext = found[1] if found else (Path(d.filename).suffix.lower() or ".pdf")
    if not name.lower().endswith(ext.lower()):
        name += ext
    old = d.filename
    d.filename = name
    db.commit()
    db.refresh(d)
    _audit(db, user, "rename_doc", name, f"từ: {old}")
    background.add_task(_bg_nas_sync, d.id)  # dong bo NAS voi ten moi
    return _doc_out(d)


def _gc_unreferenced_doc_files(db: Session, doc_ids: set[str]) -> None:
    """Xoa file vat ly trong storage neu khong con ban ghi Document nao tham chieu."""
    for did in doc_ids:
        if not did:
            continue
        still_used = db.scalar(
            select(func.count(Document.id)).where(
                (Document.doc_id == did) | (Document.signed_upload_id == did)
            )
        )
        if not still_used:
            storage.delete_doc_any(did)


@app.delete("/api/documents/{doc_pk}")
def delete_document(doc_pk: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    candidate_ids = {x for x in (d.doc_id, d.signed_upload_id) if x}
    _audit(db, user, "delete_doc", d.filename)
    db.delete(d)
    db.commit()
    _gc_unreferenced_doc_files(db, candidate_ids)
    return {"ok": True}


@app.get("/api/my/documents", response_model=list[DocumentOut])
def my_documents(user: CurrentUser = Depends(require_user), db: Session = Depends(get_session)):
    require_full_portal(user)
    if user.is_admin:
        # Admin xem tat ca ho so da phan loai
        q = select(Document).order_by(Document.created_at.desc())
    else:
        if not user.customer_id:
            return []
        q = select(Document).where(Document.customer_id == user.customer_id).order_by(
            Document.created_at.desc()
        )
    return [_doc_out(d) for d in db.scalars(q)]


@app.get("/api/documents/{doc_pk}/download")
def download_document(
    doc_pk: int, user: CurrentUser = Depends(require_user), db: Session = Depends(get_session)
):
    require_full_portal(user)
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    # Khach hang chi tai ho so cua minh
    if not user.is_admin and d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Khong co quyen")
    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    fpath, suffix = found
    media_map = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".xml": "application/xml",
        ".zip": "application/zip",
        ".md": "text/markdown; charset=utf-8",
        ".markdown": "text/markdown; charset=utf-8",
        ".mp4": "video/mp4",
    }
    media_type = media_map.get(suffix.lower(), "application/octet-stream")
    if suffix.lower() == ".mp4":
        return FileResponse(
            fpath,
            media_type="video/mp4",
            headers={
                "Content-Disposition": _content_disposition(d.filename),
                "Accept-Ranges": "bytes",
                "X-Accel-Buffering": "no",
            },
        )
    return StreamingResponse(
        iter([fpath.read_bytes()]), media_type=media_type,
        headers={"Content-Disposition": _content_disposition(d.filename)},
    )


@app.get("/api/documents/{doc_pk}/view")
def view_document(
    doc_pk: int,
    request: Request,
    format: str = "",
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
):
    """Xem trước trực tiếp hồ sơ (hỗ trợ PDF nguyên bản và Word .docx dựng trang A4)."""
    require_full_portal(user)
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if not user.is_admin and d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Khong co quyen")
    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    fpath, suffix = found
    raw = fpath.read_bytes()
    s_low = suffix.lower()
    csp_nonce = getattr(request.state, "csp_nonce", "")
    if s_low == ".docx" or (d.filename.lower().endswith(".docx") and docx_preview.is_valid_docx(raw)):
        if format.lower() == "pdf":
            pdf_bytes = docx_preview.render_docx_to_pdf_bytes(raw, title=d.filename)
            pdf_name = Path(d.filename).stem + ".pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
            )
        html_out = docx_preview.render_docx_preview_html(
            raw,
            title=d.filename,
            download_url=f"/api/documents/{d.id}/download",
            pdf_url=f"/api/documents/{d.id}/view?format=pdf",
        )
        return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
    if s_low in (".md", ".markdown") or (
        d.filename.lower().endswith((".md", ".markdown"))
        and markdown_preview.is_valid_markdown(raw, d.filename)
    ):
        if format.lower() == "pdf":
            pdf_bytes = markdown_preview.render_markdown_to_pdf_bytes(raw, title=d.filename)
            pdf_name = Path(d.filename).stem + ".pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
            )
        html_out = markdown_preview.render_markdown_preview_html(
            raw,
            title=d.filename,
            download_url=f"/api/documents/{d.id}/download",
            pdf_url=f"/api/documents/{d.id}/view?format=pdf",
            csp_nonce=csp_nonce,
        )
        return HTMLResponse(content=html_out)
    if s_low in (".xlsx", ".xls") or (
        d.filename.lower().endswith((".xlsx", ".xls"))
        and xlsx_preview.is_valid_xlsx(raw)
    ):
        if format.lower() == "pdf":
            pdf_bytes = xlsx_preview.render_xlsx_to_pdf_bytes(raw, title=d.filename)
            pdf_name = Path(d.filename).stem + ".pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
            )
        html_out = xlsx_preview.render_xlsx_preview_html(
            raw,
            title=d.filename,
            download_url=f"/api/documents/{d.id}/download",
            pdf_url=f"/api/documents/{d.id}/view?format=pdf",
        )
        return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
    if s_low == ".pdf" or raw.startswith(b"%PDF"):
        return StreamingResponse(
            iter([raw]),
            media_type="application/pdf",
            headers={"Content-Disposition": security_utils.safe_content_disposition(d.filename, disposition="inline")},
        )
    return StreamingResponse(
        iter([raw]),
        media_type="application/octet-stream",
        headers={"Content-Disposition": _content_disposition(d.filename)},
    )


@app.post("/api/documents/upload", response_model=DocumentOut)
async def upload_document_to_vault(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    doc_type: str = "",
    customer_id: int | None = None,
    note: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tải hồ sơ PDF hoặc Word (.docx) trực tiếp vào Kho hồ sơ vận hành."""
    orig_name = (file.filename or "tai-lieu.pdf").strip()
    ext = Path(orig_name).suffix.lower()
    max_bytes = 100 * 1024 * 1024 if ext == ".mp4" else 25 * 1024 * 1024
    content = await storage.read_upload_limited(file, max_bytes=max_bytes)
    if content.startswith(b"%PDF"):
        suffix = ".pdf"
        if not orig_name.lower().endswith(".pdf"):
            orig_name += ".pdf"
    elif ext == ".docx" and docx_preview.is_valid_docx(content):
        suffix = ".docx"
    elif docx_preview.is_valid_docx(content):
        suffix = ".docx"
        if not orig_name.lower().endswith(".docx"):
            orig_name += ".docx"
    elif ext in (".xlsx", ".xls") and xlsx_preview.is_valid_xlsx(content):
        suffix = ext
    elif xlsx_preview.is_valid_xlsx(content):
        suffix = ".xlsx"
        if not orig_name.lower().endswith((".xlsx", ".xls")):
            orig_name += ".xlsx"
    elif ext in (".md", ".markdown") and markdown_preview.is_valid_markdown(content, orig_name):
        suffix = ".md"
    elif ext == ".mp4" and len(content) >= 12 and b"ftyp" in content[:32]:
        suffix = ".mp4"
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Chỉ hỗ trợ tải lên tệp PDF (.pdf), Microsoft Word (.docx), Excel (.xlsx), Markdown (.md) hoặc Video (.mp4) hợp lệ",
        )
    if customer_id is not None and not db.get(Customer, customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    doc_id = storage.save_upload(content, suffix=suffix)
    doc = Document(
        doc_id=doc_id,
        filename=orig_name,
        signer_name=user.username or "Admin",
        signed=False,
        doc_type=doc_type or "khac",
        customer_id=customer_id,
        note=note.strip(),
        source_system="vault_upload",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    _audit(db, user, "upload_doc", orig_name, f"suffix={suffix}")
    background.add_task(_bg_nas_sync, doc.id)
    return _doc_out(doc)


@app.post("/api/documents/{doc_pk}/upload-signed", response_model=DocumentOut)
async def upload_signed(
    doc_pk: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Tai len ban tai lieu da co du chu ky cua cac ben (vd hop dong nhieu chu ky)."""
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    content = await storage.read_upload_limited(file, max_bytes=25 * 1024 * 1024)
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    up_id = storage.save_upload(content)
    d.doc_id = up_id
    d.signed_upload_id = up_id
    d.signed_upload_name = file.filename or f"da-ky-{up_id}.pdf"
    d.signed_upload_at = datetime.utcnow()
    d.signed = True
    db.commit()
    _audit(db, user, "upload_signed", d.filename, d.signed_upload_name)
    # Backup NAS (best-effort)
    if settings.nas_enabled:
        try:
            nas.sync_document(settings, db, d)
            nas.sync_extra_file(
                settings, d.customer.name if d.customer else "",
                "da-ky", d.signed_upload_name, content,
            )
        except Exception:
            pass
    # Neu ho so nay da co phien ky LIO -> tu dong gui ban ky 2 ben ve LIO (best-effort)
    if d.lio_session_id and d.lio_status == "signed":
        try:
            from . import lio_signer
            d = lio_signer.submit_countersigned_document(
                db,
                settings,
                d,
                pdf_bytes=content,
                filename=d.signed_upload_name,
            )
            _audit(
                db,
                user,
                "lio_countersigned",
                d.filename,
                f"session={d.lio_session_id} file_id={d.lio_countersigned_file_id}",
            )
        except Exception as exc:
            logger.warning("Tự động gửi bản ký 2 bên về LIO khi upload-signed #%s chưa thành công: %s", d.id, exc)
    db.refresh(d)
    return _doc_out(d)


@app.get("/api/documents/{doc_pk}/signed-file")
def download_signed_upload(
    doc_pk: int,
    inline: bool = False,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
):
    require_full_portal(user)
    d = db.get(Document, doc_pk)
    if not d or not d.signed_upload_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chua co ban da ky tai len")
    if not user.is_admin and d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Khong co quyen")
    if not storage.exists(d.signed_upload_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    data = storage.read_doc(d.signed_upload_id)
    kind = "inline" if inline else "attachment"
    disp = f"{kind}; filename*=UTF-8''{quote(d.signed_upload_name)}"
    return StreamingResponse(
        iter([data]), media_type="application/pdf", headers={"Content-Disposition": disp}
    )


# ---------------------------------------------------------------------------
# LIO Signer (ky so PDF tu xa HKD Cong nghe LIO - CAS CERT / CMC-CA)
# ---------------------------------------------------------------------------
@app.get("/api/lio-signer/status")
def get_lio_signer_status(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    from . import lio_signer
    return lio_signer.check_health(settings)


@app.post("/api/documents/{doc_pk}/lio-sign", response_model=DocumentOut)
def request_lio_signature(
    doc_pk: int,
    force_new: bool = False,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Gui ho so PDF sang LIO Signer de nguoi dai dien HKD Cong nghe LIO duyet ky tren dien thoai."""
    from . import lio_signer
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    try:
        d = lio_signer.submit_document(db, settings, d, force_new=force_new)
    except lio_signer.LioSignerError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    _audit(db, user, "lio_sign", d.filename, f"session={d.lio_session_id} status={d.lio_status}")
    return _doc_out(d)


@app.post("/api/documents/{doc_pk}/lio-poll", response_model=DocumentOut)
def poll_lio_signature(
    doc_pk: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Kiem tra ngay trang thai phien ky LIO va tai file PDF da ky ve kho neu da duyet xong."""
    from . import lio_signer
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    try:
        d = lio_signer.poll_document(db, settings, d, notify_telegram=True)
    except lio_signer.LioSignerError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if d.lio_status == "signed":
        _audit(db, user, "lio_signed", d.filename, f"session={d.lio_session_id}")
    return _doc_out(d)


@app.post("/api/documents/{doc_pk}/lio-countersigned", response_model=DocumentOut)
async def send_lio_countersigned(
    doc_pk: int,
    request: Request,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Gửi lại bản hợp đồng đã đủ chữ ký 2 bên về LIO (POST /v1/sessions/{session_id}/countersigned).

    Hỗ trợ cả 2 cách gọi:
    - Gửi trực tiếp file hiện có trong kho hồ sơ (body rỗng hoặc JSON).
    - Hoặc đính kèm tệp PDF mới qua multipart/form-data (`file`) để lưu vào kho rồi đẩy sang LIO.
    """
    from . import lio_signer
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")

    uploaded_bytes: bytes | None = None
    uploaded_name: str | None = None
    ctype = (request.headers.get("content-type") or "").lower()
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        f_item = form.get("file")
        if f_item is not None and hasattr(f_item, "read"):
            content = await storage.read_upload_limited(f_item, max_bytes=25 * 1024 * 1024)
            if not content.startswith(b"%PDF"):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
            up_id = storage.save_upload(content)
            d.doc_id = up_id
            d.signed_upload_id = up_id
            d.signed_upload_name = getattr(f_item, "filename", None) or f"da-ky-2-ben-{up_id}.pdf"
            d.signed_upload_at = datetime.utcnow()
            d.signed = True
            db.commit()
            uploaded_bytes = content
            uploaded_name = d.signed_upload_name
            if settings.nas_enabled:
                try:
                    nas.sync_document(settings, db, d)
                    nas.sync_extra_file(
                        settings,
                        d.customer.name if d.customer else "",
                        "da-ky",
                        d.signed_upload_name,
                        content,
                    )
                except Exception:
                    pass

    try:
        d = lio_signer.submit_countersigned_document(
            db,
            settings,
            d,
            pdf_bytes=uploaded_bytes,
            filename=uploaded_name,
            notify_telegram=True,
        )
    except lio_signer.LioSignerError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc

    _audit(
        db,
        user,
        "lio_countersigned",
        d.filename,
        f"session={d.lio_session_id} file_id={d.lio_countersigned_file_id}",
    )
    return _doc_out(d)


def _bg_process_lio_webhook(delivery_id: str, payload: dict) -> None:
    from . import lio_signer
    settings = get_settings()
    for db in get_session():
        try:
            lio_signer.process_webhook_event(db, settings, delivery_id, payload)
        except Exception:
            pass


@app.post("/api/lio-signer/webhook")
async def lio_signer_webhook(
    request: Request,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
):
    """Cổng nhận Webhook từ LIO Signer (xác thực chữ ký HMAC-SHA256 trên raw body)."""
    from . import lio_signer
    raw_body = await request.body()
    ts_hdr = request.headers.get("X-Lio-Timestamp", "")
    sig_hdr = request.headers.get("X-Lio-Signature", "")
    delivery_id = request.headers.get("X-Lio-Delivery-Id", "")
    if not lio_signer.verify_webhook_signature(
        settings.lio_signer_webhook_secret,
        ts_hdr,
        sig_hdr,
        raw_body,
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid LIO webhook signature")
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON") from exc
    background.add_task(_bg_process_lio_webhook, delivery_id, payload)
    return {"ok": True}

# ---------------------------------------------------------------------------
# Cong khach hang: hoa don iHOADON da phat hanh
# ---------------------------------------------------------------------------
def _ihoadon_invoice_out(row: IhoadonInvoice) -> dict:
    return {
        "id": row.id,
        "invoice_number": row.invoice_number,
        "invoice_series": row.invoice_series,
        "invoice_date": row.invoice_date,
        "buyer_tax_code": row.buyer_tax_code,
        "buyer_name": row.buyer_name,
        "total_payment": row.total_payment,
        "status": row.status,
        "adjustment_type": row.adjustment_type,
        "customer_id": row.customer_id,
        "customer_name": row.customer.name if row.customer else None,
        "match_source": row.match_source,
        "pdf_ready": bool(row.pdf_doc_id),
        "xml_ready": bool(row.xml_doc_id),
        "sync_error": row.sync_error,
        "synced_at": row.synced_at.isoformat() if row.synced_at else "",
    }


def _invoice_scope(user: CurrentUser):
    if user.is_admin:
        return []
    if not user.customer_id:
        return [IhoadonInvoice.id == -1]
    return [IhoadonInvoice.customer_id == user.customer_id]


@app.get("/api/my/invoices")
def my_ihoadon_invoices(
    tu: str = "", den: str = "", q: str = "",
    user: CurrentUser = Depends(require_user), db: Session = Depends(get_session),
):
    require_full_portal(user)
    stmt = select(IhoadonInvoice)
    for cond in _invoice_scope(user):
        stmt = stmt.where(cond)
    if tu:
        stmt = stmt.where(IhoadonInvoice.invoice_date >= tu)
    if den:
        stmt = stmt.where(IhoadonInvoice.invoice_date <= den)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            IhoadonInvoice.invoice_number.ilike(like)
            | IhoadonInvoice.invoice_series.ilike(like)
            | IhoadonInvoice.buyer_name.ilike(like)
        )
    rows = db.scalars(stmt.order_by(IhoadonInvoice.invoice_date.desc(), IhoadonInvoice.id.desc()))
    return [_ihoadon_invoice_out(row) for row in rows]


def _owned_invoice(db: Session, iid: int, user: CurrentUser) -> IhoadonInvoice:
    require_full_portal(user)
    row = db.get(IhoadonInvoice, iid)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    if not user.is_admin and row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Không có quyền")
    return row


@app.get("/api/my/invoices/{iid}/pdf")
def my_ihoadon_pdf(
    iid: int, user: CurrentUser = Depends(require_user), db: Session = Depends(get_session)
):
    row = _owned_invoice(db, iid, user)
    if not row.pdf_doc_id or not storage.exists(row.pdf_doc_id, suffix=".pdf"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chưa có file PDF hóa đơn")
    _audit(db, user, "customer_invoice_download", row.invoice_number, "PDF")
    return StreamingResponse(
        iter([storage.read_doc(row.pdf_doc_id, suffix=".pdf")]), media_type="application/pdf",
        headers={"Content-Disposition": _content_disposition(row.pdf_filename or "hoa-don.pdf")},
    )


@app.get("/api/my/invoices/{iid}/xml")
def my_ihoadon_xml(
    iid: int, user: CurrentUser = Depends(require_user), db: Session = Depends(get_session)
):
    row = _owned_invoice(db, iid, user)
    if not row.xml_doc_id or not storage.exists(row.xml_doc_id, suffix=".xml"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chưa có file XML hóa đơn")
    _audit(db, user, "customer_invoice_download", row.invoice_number, "XML")
    return StreamingResponse(
        iter([storage.read_doc(row.xml_doc_id, suffix=".xml")]), media_type="application/xml",
        headers={"Content-Disposition": _content_disposition(row.xml_filename or "hoa-don.xml")},
    )


def _zip_arcname(folder: str, name: str, fallback: str) -> str:
    clean = Path(name or "").name.strip() or fallback
    clean = re.sub(r"[^A-Za-z0-9À-ỹ._() -]+", "_", clean)[:220]
    return f"{folder}/{clean}"


@app.get("/api/my/download.zip")
def my_portal_zip(
    tu: str = "", den: str = "", user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
):
    require_full_portal(user)
    inv_stmt = select(IhoadonInvoice)
    for cond in _invoice_scope(user):
        inv_stmt = inv_stmt.where(cond)
    if tu:
        inv_stmt = inv_stmt.where(IhoadonInvoice.invoice_date >= tu)
    if den:
        inv_stmt = inv_stmt.where(IhoadonInvoice.invoice_date <= den)
    doc_stmt = select(Document)
    if not user.is_admin:
        doc_stmt = doc_stmt.where(Document.customer_id == user.customer_id)
    docs = list(db.scalars(doc_stmt.order_by(Document.created_at.desc())))
    if tu:
        docs = [d for d in docs if d.created_at.date().isoformat() >= tu]
    if den:
        docs = [d for d in docs if d.created_at.date().isoformat() <= den]

    buf = _io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in db.scalars(inv_stmt.order_by(IhoadonInvoice.invoice_date, IhoadonInvoice.id)):
            stem = f"{row.invoice_date}_{row.invoice_series}_{row.invoice_number}".strip("_")
            if row.pdf_doc_id and storage.exists(row.pdf_doc_id, suffix=".pdf"):
                zf.writestr(_zip_arcname("hoa-don", stem + ".pdf", "hoa-don.pdf"), storage.read_doc(row.pdf_doc_id, suffix=".pdf"))
                count += 1
            if row.xml_doc_id and storage.exists(row.xml_doc_id, suffix=".xml"):
                zf.writestr(_zip_arcname("hoa-don", stem + ".xml", "hoa-don.xml"), storage.read_doc(row.xml_doc_id, suffix=".xml"))
                count += 1
        for d in docs:
            found_doc = storage.find_doc_path(d.doc_id)
            if found_doc:
                fpath_doc, suffix_doc = found_doc
                zf.writestr(_zip_arcname("ho-so", f"{d.id}_{d.filename}", f"ho-so-{d.id}{suffix_doc}"), fpath_doc.read_bytes())
                count += 1
    if not count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không có file trong phạm vi đã lọc")
    buf.seek(0)
    _audit(db, user, "customer_portal_zip", f"{count} file", f"{tu or 'đầu'}..{den or 'nay'}")
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="application/zip",
        headers={"Content-Disposition": _content_disposition("chung-tu-khach-hang.zip")},
    )


@app.post("/api/ihoadon/customer-sync")
def start_ihoadon_customer_sync(
    background: BackgroundTasks, user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    latest = db.scalar(
        select(JobRun).where(
            JobRun.kind == "ihoadon_customer_sync", JobRun.status == "running"
        ).order_by(JobRun.id.desc())
    )
    if latest:
        raise HTTPException(status.HTTP_409_CONFLICT, "Một phiên đồng bộ đang chạy")
    background.add_task(_bg_ihoadon_sync)
    _audit(db, user, "ihoadon_customer_sync_start", "manual")
    return {"ok": True}


@app.get("/api/ihoadon/customer-sync/status")
def ihoadon_customer_sync_status(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    job = db.scalar(
        select(JobRun).where(JobRun.kind == "ihoadon_customer_sync").order_by(JobRun.id.desc())
    )
    return {
        "job": None if not job else {
            "id": job.id, "status": job.status, "stats": json.loads(job.stats or "{}"),
            "error": job.error, "started_at": job.started_at.isoformat(),
            "finished_at": job.finished_at.isoformat() if job.finished_at else "",
        },
        "total": db.query(IhoadonInvoice).count(),
        "unmatched": db.query(IhoadonInvoice).filter(IhoadonInvoice.customer_id.is_(None)).count(),
    }


@app.get("/api/ihoadon/customer-invoices/unmatched")
def unmatched_ihoadon_invoices(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    rows = db.scalars(
        select(IhoadonInvoice).where(IhoadonInvoice.customer_id.is_(None))
        .order_by(IhoadonInvoice.invoice_date.desc())
    )
    return [_ihoadon_invoice_out(row) for row in rows]


@app.post("/api/ihoadon/customer-invoices/{iid}/assign")
def assign_ihoadon_invoice(
    iid: int, body: AssignRequest, user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(IhoadonInvoice, iid)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    if body.customer_id is not None and not db.get(Customer, body.customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
    row.customer_id = body.customer_id
    row.match_source = "manual" if body.customer_id else ""
    db.commit()
    db.refresh(row)
    _audit(db, user, "ihoadon_customer_assign", row.invoice_number, str(body.customer_id or "—"))
    return _ihoadon_invoice_out(row)


@app.get("/api/documents/{doc_pk}/verify", response_model=VerifyResponse)
def verify_document_record(
    doc_pk: int,
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Kiem tra chu ky cua mot ho so da luu (admin bat ky / khach hang cua minh)."""
    require_full_portal(user)
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if not user.is_admin and d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Khong co quyen")
    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    raw = found[0].read_bytes()
    if not raw.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chi ho tro kiem tra chu ky so tren file PDF")
    return verify.verify_document(settings, raw, d.doc_id)


# ---------------------------------------------------------------------------
# Don hang: gom nhieu bo ho so (bao gia -> BBBG -> BBNT -> de nghi TT)
# ---------------------------------------------------------------------------
def _order_out(db: Session, o: Order) -> OrderOut:
    n = db.scalar(select(func.count(Document.id)).where(Document.order_id == o.id)) or 0
    return OrderOut(
        id=o.id, code=o.code, name=o.name, customer_id=o.customer_id,
        customer_name=o.customer.name if o.customer else None,
        note=o.note, created_at=o.created_at.isoformat(), document_count=n,
    )


@app.get("/api/orders", response_model=list[OrderOut])
def list_orders(
    customer_id: int | None = None,
    search: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    q = select(Order)
    if customer_id is not None:
        q = q.where(Order.customer_id == customer_id)
    if search.strip():
        q = q.where(Order.name.ilike(f"%{search.strip()}%"))
    return [_order_out(db, o) for o in db.scalars(q.order_by(Order.created_at.desc()))]


@app.post("/api/orders", response_model=OrderOut)
def create_order(
    body: OrderCreate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    if not body.name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ten don hang trong")
    if body.customer_id is not None and not db.get(Customer, body.customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    o = Order(name=body.name.strip(), customer_id=body.customer_id, note=body.note)
    db.add(o)
    db.commit()
    db.refresh(o)
    _audit(db, user, "order_create", o.code, o.name)
    return _order_out(db, o)


@app.delete("/api/orders/{oid}")
def delete_order(
    oid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay don hang")
    for d in db.scalars(select(Document).where(Document.order_id == oid)):
        d.order_id = None  # bo gan, khong xoa ho so
    _audit(db, user, "order_delete", o.code, o.name)
    db.delete(o)
    db.commit()
    return {"ok": True}


@app.post("/api/documents/{doc_pk}/order", response_model=DocumentOut)
def assign_document_order(
    doc_pk: int, body: OrderAssign,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if body.order_id is not None and not db.get(Order, body.order_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay don hang")
    d.order_id = body.order_id
    db.commit()
    db.refresh(d)
    _audit(db, user, "order_assign", d.filename, d.order.code if d.order else "—")
    return _doc_out(d)


# ---------------------------------------------------------------------------
# Thao tac hang loat (bulk)
# ---------------------------------------------------------------------------
@app.post("/api/documents/bulk-assign")
def bulk_assign(
    body: BulkAssign, background: BackgroundTasks,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    if body.customer_id is not None and not db.get(Customer, body.customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    ids = []
    for d in db.scalars(select(Document).where(Document.id.in_(body.ids))):
        d.customer_id = body.customer_id
        ids.append(d.id)
    db.commit()
    for did in ids:
        background.add_task(_bg_nas_sync, did)
    return {"ok": True, "count": len(ids)}


@app.post("/api/documents/bulk-delete")
def bulk_delete(
    body: BulkIds, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    n = 0
    candidate_ids: set[str] = set()
    for d in db.scalars(select(Document).where(Document.id.in_(body.ids))):
        if d.doc_id:
            candidate_ids.add(d.doc_id)
        if d.signed_upload_id:
            candidate_ids.add(d.signed_upload_id)
        db.delete(d)
        n += 1
    db.commit()
    _gc_unreferenced_doc_files(db, candidate_ids)
    _audit(db, user, "bulk_delete", f"{n} hồ sơ")
    return {"ok": True, "count": n}


# ---------------------------------------------------------------------------
# Chia se file qua link cong khai (co han)
# ---------------------------------------------------------------------------
def _share_url(settings: Settings, token: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/s/{token}"


# ---------------------------------------------------------------------------
# iNut Training: proxy noi bo + chia se cau tra loi public
# ---------------------------------------------------------------------------
def _public_json(body: bytes) -> dict:
    try:
        parsed = json.loads(body or b"{}")
    except (TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dữ liệu yêu cầu không hợp lệ") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dữ liệu yêu cầu không hợp lệ")
    return parsed


def _public_session_by_token(db: Session, token: str) -> TrainingPublicSession | None:
    if not isinstance(token, str) or not (24 <= len(token) <= 128):
        return None
    token_hash = public_training.public_training_token_hash(token)
    return db.scalar(select(TrainingPublicSession).where(TrainingPublicSession.token_hash == token_hash))


@app.post("/internal/public-training/sessions", status_code=status.HTTP_201_CREATED)
async def public_training_session_create(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    body = _public_json(await public_training.require_internal_signature(request, settings))
    try:
        phone = public_training.normalize_phone(str(body.get("phone", "")))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if body.get("consent") is not True:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cần đồng ý lưu số điện thoại trước khi hỏi")
    locale = str(body.get("locale", "vi"))[:5]
    if locale not in {"vi", "en"}:
        locale = "vi"
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    row = TrainingPublicSession(
        token_hash=public_training.public_training_token_hash(token),
        phone_ciphertext=crypto.encrypt(phone),
        phone_hash=crypto.fingerprint(phone),
        phone_last4=phone[-4:],
        locale=locale,
        consent_at=now,
        created_at=now,
        last_seen_at=now,
    )
    db.add(row)
    db.commit()
    return {"sessionId": row.id, "sessionToken": token, "phoneLast4": row.phone_last4}


@app.get("/internal/public-training/sessions")
async def public_training_session_restore(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Restore a browser session without returning the stored phone number."""
    await public_training.require_internal_signature(request, settings)
    token = request.query_params.get("sessionToken", "")
    session = _public_session_by_token(db, token)
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phiên hỏi đáp không hợp lệ")
    session.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "sessionId": session.id,
        "phoneLast4": session.phone_last4,
        "locale": session.locale,
    }


@app.post("/internal/public-training/questions", status_code=status.HTTP_202_ACCEPTED)
async def public_training_question_create(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    body = _public_json(await public_training.require_internal_signature(request, settings))
    token = str(body.get("sessionToken", ""))
    session = _public_session_by_token(db, token)
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phiên hỏi đáp không hợp lệ")
    try:
        question = public_training.validate_question(str(body.get("question", "")))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    since = datetime.now(timezone.utc) - timedelta(seconds=max(1, settings.public_training_rate_window_seconds))
    recent = db.scalar(select(func.count(TrainingPublicQuery.id)).where(
        TrainingPublicQuery.session_id == session.id,
        TrainingPublicQuery.created_at >= since,
    )) or 0
    if recent >= max(1, settings.public_training_rate_limit):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Bạn đã hỏi quá nhiều lần, hãy thử lại sau")
    job_id = secrets.token_urlsafe(24)
    query = TrainingPublicQuery(
        job_id=job_id,
        session_id=session.id,
        question=question,
        status="running",
        stage="Đang tìm trong kho iNut",
    )
    session.last_seen_at = datetime.now(timezone.utc)
    db.add(query)
    db.commit()
    try:
        public_training_jobs.start(
            job_id=job_id,
            owner_token=token,
            settings=settings,
            question=question,
            hermes_session_id="",
        )
    except Exception as exc:  # noqa: BLE001
        query.status = "failed"
        query.stage = "Không thể hoàn tất"
        query.completed_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Hermes Training chưa thể nhận câu hỏi") from exc
    return {"jobId": job_id, "status": "running", "stage": query.stage}


@app.get("/internal/public-training/questions/{job_id}")
async def public_training_question_status(
    job_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    await public_training.require_internal_signature(request, settings)
    token = request.query_params.get("sessionToken", "")
    session = _public_session_by_token(db, token)
    row = db.scalar(select(TrainingPublicQuery).where(
        TrainingPublicQuery.job_id == job_id,
        TrainingPublicQuery.session_id == session.id if session else False,
    )) if session else None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lượt tra cứu")
    current = public_training_jobs.get(owner_token=token, job_id=job_id)
    if current is not None:
        if current.get("result"):
            current["result"] = public_training.sanitize_public_result(current["result"], settings)
        return current
    answer = {}
    try:
        answer = json.loads(row.answer_json or "{}")
    except ValueError:
        answer = {}
    payload = {"status": row.status, "stage": row.stage}
    if row.status == "done":
        payload["result"] = public_training.sanitize_public_result(answer, settings)
    if row.status == "failed":
        payload["error"] = "Hermes Training chưa thể trả lời"
    return payload


@app.get("/internal/public-training/history")
async def public_training_history_internal(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    await public_training.require_internal_signature(request, settings)
    token = request.query_params.get("sessionToken", "")
    session = _public_session_by_token(db, token)
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Phiên hỏi đáp không hợp lệ")
    try:
        limit = max(1, min(int(request.query_params.get("limit", "200")), 500))
    except ValueError:
        limit = 200
    rows = list(db.scalars(select(TrainingPublicQuery).where(
        TrainingPublicQuery.session_id == session.id,
    ).order_by(TrainingPublicQuery.created_at.desc()).limit(limit)))
    items = []
    for row in rows:
        try:
            answer = json.loads(row.answer_json or "{}")
        except ValueError:
            answer = {}
        items.append({
            "jobId": row.job_id,
            "question": row.question,
            "status": row.status,
            "answer": public_training.sanitize_public_result(answer, settings),
            "createdAt": row.created_at.isoformat(),
            "completedAt": row.completed_at.isoformat() if row.completed_at else None,
        })
    return {"items": items}


@app.get("/api/training/search")
def training_search(
    q: str,
    _user: CurrentUser = Depends(require_training),
    settings: Settings = Depends(get_settings),
):
    try:
        return {"results": training.search(settings, q)}
    except training.TrainingError as exc:
        raise _training_error(exc) from exc


@app.get("/training/help", response_class=HTMLResponse)
def training_archived_help(settings: Settings = Depends(get_settings)):
    try:
        content = training.archived_help(settings)
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    return HTMLResponse(content=content, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/training/opc-help", response_class=HTMLResponse)
def training_archived_opc_help(settings: Settings = Depends(get_settings)):
    try:
        content = training.archived_opc_help(settings)
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    return HTMLResponse(content=content, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/training/pc-ui-help", response_class=HTMLResponse)
def training_archived_pc_ui_help(settings: Settings = Depends(get_settings)):
    try:
        content = training.archived_pc_ui_help(settings)
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    return HTMLResponse(content=content, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/training/eval-report", response_class=HTMLResponse)
def training_eval_report(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        content = training.archived_eval_report(settings)
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    return HTMLResponse(content=content, headers={"Cache-Control": "no-cache"})


@app.post("/api/training/ask")
def training_ask(
    body: dict = Body(...),
    user: CurrentUser = Depends(require_training),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    question = str(body.get("question", ""))
    session_id = str(body.get("session_id", ""))
    assistant_mode = str(body.get("mode", "technical"))
    try:
        data = training.ask(
            settings,
            question,
            session_id,
            _training_personal_context(db, user.id),
            assistant_mode=assistant_mode,
        )
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    return data


@app.post("/api/training/jobs", status_code=status.HTTP_202_ACCEPTED)
def training_job_start(
    body: dict = Body(...),
    user: CurrentUser = Depends(require_training),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    assistant_mode = str(body.get("mode", "technical"))
    try:
        personal_context = _training_personal_context(db, user.id)
        job_id = training_jobs.start(
            user.username,
            settings,
            str(body.get("question", "")),
            str(body.get("session_id", "")),
            personal_context,
            assistant_mode,
        )
    except training.TrainingError as exc:
        raise _training_error(exc) from exc
    db.add(TrainingQuery(
        job_id=job_id,
        username=user.username,
        question=str(body.get("question", "")).strip(),
        input_tokens_est=_estimated_tokens(str(body.get("question", ""))),
    ))
    db.commit()
    return {"jobId": job_id, "status": "running", "stage": "Đang tìm trong kho iNut"}


@app.get("/api/training/jobs/{job_id}")
def training_job_status(
    job_id: str,
    user: CurrentUser = Depends(require_training),
    db: Session = Depends(get_session),
):
    job = training_jobs.get(user.username, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lượt tra cứu")
    record = db.scalar(select(TrainingQuery).where(TrainingQuery.job_id == job_id))
    if record is not None and record.status == "running" and job["status"] != "running":
        record.status = job["status"]
        record.completed_at = datetime.now(timezone.utc)
        record.duration_ms = max(0, int((record.completed_at-record.created_at.replace(tzinfo=timezone.utc)).total_seconds()*1000))
        if job.get("result"):
            record.output_tokens_est = _estimated_tokens(json.dumps(job["result"], ensure_ascii=False))
            record.answer_json = json.dumps(job["result"].get("answer", {}), ensure_ascii=False)
        db.commit()
    return job


def _training_personal_context(db: Session, user_id: int) -> str:
    notes = db.scalars(select(TrainingKnowledge).where(
        TrainingKnowledge.user_id == user_id,
        TrainingKnowledge.enabled.is_(True),
    ).order_by(TrainingKnowledge.updated_at.desc()).limit(20))
    return "\n\n".join(f"[{note.title}]\n{note.content}" for note in notes)


@app.get("/api/training/history")
def training_history(
    limit: int = 50,
    user: CurrentUser = Depends(require_training),
    db: Session = Depends(get_session),
):
    limit = max(1, min(limit, 100))
    rows = list(db.scalars(select(TrainingQuery).where(
        TrainingQuery.username == user.username,
    ).order_by(TrainingQuery.created_at.desc()).limit(limit)))
    return {"items": [{
        "jobId": row.job_id,
        "question": row.question,
        "status": row.status,
        "answer": json.loads(row.answer_json or "{}"),
        "createdAt": row.created_at.isoformat(),
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
        "durationMs": row.duration_ms,
    } for row in rows]}


@app.get("/api/training/knowledge")
def training_knowledge_self(
    user_id: int | None = None,
    user: CurrentUser = Depends(require_training),
    db: Session = Depends(get_session),
):
    target_id = user_id if user.is_admin and user_id else user.id
    rows = db.scalars(select(TrainingKnowledge).where(
        TrainingKnowledge.user_id == target_id,
    ).order_by(TrainingKnowledge.updated_at.desc()))
    return {"items": [_knowledge_out(row) for row in rows]}


def _knowledge_out(row: TrainingKnowledge) -> dict:
    return {"id": row.id, "userId": row.user_id, "title": row.title,
            "content": row.content, "enabled": row.enabled,
            "updatedAt": row.updated_at.isoformat()}


@app.post("/api/training/knowledge")
def training_knowledge_create(
    body: dict = Body(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    try:
        target_id = int(body.get("user_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tài khoản không hợp lệ") from exc
    title, content = str(body.get("title", "")).strip(), str(body.get("content", "")).strip()
    if not title or len(title) > 160 or not content or len(content) > 12000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tiêu đề hoặc nội dung kiến thức không hợp lệ")
    if db.get(User, target_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tài khoản")
    row = TrainingKnowledge(user_id=target_id, title=title, content=content,
                            enabled=bool(body.get("enabled", True)), created_by=user.id)
    db.add(row)
    db.commit()
    _audit(db, user, "training_knowledge_create", str(target_id), title)
    return _knowledge_out(row)


@app.patch("/api/training/knowledge/{knowledge_id}")
def training_knowledge_update(
    knowledge_id: int,
    body: dict = Body(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(TrainingKnowledge, knowledge_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy kiến thức")
    if "title" in body:
        row.title = str(body["title"]).strip()
    if "content" in body:
        row.content = str(body["content"]).strip()
    if "enabled" in body:
        row.enabled = bool(body["enabled"])
    if not row.title or len(row.title) > 160 or not row.content or len(row.content) > 12000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tiêu đề hoặc nội dung kiến thức không hợp lệ")
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    _audit(db, user, "training_knowledge_update", str(row.user_id), row.title)
    return _knowledge_out(row)


@app.delete("/api/training/knowledge/{knowledge_id}")
def training_knowledge_delete(
    knowledge_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(TrainingKnowledge, knowledge_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy kiến thức")
    db.delete(row)
    db.commit()
    _audit(db, user, "training_knowledge_delete", str(row.user_id), row.title)
    return {"ok": True}


def _estimated_tokens(value: str) -> int:
    return max(1, (len(value.strip()) + 3) // 4)


def _latency_summary(values: list[int]) -> dict[str, int]:
    """Return stable percentile metrics for completed Messenger replies."""
    ordered = sorted(max(0, int(value)) for value in values)
    if not ordered:
        return {"count": 0, "averageMs": 0, "p50Ms": 0, "p95Ms": 0, "maxMs": 0}

    def percentile(percent: float) -> int:
        index = min(len(ordered) - 1, max(0, math.ceil(percent / 100 * len(ordered)) - 1))
        return ordered[index]

    return {
        "count": len(ordered),
        "averageMs": round(sum(ordered) / len(ordered)),
        "p50Ms": percentile(50),
        "p95Ms": percentile(95),
        "maxMs": ordered[-1],
    }


@app.get("/api/training/stats")
def training_stats(
    _user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rows = list(db.scalars(select(TrainingQuery).order_by(TrainingQuery.created_at.desc()).limit(1000)))
    facebook_rows = list(db.scalars(select(FacebookMessage).order_by(FacebookMessage.created_at.desc()).limit(1000)))
    users: dict[str, dict] = {}
    for row in rows:
        item = users.setdefault(row.username, {"username": row.username, "questions": 0, "tokens": 0, "durationMs": 0})
        item["questions"] += 1
        item["tokens"] += row.input_tokens_est + row.output_tokens_est
        item["durationMs"] += row.duration_ms
    facebook_statuses: dict[str, int] = {}
    for row in facebook_rows:
        key = f"{row.direction}_{row.status}"
        facebook_statuses[key] = facebook_statuses.get(key, 0) + 1
    completed_facebook = [row for row in facebook_rows if row.latency_ms > 0]
    facebook_latency = _latency_summary([row.latency_ms for row in completed_facebook])
    facebook_stages = {
        "queue": _latency_summary([row.queue_latency_ms for row in completed_facebook if row.queue_latency_ms > 0]),
        "context": _latency_summary([row.context_latency_ms for row in completed_facebook if row.context_latency_ms > 0]),
        "hermes": _latency_summary([row.hermes_latency_ms for row in completed_facebook if row.hermes_latency_ms > 0]),
        "send": _latency_summary([row.send_latency_ms for row in completed_facebook if row.send_latency_ms > 0]),
        "profile": _latency_summary([row.profile_lookup_ms for row in completed_facebook if row.profile_lookup_ms > 0]),
    }
    return {
        "totals": {
            "questions": len(rows),
            "tokens": sum(row.input_tokens_est+row.output_tokens_est for row in rows),
            "successful": sum(row.status == "done" for row in rows),
        },
        "users": sorted(users.values(), key=lambda item: item["questions"], reverse=True),
        "recent": [{
            "username": row.username,
            "question": row.question,
            "status": row.status,
            "tokens": row.input_tokens_est+row.output_tokens_est,
            "durationMs": row.duration_ms,
            "createdAt": row.created_at.isoformat(),
        } for row in rows[:30]],
        "runtime": training.runtime_stats(get_settings()),
        "facebook": {
            "total": len(facebook_rows),
            "inbound": sum(row.direction == "inbound" for row in facebook_rows),
            "outbound": sum(row.direction == "outbound" for row in facebook_rows),
            "replied": sum(row.status == "replied" for row in facebook_rows),
            "rejected": sum(row.status == "rejected" for row in facebook_rows),
            "failed": sum(row.status == "failed" for row in facebook_rows),
            "statuses": facebook_statuses,
            "latency": facebook_latency,
            "stages": facebook_stages,
            "recent": [{
                "direction": row.direction,
                "status": row.status,
                "name": _facebook_display_name(row),
                "text": row.text[:160],
                "error": row.error[:240],
                "createdAt": row.created_at.isoformat(),
                "queueLatencyMs": row.queue_latency_ms,
                "latencyMs": row.latency_ms,
                "hermesLatencyMs": row.hermes_latency_ms,
                "contextLatencyMs": row.context_latency_ms,
                "sendLatencyMs": row.send_latency_ms,
            } for row in facebook_rows[:20]],
        },
        "tokenNote": "Token ước tính từ độ dài câu hỏi và câu trả lời; Hermes CLI chưa trả usage chuẩn.",
    }


def _facebook_display_name(row: FacebookMessage) -> str:
    return row.sender_name.strip() or f"Facebook · {row.psid[-6:]}"


@app.get("/api/facebook/conversations")
def facebook_conversations(
    limit: int = 100,
    _user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Return recent Messenger conversations grouped for the admin inbox."""
    rows = list(db.scalars(
        select(FacebookMessage)
        .order_by(FacebookMessage.created_at.desc(), FacebookMessage.id.desc())
        .limit(5000)
    ))
    conversations: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row.page_id, row.psid)
        item = conversations.get(key)
        if item is None:
            item = {
                "conversationId": f"{row.page_id}:{row.psid}",
                "pageId": row.page_id,
                "psid": row.psid,
                "name": _facebook_display_name(row),
                "messageCount": 0,
                "failedCount": 0,
                "lastText": row.text[:240],
                "lastDirection": row.direction,
                "lastStatus": row.status,
                "lastAt": row.created_at.isoformat(),
                "lastLatencyMs": row.latency_ms,
            }
            conversations[key] = item
        if row.sender_name.strip() and item["name"].startswith("Facebook · "):
            item["name"] = row.sender_name.strip()
        item["messageCount"] += 1
        item["failedCount"] += row.status == "failed"
    return {"items": list(conversations.values())[:max(1, min(limit, 200))]}


@app.get("/api/facebook/conversations/{page_id}/{psid}")
def facebook_conversation_history(
    page_id: str,
    psid: str,
    _user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rows = list(db.scalars(
        select(FacebookMessage)
        .where(FacebookMessage.page_id == page_id, FacebookMessage.psid == psid)
        .order_by(FacebookMessage.created_at.asc(), FacebookMessage.id.asc())
        .limit(1000)
    ))
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hội thoại Facebook")
    name = next((row.sender_name.strip() for row in rows if row.sender_name.strip()), "")
    return {
        "pageId": page_id,
        "psid": psid,
        "name": name or f"Facebook · {psid[-6:]}",
        "items": [{
            "id": row.id,
            "direction": row.direction,
            "text": row.text,
            "status": row.status,
            "error": row.error,
            "createdAt": row.created_at.isoformat(),
            "queueLatencyMs": row.queue_latency_ms,
            "latencyMs": row.latency_ms,
            "hermesLatencyMs": row.hermes_latency_ms,
            "contextLatencyMs": row.context_latency_ms,
            "sendLatencyMs": row.send_latency_ms,
        } for row in rows],
    }


def _public_lead_out(row: TrainingPublicSession, *, reveal: bool = False) -> dict:
    phone = crypto.decrypt(row.phone_ciphertext) if reveal else f"••••••{row.phone_last4}"
    queries = sorted(row.queries, key=lambda item: item.created_at, reverse=True)
    return {
        "id": row.id,
        "phone": phone,
        "phoneLast4": row.phone_last4,
        "locale": row.locale,
        "status": row.status,
        "note": row.note,
        "createdAt": row.created_at.isoformat(),
        "lastSeenAt": row.last_seen_at.isoformat(),
        "questionCount": len(queries),
        "lastQuestion": queries[0].question if queries else "",
    }


def _public_query_answer(value: object, settings: Settings) -> dict:
    """Flatten answer envelopes written by both old and current Hermes jobs."""
    answer = value if isinstance(value, dict) else {}
    for _ in range(2):
        nested = answer.get("answer")
        if not isinstance(nested, dict):
            break
        answer = nested
    return public_training.sanitize_public_result(answer, settings)


def _public_query_out(row: TrainingPublicQuery, settings: Settings) -> dict:
    try:
        answer = json.loads(row.answer_json or "{}")
    except ValueError:
        answer = {}
    return {
        "jobId": row.job_id,
        "question": row.question,
        "status": row.status,
        "stage": row.stage,
        "answer": _public_query_answer(answer, settings),
        "createdAt": row.created_at.isoformat(),
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
        "durationMs": row.duration_ms,
    }


@app.get("/api/training/public-leads")
def training_public_leads(
    limit: int = 50,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    limit = max(1, min(limit, 200))
    rows = list(db.scalars(select(TrainingPublicSession).order_by(TrainingPublicSession.created_at.desc()).limit(limit)))
    _audit(db, user, "training_public_leads_list", str(len(rows)))
    return {"items": [_public_lead_out(row) for row in rows]}


@app.get("/api/training/public-leads/{session_id}")
def training_public_lead_detail(
    session_id: int,
    reveal: bool = False,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    row = db.get(TrainingPublicSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    if reveal:
        _audit(db, user, "training_public_phone_reveal", str(session_id), "reveal phone")
    queries = list(db.scalars(select(TrainingPublicQuery).where(
        TrainingPublicQuery.session_id == row.id,
    ).order_by(TrainingPublicQuery.created_at.desc()).limit(200)))
    return {
        **_public_lead_out(row, reveal=reveal),
        "queries": [_public_query_out(query, settings) for query in queries],
    }


@app.patch("/api/training/public-leads/{session_id}")
def training_public_lead_update(
    session_id: int,
    body: dict = Body(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(TrainingPublicSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    allowed_statuses = {"new", "in_progress", "qualified", "closed", "spam"}
    if "status" in body:
        candidate = str(body.get("status", ""))
        if candidate not in allowed_statuses:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Trạng thái lead không hợp lệ")
        row.status = candidate
    if "note" in body:
        note = str(body.get("note", "")).strip()
        if len(note) > 1000:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ghi chú quá dài")
        row.note = note
    db.commit()
    _audit(db, user, "training_public_lead_update", str(session_id), row.status)
    return _public_lead_out(row)


@app.delete("/api/training/public-leads/{session_id}")
def training_public_lead_delete(
    session_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(TrainingPublicSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    db.execute(delete(TrainingPublicQuery).where(TrainingPublicQuery.session_id == session_id))
    db.delete(row)
    db.commit()
    _audit(db, user, "training_public_lead_delete", str(session_id))
    return {"ok": True}


@app.post("/api/training/share")
def training_share_create(
    body: dict = Body(...),
    user: CurrentUser = Depends(require_training),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    question = str(body.get("question", "")).strip()
    answer = body.get("answer")
    try:
        days = int(body.get("days") or settings.training_share_days)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thoi han chia se khong hop le") from exc
    if not question or len(question) > 2000 or not isinstance(answer, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Noi dung chia se khong hop le")
    answer_json = json.dumps(answer, ensure_ascii=False)
    if len(answer_json.encode("utf-8")) > 250_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Cau tra loi qua lon de chia se")
    days = max(1, min(days, 365))
    token = secrets.token_urlsafe(18)
    expires = datetime.utcnow() + timedelta(days=days)
    db.add(TrainingShare(
        token=token, question=question,
        answer_json=answer_json,
        created_by=user.id, expires_at=expires,
    ))
    db.commit()
    _audit(db, user, "training_share", question[:120], f"{days} ngay")
    return {
        "url": f"{settings.public_base_url.rstrip('/')}/t/{token}",
        "expires_at": expires.isoformat(),
    }


@app.get("/t/{token}", response_class=HTMLResponse)
def training_share_page(token: str, db: Session = Depends(get_session)):
    share = db.scalar(select(TrainingShare).where(TrainingShare.token == token))
    if not share:
        return HTMLResponse("<h1>Link không tồn tại</h1>", status_code=404)
    if datetime.utcnow() > share.expires_at:
        return HTMLResponse("<h1>Link đã hết hạn</h1>", status_code=410)
    try:
        answer = json.loads(share.answer_json)
    except ValueError:
        answer = {}
    evidence = []
    for item in list(answer.get("documentationEvidence") or []) + list(answer.get("videoEvidence") or []):
        if not isinstance(item, dict):
            continue
        raw_url = str(item.get("url", ""))
        parsed = urlsplit(raw_url)
        if parsed.scheme not in {"http", "https"}:
            continue
        title = html.escape(str(item.get("title", "Nguồn")))
        url = html.escape(raw_url, quote=True)
        quote_text = html.escape(str(item.get("quote", "")))
        evidence.append(f'<li><a href="{url}" target="_blank" rel="noopener">{title}</a><p>{quote_text}</p></li>')
    question = html.escape(share.question)
    answer_text = html.escape(str(answer.get("answer", "")))
    guidance = html.escape(str(answer.get("generalGuidance", "")))
    sources = "".join(evidence) or "<li>Không có nguồn đính kèm</li>"
    page = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iNut Training</title><style>body{{font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;color:#172033}}main{{background:#f4f8f6;padding:28px;border-radius:18px}}h1{{color:#0c6b58}}blockquote{{border-left:4px solid #ef9f31;padding-left:16px}}li{{margin:14px 0}}a{{color:#075ea8}}small{{color:#667085}}</style></head><body><main><small>iNut Training · chia sẻ bởi KSP</small><h1>{question}</h1><blockquote>{answer_text}</blockquote><h2>Hướng dẫn bổ sung</h2><p>{guidance}</p><h2>Nguồn kiểm chứng</h2><ul>{sources}</ul><small>Link hết hạn: {share.expires_at.strftime('%d/%m/%Y')}</small></main></body></html>"""
    return HTMLResponse(page)


@app.post("/api/documents/{doc_pk}/share", response_model=ShareResponse)
def create_share(
    doc_pk: int,
    body: ShareRequest,
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    require_full_portal(user)
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if not user.is_admin and d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Khong co quyen")
    if body.days is not None and body.days > 365:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Thời hạn chia sẻ tối đa 365 ngày",
        )
    days = body.days if body.days and body.days > 0 else settings.share_default_days
    token = secrets.token_urlsafe(16)
    expires = datetime.utcnow() + timedelta(days=days)
    db.add(Share(token=token, document_id=d.id, expires_at=expires))
    db.commit()
    _audit(db, user, "share", d.filename, f"{days} ngày")

    account = None
    if body.include_account and d.customer_id:
        c = db.get(Customer, d.customer_id)
        if c:
            uname, pwd = accounts.ensure_account(db, c)
            account = AccountInfo(username=uname, password=pwd)

    return ShareResponse(
        token=token, url=_share_url(settings, token), filename=d.filename,
        expires_at=expires.isoformat(), account=account,
    )


@app.get("/api/share/{token}")
def share_meta(token: str, db: Session = Depends(get_session)):
    s = db.scalar(select(Share).where(Share.token == token))
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link khong ton tai")
    return {
        "filename": s.document.filename,
        "expires_at": s.expires_at.isoformat(),
        "expired": datetime.utcnow() > s.expires_at,
    }


def _share_file(token: str, db: Session, inline: bool):
    s = db.scalar(select(Share).where(Share.token == token))
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link khong ton tai")
    if datetime.utcnow() > s.expires_at:
        raise HTTPException(status.HTTP_410_GONE, "Link da het han")
    d = s.document
    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    fpath, suffix = found
    media_map = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".xml": "application/xml",
        ".zip": "application/zip",
        ".md": "text/markdown; charset=utf-8",
        ".markdown": "text/markdown; charset=utf-8",
        ".mp4": "video/mp4",
    }
    media_type = media_map.get(suffix.lower(), "application/octet-stream")
    if inline and suffix.lower() in (".pdf", ".mp4"):
        # Xem truc tiep trong trinh duyet
        disp = f"inline; filename*=UTF-8''{quote(d.filename)}"
    else:
        disp = _content_disposition(d.filename)
    if suffix.lower() == ".mp4":
        return FileResponse(
            fpath,
            media_type="video/mp4",
            headers={
                "Content-Disposition": disp,
                "Accept-Ranges": "bytes",
                "X-Accel-Buffering": "no",
            },
        )
    return StreamingResponse(
        iter([fpath.read_bytes()]),
        media_type=media_type,
        headers={"Content-Disposition": disp},
    )


@app.get("/api/share/{token}/download")
def share_download(token: str, request: Request, db: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    s = db.scalar(select(Share).where(Share.token == token))
    if s and not (datetime.utcnow() > s.expires_at):
        doc_tracking.record_server_side_view(
            db, settings, document_id=s.document_id, action="download",
            request_headers=dict(request.headers), source=f"share_{token}",
        )
    return _share_file(token, db, inline=False)


@app.get("/api/share/{token}/view")
def share_view(
    token: str,
    request: Request,
    format: str = "",
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    # Fallback server-side view (khi iframe load truc tiep, JS telemetry co the da ban roi)
    s = db.scalar(select(Share).where(Share.token == token))
    if s and not (datetime.utcnow() > s.expires_at):
        doc_tracking.record_server_side_view(
            db, settings, document_id=s.document_id, action="view",
            request_headers=dict(request.headers), source=f"share_{token}",
        )
    if s and not (datetime.utcnow() > s.expires_at):
        found = storage.find_doc_path(s.document.doc_id)
        if found:
            fpath, suffix = found
            csp_nonce = getattr(request.state, "csp_nonce", "")
            if suffix.lower() == ".docx" or s.document.filename.lower().endswith(".docx"):
                raw = fpath.read_bytes()
                if docx_preview.is_valid_docx(raw):
                    if format.lower() == "pdf":
                        pdf_bytes = docx_preview.render_docx_to_pdf_bytes(raw, title=s.document.filename)
                        pdf_name = Path(s.document.filename).stem + ".pdf"
                        return Response(
                            content=pdf_bytes,
                            media_type="application/pdf",
                            headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
                        )
                    html_out = docx_preview.render_docx_preview_html(
                        raw,
                        title=s.document.filename,
                        download_url=f"/api/share/{quote(token, safe='')}/download",
                        pdf_url=f"/api/share/{quote(token, safe='')}/view?format=pdf",
                    )
                    return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
            if suffix.lower() in (".md", ".markdown") or s.document.filename.lower().endswith((".md", ".markdown")):
                raw = fpath.read_bytes()
                if markdown_preview.is_valid_markdown(raw, s.document.filename):
                    if format.lower() == "pdf":
                        pdf_bytes = markdown_preview.render_markdown_to_pdf_bytes(raw, title=s.document.filename)
                        pdf_name = Path(s.document.filename).stem + ".pdf"
                        return Response(
                            content=pdf_bytes,
                            media_type="application/pdf",
                            headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
                        )
                    html_out = markdown_preview.render_markdown_preview_html(
                        raw,
                        title=s.document.filename,
                        download_url=f"/api/share/{quote(token, safe='')}/download",
                        pdf_url=f"/api/share/{quote(token, safe='')}/view?format=pdf",
                        csp_nonce=csp_nonce,
                    )
                    return HTMLResponse(content=html_out)
            if suffix.lower() in (".xlsx", ".xls") or s.document.filename.lower().endswith((".xlsx", ".xls")):
                raw = fpath.read_bytes()
                if xlsx_preview.is_valid_xlsx(raw):
                    if format.lower() == "pdf":
                        pdf_bytes = xlsx_preview.render_xlsx_to_pdf_bytes(raw, title=s.document.filename)
                        pdf_name = Path(s.document.filename).stem + ".pdf"
                        return Response(
                            content=pdf_bytes,
                            media_type="application/pdf",
                            headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
                        )
                    html_out = xlsx_preview.render_xlsx_preview_html(
                        raw,
                        title=s.document.filename,
                        download_url=f"/api/share/{quote(token, safe='')}/download",
                        pdf_url=f"/api/share/{quote(token, safe='')}/view?format=pdf",
                    )
                    return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
    return _share_file(token, db, inline=True)


_SHARE_NEAC_RATE_LOCK = threading.Lock()
_SHARE_NEAC_RATE_BUCKETS: dict[str, list[float]] = {}
_SHARE_NEAC_RATE_LIMIT = 5
_SHARE_NEAC_RATE_WINDOW = 60.0


def _check_share_neac_rate_limit(key: str) -> None:
    now = time.monotonic()
    with _SHARE_NEAC_RATE_LOCK:
        hits = [t for t in _SHARE_NEAC_RATE_BUCKETS.get(key, []) if now - t < _SHARE_NEAC_RATE_WINDOW]
        if len(hits) >= _SHARE_NEAC_RATE_LIMIT:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Quá nhiều lượt yêu cầu thẩm định NEAC — vui lòng thử lại sau 1 phút",
            )
        hits.append(now)
        _SHARE_NEAC_RATE_BUCKETS[key] = hits


@app.get("/api/share/{token}/verify-neac")
def share_verify_neac(
    token: str,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    client_ip = request.client.host if request.client else ""
    _check_share_neac_rate_limit(f"{client_ip}:{token}")
    s = db.scalar(select(Share).where(Share.token == token))
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link khong ton tai")
    if datetime.utcnow() > s.expires_at:
        raise HTTPException(status.HTTP_410_GONE, "Link da het han")
    d = s.document
    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    pdf_bytes = found[0].read_bytes()
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chi ho tro tham dinh chu ky so NEAC tren file PDF")
    internal_check = verify.verify_document(settings, pdf_bytes, d.doc_id)
    internal_sigs = [sig.model_dump() for sig in internal_check.signatures]

    neac_res = None
    try:
        import httpx
        files = {"file": (d.filename or "document.pdf", pdf_bytes, "application/pdf")}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://neac.gov.vn/vi",
            "X-Requested-With": "XMLHttpRequest",
        }
        with httpx.Client(timeout=45.0) as client:
            r = client.post("https://neac.gov.vn/vi/Home/VerifyFileByNeac", files=files, headers=headers)
            if r.status_code == 200:
                neac_res = r.json()
    except Exception:
        pass

    return {
        "ok": True,
        "doc_label": d.filename,
        "internal_verification": {
            "valid": bool(
                internal_sigs
                and all(
                    sig.get("valid") and sig.get("intact") and sig.get("trusted")
                    for sig in internal_sigs
                )
            ),
            "signatures": internal_sigs,
        },
        "neac_result": neac_res,
        "verified_at": datetime.now(timezone(timedelta(hours=7))).strftime("%H:%M:%S %d/%m/%Y"),
        "neac_portal_url": "https://neac.gov.vn/vi",
    }

@app.get("/s/{token}", response_class=HTMLResponse)
def share_page(token: str, request: Request, db: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    csp_nonce = getattr(request.state, "csp_nonce", "")
    s = db.scalar(select(Share).where(Share.token == token))
    if not s:
        return HTMLResponse(_share_html("Link không tồn tại", None, None, csp_nonce=csp_nonce), status_code=404)
    expired = datetime.utcnow() > s.expires_at
    exp = s.expires_at.strftime("%d/%m/%Y %H:%M")
    if expired:
        return HTMLResponse(
            _share_html(f"Link đã hết hạn (từ {exp})", s.document.filename, None, csp_nonce=csp_nonce), status_code=410
        )
    nonce = doc_tracking.generate_nonce(
        settings,
        share_token=token,
        document_id=s.document_id,
        user_agent=request.headers.get("user-agent", ""),
    )
    return HTMLResponse(
        _share_html(
            None, s.document.filename, token, exp,
            nonce=nonce, document_id=s.document_id, csp_nonce=csp_nonce,
        )
    )


def _share_html(
    error: str | None,
    filename: str | None,
    token: str | None,
    exp: str = "",
    *,
    nonce: str = "",
    document_id: int = 0,
    csp_nonce: str = "",
) -> str:
    raw_filename = filename or ""
    is_docx = raw_filename.lower().endswith(".docx")
    is_md = raw_filename.lower().endswith((".md", ".markdown"))
    is_xlsx = raw_filename.lower().endswith((".xlsx", ".xls"))
    is_mp4 = raw_filename.lower().endswith(".mp4")
    error = html.escape(error or "", quote=True) if error else None
    filename = html.escape(filename or "", quote=True) if filename else None
    token = quote(token or "", safe="") if token else None
    exp = html.escape(exp, quote=True)
    nonce_attr = f' nonce="{html.escape(csp_nonce, quote=True)}"' if csp_nonce else ""
    if error:
        inner = (
            f'<main style="flex:1;display:flex;"><div class="card"><div class="brand">🖊️ KSP PDF Signer</div>'
            f'<h1>Chia sẻ tài liệu</h1><p class="err">{error}</p></div></main>'
        )
        preview = ""
    elif is_docx:
        inner = (
            f'<header><div class="bar">'
            f'<div class="brand">🖊️ KSP · <h1 class="fn">📝 {filename}</h1></div>'
            f'<div class="acts">'
            f'<a class="btn neac" href="/api/share/{token}/view?format=pdf" target="_blank">📑 Bản in PDF</a>'
            f'<a class="btn ghost" href="/api/share/{token}/view" target="_blank">🔍 Xem toàn màn hình</a>'
            f'<a class="btn" href="/api/share/{token}/download">⬇️ Tải file Word (.docx)</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp} · Bản xem trước trực tuyến tài liệu Microsoft Word (.docx) chuẩn khổ A4</div></header>'
        )
        preview = f'<main aria-label="Khung xem trước tài liệu" style="flex:1;display:flex;flex-direction:column;"><iframe class="pdf" src="/api/share/{token}/view" title="{filename}"></iframe></main>'
    elif is_md:
        inner = (
            f'<header><div class="bar">'
            f'<div class="brand">🖊️ KSP · <h1 class="fn">📘 {filename}</h1></div>'
            f'<div class="acts">'
            f'<a class="btn neac" href="/api/share/{token}/view?format=pdf" target="_blank">📑 Bản in PDF</a>'
            f'<a class="btn ghost" href="/api/share/{token}/view" target="_blank">🔍 Xem toàn màn hình</a>'
            f'<a class="btn" href="/api/share/{token}/download">⬇️ Tải file Markdown (.md)</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp} · Bản xem trước trực tuyến tài liệu kỹ thuật Markdown (.md)</div></header>'
        )
        preview = f'<main aria-label="Khung xem trước tài liệu" style="flex:1;display:flex;flex-direction:column;"><iframe class="pdf" src="/api/share/{token}/view" title="{filename}"></iframe></main>'
    elif is_xlsx:
        inner = (
            f'<header><div class="bar">'
            f'<div class="brand">🖊️ KSP · <h1 class="fn">📊 {filename}</h1></div>'
            f'<div class="acts">'
            f'<a class="btn neac" href="/api/share/{token}/view?format=pdf" target="_blank">📑 Bản in PDF</a>'
            f'<a class="btn ghost" href="/api/share/{token}/view" target="_blank">🔍 Xem toàn màn hình</a>'
            f'<a class="btn" href="/api/share/{token}/download">⬇️ Tải file Excel (.xlsx)</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp} · Bản xem trước trực tuyến bảng tính Microsoft Excel (.xlsx) chuẩn chỉ</div></header>'
        )
        preview = f'<main aria-label="Khung xem trước tài liệu" style="flex:1;display:flex;flex-direction:column;"><iframe class="pdf" src="/api/share/{token}/view" title="{filename}"></iframe></main>'
    elif is_mp4:
        inner = (
            f'<header><div class="bar">'
            f'<div class="brand">🎬 KSP · <h1 class="fn">{filename}</h1></div>'
            f'<div class="acts">'
            f'<a class="btn" id="kspVideoDlBtn" href="/api/share/{token}/download" download="{filename}">⬇️ Tải video MP4</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp} · Video MP4 chuẩn iPhone / Safari / QuickTime</div></header>'
        )
        preview = (
            f'<main aria-label="Trình phát video" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;background:#09111f;">'
            f'<video controls playsinline webkit-playsinline preload="metadata" src="/api/share/{token}/view" '
            f'style="width:100%;max-width:1180px;max-height:76vh;border-radius:12px;background:#000;box-shadow:0 12px 36px rgba(0,0,0,.55);"></video>'
            f'<div id="kspDlProg" style="display:none;margin-top:14px;width:100%;max-width:520px;background:#0f1d33;border:1px solid rgba(115,230,243,.45);border-radius:10px;padding:10px 14px;color:#e2f6fa;font-size:13px;">'
            f'<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px;"><span id="kspDlText">Đang tải...</span><span id="kspDlPct">0%</span></div>'
            f'<div style="height:7px;background:rgba(148,163,184,.25);border-radius:999px;overflow:hidden;"><div id="kspDlBar" style="height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#34d399);transition:width .12s linear;"></div></div>'
            f'</div>'
            f'<script{nonce_attr}>(function(){{var a=document.getElementById("kspVideoDlBtn");var box=document.getElementById("kspDlProg");var txt=document.getElementById("kspDlText");var pctEl=document.getElementById("kspDlPct");var bar=document.getElementById("kspDlBar");var isIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);if(!a||isIOS||typeof ReadableStream==="undefined")return;a.addEventListener("click",function(ev){{if(a.dataset.busy==="1"){{ev.preventDefault();return;}}ev.preventDefault();a.dataset.busy="1";box.style.display="block";txt.textContent="Đang kết nối tải video...";pctEl.textContent="0%";bar.style.width="0%";fetch(a.href).then(function(r){{if(!r.ok)throw new Error("HTTP "+r.status);var tot=parseInt(r.headers.get("content-length")||"0",10);var rdr=r.body&&r.body.getReader?r.body.getReader():null;if(!rdr)return r.blob();var chunks=[],got=0,t0=Date.now();return new Promise(function(res,rej){{function pump(){{rdr.read().then(function(s){{if(s.done){{res(new Blob(chunks,{{type:"video/mp4"}}));return;}}chunks.push(s.value);got+=s.value.byteLength;var mb=(got/1048576).toFixed(1);var spd=(got/1048576)/Math.max(0.2,(Date.now()-t0)/1000);if(tot>0){{var p=Math.min(100,Math.round(got*100/tot));pctEl.textContent=p+"%";bar.style.width=p+"%";txt.textContent="Đang tải "+mb+" / "+(tot/1048576).toFixed(1)+" MB ("+spd.toFixed(1)+" MB/s)";}}else{{txt.textContent="Đang tải "+mb+" MB ("+spd.toFixed(1)+" MB/s)";}}pump();}}).catch(rej);}}pump();}});}}).then(function(blob){{pctEl.textContent="100%";bar.style.width="100%";txt.textContent="✓ Đã tải xong ("+(blob.size/1048576).toFixed(1)+" MB) — đang lưu vào máy...";var u=URL.createObjectURL(blob);var tmp=document.createElement("a");tmp.href=u;tmp.download=a.getAttribute("download")||"video.mp4";document.body.appendChild(tmp);tmp.click();setTimeout(function(){{tmp.remove();URL.revokeObjectURL(u);a.dataset.busy="0";}},1500);}}).catch(function(){{a.dataset.busy="0";box.style.display="none";window.location.href=a.href;}});}});}})();</script>'
            f'</main>'
        )
    else:
        inner = (
            f'<header><div class="bar">'
            f'<div class="brand">🖊️ KSP · <h1 class="fn">📄 {filename}</h1></div>'
            f'<div class="acts">'
            f'<button type="button" id="neacVerifyBtn" class="btn neac">🏛️ Thẩm định chữ ký số NEAC</button>'
            f'<a class="btn ghost" href="/api/share/{token}/view" target="_blank">🔍 Xem toàn màn hình</a>'
            f'<a class="btn" href="/api/share/{token}/download">⬇️ Tải xuống</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp} · Chữ ký số pháp nhân hợp chuẩn Quốc gia NEAC (Bộ TTTT)</div></header>'
        )
        preview = f'<main aria-label="Khung xem trước tài liệu" style="flex:1;display:flex;flex-direction:column;"><iframe class="pdf" src="/api/share/{token}/view" title="{filename}"></iframe></main>'
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.png"><title>Xem / Tải tài liệu — KSP</title>
<style>
*{{box-sizing:border-box}}
body{{font-family:system-ui,'Segoe UI',Roboto,sans-serif;background:#eef1f4;margin:0;
color:#1c2530;min-height:100vh;display:flex;flex-direction:column}}
.bar{{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
background:#fff;border-bottom:1px solid #d9dee5;padding:12px 18px}}
.brand{{color:#1e6fd9;font-weight:700}}.fn{{color:#1c2530;font-weight:600;font-size:1rem;margin:0;display:inline}}
.acts{{display:flex;gap:8px;flex-wrap:wrap}}
.btn{{display:inline-block;background:#1857aa;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:.9rem;border:none;cursor:pointer;font-weight:600}}
.btn:hover{{background:#13468a}}
.btn.neac{{background:#047857;color:#fff}}
.btn.neac:hover{{background:#065f46}}
.btn.ghost{{background:#fff;color:#1857aa;border:1px solid #1857aa}}
.btn.ghost:hover{{background:#eef4fd}}
.exp{{background:#fff6e0;color:#785500;font-size:.8rem;padding:5px 18px;border-bottom:1px solid #f0dca0}}
.pdf{{flex:1;width:100%;border:0;min-height:70vh}}
.card{{background:#fff;border:1px solid #d9dee5;border-radius:14px;padding:34px 40px;
text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:420px;margin:auto}}
h1{{font-size:1.2rem;margin:0 0 6px}}.err{{color:#b91c1c}}
.thanks{{text-align:center;padding:12px 18px;font-size:.85rem;color:#4b5563;
background:#fff;border-top:1px solid #e6eaef}}
.thanks a{{color:#1857aa;text-decoration:underline;font-weight:600}}
</style></head><body>{inner}{preview}
<div id="neacModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,0.7);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px;">
  <div style="background:#fff;width:100%;max-width:500px;border-radius:16px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.25);max-height:90vh;overflow-y:auto;border:1px solid #e2e8f0;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:22px;">🏛️</span>
        <div>
          <div style="font-size:14px;font-weight:800;color:#0f172a;text-transform:uppercase;">Thẩm định Chữ ký số NEAC</div>
          <div style="font-size:11px;color:#64748b;">Trung tâm Chứng thực điện tử quốc gia (Bộ TTTT)</div>
        </div>
      </div>
      <button type="button" data-neac-close="1" style="background:#f1f5f9;border:none;border-radius:50%;width:28px;height:28px;font-size:14px;cursor:pointer;font-weight:bold;color:#64748b;">✕</button>
    </div>
    <div id="neacModalBody" style="font-size:12.5px;line-height:1.55;color:#334155;"></div>
  </div>
</div>
<script{nonce_attr}>
(function() {{
  const modal = document.getElementById("neacModal");
  const body = document.getElementById("neacModalBody");
  function closeModal() {{
    if (modal) modal.style.display = "none";
  }}
  function el(tag, css, text) {{
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }}
  function makeRow(label, value, valueCss) {{
    const row = el("div", "display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed #e2e8f0;padding-bottom:5px;");
    row.appendChild(el("span", "color:#64748b;", label));
    row.appendChild(el("span", valueCss || "color:#0f172a;font-weight:600;text-align:right;max-width:65%;word-break:break-word;", value));
    return row;
  }}
  async function checkShareNeac() {{
    if (!modal || !body) return;
    modal.style.display = "flex";
    body.replaceChildren();
    const loading = el("div", "text-align:center;padding:24px 0;color:#64748b;");
    loading.appendChild(el("div", "font-size:32px;margin-bottom:8px;", "⏳"));
    loading.appendChild(el("div", "font-weight:700;color:#0f172a;font-size:13.5px;", "Đang thẩm định chữ ký số PAdES & Cổng Quốc gia NEAC..."));
    loading.appendChild(el("div", "font-size:11.5px;margin-top:4px;", "Kiểm tra toàn vẹn tài liệu, chuỗi chứng thư CA & trạng thái thu hồi CRL/OCSP"));
    body.appendChild(loading);
    try {{
      const res = await fetch("/api/share/{token}/verify-neac");
      if (!res.ok) {{
        const errData = await res.json().catch(function() {{ return {{}}; }});
        throw new Error(errData.detail || ("HTTP " + res.status));
      }}
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Không thể thẩm định");
      const neac = data.neac_result || {{}};
      const sigList = (neac.signature && neac.signature.data) ? neac.signature.data : [];
      const firstSig = sigList[0] || {{}};
      const iv = data.internal_verification || {{}};
      const intSigs = Array.isArray(iv.signatures) ? iv.signatures : [];
      const intSig = intSigs[0] || null;

      const hasSig = Boolean(intSig);
      const isCryptValid = Boolean(hasSig && intSig.valid && intSig.intact && intSig.trusted && iv.valid);
      const isRevoked = Boolean(hasSig && intSig.revocation_ok === false);
      const hasWarning = Boolean(
        hasSig && (intSig.revocation_ok === null || intSig.revocation_ok === undefined || (Array.isArray(intSig.problems) && intSig.problems.length > 0))
      );

      let bannerBg = "#fef2f2", bannerBorder = "#fecaca", bannerIcon = "✕", bannerColor = "#991b1b";
      let bannerTitle = "CHỮ KÝ SỐ KHÔNG HỢP LỆ";
      if (!hasSig) {{
        bannerTitle = "TÀI LIỆU CHƯA ĐƯỢC KÝ SỐ HOẶC KHÔNG CÓ CHỮ KÝ";
      }} else if (isRevoked) {{
        bannerTitle = "CHỨNG THƯ SỐ ĐÃ BỊ THU HỒI";
      }} else if (!isCryptValid) {{
        bannerTitle = (intSig.intact && intSig.valid && !intSig.trusted)
          ? "CHỮ KÝ KHÔNG THUỘC CA TIN CẬY"
          : "CHỮ KÝ SỐ KHÔNG HỢP LỆ / TÀI LIỆU ĐÃ BỊ THAY ĐỔI";
      }} else if (hasWarning) {{
        bannerBg = "#fffbeb"; bannerBorder = "#fde68a"; bannerIcon = "⚠"; bannerColor = "#92400e";
        bannerTitle = intSig.summary || "HỢP LỆ (CÓ CẢNH BÁO)";
      }} else {{
        bannerBg = "#ecfdf5"; bannerBorder = "#a7f3d0"; bannerIcon = "✓"; bannerColor = "#065f46";
        bannerTitle = "CHỮ KÝ SỐ HỢP LỆ & TOÀN VẸN";
      }}

      const signerName = (firstSig.signer && firstSig.signer.cn) || (intSig && intSig.signer_name) || "Không xác định";
      const issuerName = (firstSig.issuer && firstSig.issuer.cn)
        ? (firstSig.issuer.cn + (firstSig.issuer.o ? (" (" + firstSig.issuer.o + ")") : ""))
        : ((intSig && intSig.certificate_issuer) || "Không xác định");
      const signedTime = firstSig.signedTime || (intSig && intSig.signing_time) || "Không xác định";
      let ocspStatus = firstSig.ocsp || "";
      if (!ocspStatus) {{
        if (!hasSig) ocspStatus = "Không có chữ ký";
        else if (intSig.revocation_ok === true) ocspStatus = "Chứng thư số hợp lệ, chưa bị thu hồi";
        else if (intSig.revocation_ok === false) ocspStatus = "Chứng thư số đã bị thu hồi";
        else ocspStatus = "Chưa kiểm tra được OCSP/CRL (ngoại tuyến)";
      }}
      const intactText = !hasSig
        ? "Không có chữ ký số"
        : (intSig.intact ? "Toàn vẹn dữ liệu (không thay đổi sau khi ký)" : "KHÔNG toàn vẹn — tài liệu đã bị chỉnh sửa");

      body.replaceChildren();
      const banner = el("div", "padding:12px;background:" + bannerBg + ";border:1px solid " + bannerBorder + ";border-radius:10px;margin-bottom:12px;text-align:center;");
      banner.appendChild(el("div", "font-size:18px;color:" + bannerColor + ";margin-bottom:2px;", bannerIcon));
      banner.appendChild(el("div", "font-weight:800;font-size:13.5px;color:" + bannerColor + ";", bannerTitle));
      const docLine = el("div", "font-size:11px;color:" + bannerColor + ";margin-top:2px;");
      docLine.appendChild(document.createTextNode("Tài liệu: "));
      docLine.appendChild(el("b", "", data.doc_label || ""));
      banner.appendChild(docLine);
      body.appendChild(banner);

      const rows = el("div", "display:flex;flex-direction:column;gap:8px;font-size:12px;");
      rows.appendChild(makeRow("Chủ thể ký:", signerName, "color:#0f172a;font-weight:700;text-align:right;max-width:65%;word-break:break-word;"));
      rows.appendChild(makeRow("Tổ chức cấp CA:", issuerName, "color:#0284c7;font-weight:700;text-align:right;max-width:65%;word-break:break-word;"));
      rows.appendChild(makeRow("Tình trạng dữ liệu:", intactText, "color:" + (hasSig && intSig.intact ? "#16a34a" : "#b91c1c") + ";font-weight:700;text-align:right;max-width:65%;"));
      rows.appendChild(makeRow("Thời điểm ký số:", signedTime));
      rows.appendChild(makeRow("Trạng thái OCSP/CRL:", ocspStatus, "color:" + (isRevoked ? "#b91c1c" : (hasSig && intSig.revocation_ok === true ? "#059669" : "#92400e")) + ";font-weight:600;text-align:right;max-width:65%;"));
      body.appendChild(rows);

      if (hasSig && Array.isArray(intSig.problems) && intSig.problems.length > 0) {{
        const warnBox = el("div", "margin-top:10px;padding:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:11.5px;color:#9a3412;");
        warnBox.appendChild(el("div", "font-weight:700;margin-bottom:4px;", "Chi tiết cảnh báo:"));
        const ul = el("ul", "margin:0;padding-left:18px;");
        intSig.problems.forEach(function(p) {{ ul.appendChild(el("li", "", p)); }});
        warnBox.appendChild(ul);
        body.appendChild(warnBox);
      }}

      const srcBox = el("div", "margin-top:14px;padding:10px;background:#f8fafc;border-radius:8px;font-size:11px;color:#475569;line-height:1.45;");
      srcBox.appendChild(document.createTextNode("🏛️ Nguồn thẩm định: pyHanko (VN Root CA Trust Store) & Cổng NEAC ("));
      const link = el("a", "color:#0284c7;font-weight:700;", "https://neac.gov.vn/vi");
      link.href = "https://neac.gov.vn/vi";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      srcBox.appendChild(link);
      srcBox.appendChild(document.createTextNode(")."));
      body.appendChild(srcBox);

      const closeBtn = el("button", "width:100%;margin-top:12px;padding:9px;background:#0f172a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;", "Đóng");
      closeBtn.type = "button";
      closeBtn.addEventListener("click", closeModal);
      body.appendChild(closeBtn);
    }} catch (err) {{
      body.replaceChildren();
      body.appendChild(el("div", "padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;text-align:center;color:#991b1b;", "⚠️ " + (err && err.message ? err.message : "Không thể thẩm định")));
    }}
  }}
  const verifyBtn = document.getElementById("neacVerifyBtn");
  if (verifyBtn) verifyBtn.addEventListener("click", checkShareNeac);
  document.querySelectorAll("[data-neac-close]").forEach(function(btn) {{
    btn.addEventListener("click", closeModal);
  }});
}})();
</script>
{_telemetry_js(token, nonce, document_id, csp_nonce=csp_nonce) if token and nonce else ""}
<footer class="thanks">💙 Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của
<a href="https://inut.vn" target="_blank" rel="noopener noreferrer">INUT</a></footer>
</body></html>"""


def _telemetry_js(token: str | None, nonce: str, document_id: int, *, csp_nonce: str = "") -> str:
    """Client-side telemetry: GeoIP via ipwho.is/Cloudflare + fingerprint + POST to /api/doc-telemetry."""
    if not token or not nonce:
        return ""
    safe_token = html.escape(token, quote=True)
    safe_nonce = html.escape(nonce, quote=True)
    nonce_attr = f' nonce="{html.escape(csp_nonce, quote=True)}"' if csp_nonce else ""
    return f"""<script{nonce_attr}>
(function(){{
  var _sent = false;
  function fp(){{
    try{{
      var s = screen.width+"x"+screen.height+"|"+navigator.language+"|"+Intl.DateTimeFormat().resolvedOptions().timeZone+"|"+navigator.platform;
      var h = 0; for(var i=0;i<s.length;i++){{ h = ((h<<5)-h)+s.charCodeAt(i); h |= 0; }}
      return (h>>>0).toString(16);
    }}catch(e){{ return "0"; }}
  }}
  function device(){{
    return /mobile|android|iphone|ipad/i.test(navigator.userAgent) ? "mobile" : "desktop";
  }}
  function send(action, geo){{
    if(_sent && action==="view") return;
    if(action==="view") _sent = true;
    var body = {{
      nonce: "{safe_nonce}",
      share_token: "{safe_token}",
      document_id: {document_id},
      action: action,
      fingerprint_hash: fp(),
      device_type: device(),
      ip: (geo && geo.ip) || "",
      city: (geo && (geo.city || "")) || "",
      region: (geo && (geo.region || "")) || "",
      isp: (geo && (geo.org || geo.isp || "")) || "",
      country_code: (geo && (geo.country_code || geo.country || "")) || ""
    }};
    fetch("/api/doc-telemetry", {{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(body)}}).catch(function(){{}});
  }}
  function go(geo){{
    send("view", geo);
    // Hook download/NEAC clicks
    document.addEventListener("click", function(e){{
      var a = e.target.closest && e.target.closest("a[href],button");
      if(!a) return;
      var href = a.getAttribute("href") || "";
      var txt = a.textContent || "";
      if(href.indexOf("/download") > -1) send("download", geo);
      else if(txt.indexOf("NEAC") > -1) send("neac", geo);
    }});
  }}
  // GeoIP chain: ipwho.is -> Cloudflare trace -> fallback empty
  fetch("https://ipwho.is/",{{mode:"cors"}}).then(function(r){{return r.json()}}).then(function(d){{
    go({{ip:d.ip,city:d.city,region:d.region,isp:d.connection&&d.connection.isp||"",country_code:d.country_code}});
  }}).catch(function(){{
    fetch("https://1.1.1.1/cdn-cgi/trace").then(function(r){{return r.text()}}).then(function(t){{
      var m={{}}; t.split("\\n").forEach(function(l){{ var p=l.split("="); if(p.length===2) m[p[0]]=p[1]; }});
      go({{ip:m.ip||"",city:"",region:"",isp:"",country_code:m.loc||""}});
    }}).catch(function(){{ go({{}}); }});
  }});
}})();
</script>"""

# ---------------------------------------------------------------------------
# Theo doi luot xem ho so (Doc Tracking & Telemetry)
# ---------------------------------------------------------------------------
class _TelemetryPayload(BaseModel):
    nonce: str
    share_token: str = ""
    document_id: int = 0
    action: str = "view"
    fingerprint_hash: str = ""
    device_type: str = ""
    ip: str = ""
    city: str = ""
    region: str = ""
    isp: str = ""
    country_code: str = ""


@app.post("/api/doc-telemetry")
def doc_telemetry(
    body: _TelemetryPayload,
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Nhan telemetry tu browser (GeoIP + fingerprint + nonce)."""
    if body.action not in ("view", "download", "neac"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Action khong hop le")
    if not doc_tracking.verify_nonce(
        settings,
        body.nonce,
        share_token=body.share_token,
        document_id=body.document_id,
        user_agent=request.headers.get("user-agent", ""),
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nonce khong hop le hoac het han")

    import hashlib as _hl
    ua_hash = _hl.sha256(request.headers.get("user-agent", "").encode()).hexdigest()[:16]
    server_ip = (
        (request.headers.get("x-real-ip", "").strip())
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
        or (request.client.host if request.client else "")
    )
    ip = body.ip or server_ip

    view = doc_tracking.record_view(
        db, settings,
        document_id=body.document_id,
        action=body.action,
        ip=ip,
        rate_limit_ip=server_ip or "unknown",
        city=body.city,
        region=body.region,
        isp=body.isp,
        country_code=body.country_code,
        device_type=body.device_type,
        user_agent_hash=ua_hash,
        fingerprint_hash=body.fingerprint_hash,
        source=f"share_{body.share_token}" if body.share_token else "direct",
        nonce=body.nonce,
    )
    return {"ok": True, "view_id": view.id}


class _TrackingUpdate(BaseModel):
    enabled: bool = True
    note: str = ""
    milestone_date: str = ""
    expires_days: int | None = None  # None = khong het han, so ngay tinh tu bay gio


@app.get("/api/documents/{doc_pk}/tracking")
def get_tracking(
    doc_pk: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    t = db.scalar(select(DocumentTracking).where(DocumentTracking.document_id == doc_pk))
    if not t:
        return {"enabled": False, "note": "", "milestone_date": "", "expires_at": None, "document_id": doc_pk}
    return {
        "enabled": t.enabled,
        "note": t.note,
        "milestone_date": t.milestone_date,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "document_id": t.document_id,
    }


@app.put("/api/documents/{doc_pk}/tracking")
def set_tracking(
    doc_pk: int,
    body: _TrackingUpdate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    t = db.scalar(select(DocumentTracking).where(DocumentTracking.document_id == doc_pk))
    if not t:
        t = DocumentTracking(document_id=doc_pk)
        db.add(t)
    t.enabled = body.enabled
    t.note = body.note[:500]
    t.milestone_date = body.milestone_date[:20]
    if body.expires_days is not None and body.expires_days > 0:
        t.expires_at = datetime.utcnow() + timedelta(days=body.expires_days)
    elif body.expires_days == 0:
        t.expires_at = None  # khong het han
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    _audit(db, user, "doc_tracking", d.filename, f"{'bật' if t.enabled else 'tắt'} cờ theo dõi")
    return {
        "enabled": t.enabled,
        "note": t.note,
        "milestone_date": t.milestone_date,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "document_id": t.document_id,
    }


@app.get("/api/doc-views")
def list_tracked_docs(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Dashboard: danh sach ho so dang/da bat co theo doi + so lieu tong hop."""
    rows = db.scalars(
        select(DocumentTracking).order_by(DocumentTracking.updated_at.desc())
    ).all()
    result = []
    for t in rows:
        doc = t.document
        total_views = db.scalar(
            select(func.count(DocumentView.id)).where(DocumentView.document_id == t.document_id)
        ) or 0
        downloads = db.scalar(
            select(func.count(DocumentView.id)).where(
                DocumentView.document_id == t.document_id, DocumentView.action == "download"
            )
        ) or 0
        neac_checks = db.scalar(
            select(func.count(DocumentView.id)).where(
                DocumentView.document_id == t.document_id, DocumentView.action == "neac"
            )
        ) or 0
        last_view = db.scalar(
            select(DocumentView.created_at).where(
                DocumentView.document_id == t.document_id
            ).order_by(DocumentView.created_at.desc())
        )
        result.append({
            "document_id": t.document_id,
            "filename": doc.filename if doc else "",
            "customer_name": doc.customer.name if doc and doc.customer else "",
            "enabled": t.enabled,
            "note": t.note,
            "milestone_date": t.milestone_date,
            "expires_at": t.expires_at.isoformat() if t.expires_at else None,
            "total_views": total_views,
            "downloads": downloads,
            "neac_checks": neac_checks,
            "last_view_at": last_view.isoformat() if last_view else None,
        })
    return result


@app.get("/api/doc-views/{doc_pk}")
def doc_view_detail(
    doc_pk: int,
    page: int = 1,
    per_page: int = 50,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Chi tiet lich su luot xem cua 1 ho so."""
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    page = max(1, page)
    per_page = min(max(1, per_page), 200)
    total = db.scalar(
        select(func.count(DocumentView.id)).where(DocumentView.document_id == doc_pk)
    ) or 0
    views = db.scalars(
        select(DocumentView)
        .where(DocumentView.document_id == doc_pk)
        .order_by(DocumentView.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    ).all()
    return {
        "document_id": doc_pk,
        "filename": d.filename,
        "total": total,
        "page": page,
        "per_page": per_page,
        "views": [
            {
                "id": v.id,
                "action": v.action,
                "ip": v.ip,
                "city": v.city,
                "region": v.region,
                "isp": v.isp,
                "country_code": v.country_code,
                "device_type": v.device_type,
                "source": v.source,
                "notified": v.notified,
                "created_at": v.created_at.isoformat() if v.created_at else "",
            }
            for v in views
        ],
    }


# ---------------------------------------------------------------------------
# Radar Cong van Chinh phu, UBND Tinh Dak Lak & Thue co so 7 (Tuy Hoa)
# ---------------------------------------------------------------------------

class GovVerifyIn(BaseModel):
    query: str


class GovAckIn(BaseModel):
    acknowledged: bool = True

@app.get("/api/gov-radar")
def list_gov_radar(
    portal: str = "",
    category: str = "",
    q: str = "",
    applies_only: bool = False,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Danh sach cong van Chinh phu / UBND Tinh Dak Lak / Thue CS7 (tu dong quet lan dau neu trong)."""
    total_all = db.scalar(select(func.count(GovDocument.id))) or 0
    if total_all == 0:
        try:
            gov_radar.sync_gov_documents(db, settings, notify_telegram=False)
            total_all = db.scalar(select(func.count(GovDocument.id))) or 0
        except Exception as exc:
            logger.warning("Auto-sync gov_radar lan dau that bai: %s", exc)

    stmt = select(GovDocument)
    if portal:
        stmt = stmt.where(GovDocument.source_portal == portal)
    if category:
        stmt = stmt.where(GovDocument.category == category)
    if applies_only:
        stmt = stmt.where(GovDocument.applies_to_inut.is_(True))
    if q.strip():
        kw = f"%{q.strip()}%"
        stmt = stmt.where(
            (GovDocument.doc_number.ilike(kw))
            | (GovDocument.title.ilike(kw))
            | (GovDocument.matched_keywords.ilike(kw))
            | (GovDocument.source_label.ilike(kw))
        )
    rows = db.scalars(
        stmt.order_by(GovDocument.relevance_score.desc(), GovDocument.id.desc()).limit(200)
    ).all()

    return {
        "sources": gov_radar.PORTAL_SOURCES,
        "schedule": gov_radar.get_scheduler_status(db),
        "total": total_all,
        "items": [
            {
                "id": r.id,
                "source_key": r.source_key,
                "source_portal": r.source_portal,
                "source_label": r.source_label,
                "doc_number": r.doc_number,
                "doc_type": r.doc_type,
                "published_date": r.published_date,
                "title": r.title,
                "detail_url": r.detail_url,
                "pdf_url": r.pdf_url,
                "category": r.category,
                "relevance_score": r.relevance_score,
                "applies_to_inut": r.applies_to_inut,
                "impact_summary": r.impact_summary,
                "matched_keywords": r.matched_keywords,
                "notified": r.notified,
                "notify_count": r.notify_count,
                "first_notified_at": r.first_notified_at.isoformat() if r.first_notified_at else "",
                "last_notified_at": r.last_notified_at.isoformat() if r.last_notified_at else "",
                "acknowledged": r.acknowledged,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ],
    }


@app.post("/api/gov-radar/sync")
def sync_gov_radar(
    notify: bool = True,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Chu dong quet ngay cac cong van moi tu daklak.gov.vn, daklak.gdt.gov.vn, yte.daklak.gov.vn."""
    res = gov_radar.sync_gov_documents(db, settings, notify_telegram=notify)
    _audit(db, user, "gov_radar_sync", "gov_documents", f"added={res.get('added')}, total={res.get('total')}")
    return res


@app.post("/api/gov-radar/verify")
def verify_gov_doc(
    body: GovVerifyIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Kiem chung 1 so hieu cong van / tin don MXH xem co ap dung cho INUT (Dak Lak) khong."""
    return gov_radar.verify_document_query(db, body.query)


@app.put("/api/gov-radar/{doc_id}/ack")
def ack_gov_doc(
    doc_id: int,
    body: GovAckIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Danh dau da xem / tat nhac lai 3 ngay cho 1 cong van."""
    res = gov_radar.acknowledge_gov_doc(db, doc_id, body.acknowledged)
    if not res:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay cong van")
    return res

# ---------------------------------------------------------------------------
# Doi mat khau
# ---------------------------------------------------------------------------
@app.post("/api/me/password")
def change_my_password(
    body: PasswordChange,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
):
    """Nguoi dung tu doi mat khau cua chinh minh (can mat khau cu)."""
    u = db.get(User, user.id)
    if not u or not verify_password(body.old_password, u.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mat khau cu khong dung")
    if len(body.new_password) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mat khau moi phai co it nhat 10 ky tu")
    u.password_hash = hash_password(body.new_password)
    u.session_version += 1
    u.must_change_password = False
    db.commit()
    _audit(db, user, "password_change", user.username)
    return {"ok": True}


@app.get("/api/users", response_model=list[UserOut])
def list_users(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    out = []
    for u in db.scalars(select(User).order_by(User.role, User.username)):
        out.append(UserOut(
            id=u.id, username=u.username, role=u.role, customer_id=u.customer_id,
            customer_name=u.customer.name if u.customer else None,
            training_access=u.role == "admin" or bool(u.training_access),
        ))
    return out


@app.patch("/api/users/{uid}/training-access")
def set_user_training_access(
    uid: int, body: dict = Body(...),
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    target = db.get(User, uid)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay user")
    if target.role == "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin luon co quyen Training")
    target.training_access = bool(body.get("enabled"))
    db.commit()
    _audit(db, user, "training_access", target.username, "bat" if target.training_access else "tat")
    return {"ok": True, "training_access": target.training_access}


@app.post("/api/users/{uid}/password")
def admin_reset_password(
    uid: int, body: PasswordReset,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    """Admin doi mat khau cho bat ky user nao."""
    u = db.get(User, uid)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay user")
    if len(body.new_password) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mat khau phai co it nhat 10 ky tu")
    u.password_hash = hash_password(body.new_password)
    u.session_version += 1
    u.must_change_password = True
    db.commit()
    _audit(db, user, "password_reset", u.username)
    return {"ok": True, "username": u.username}


# ---------------------------------------------------------------------------
# Nhat ky thao tac (audit)
# ---------------------------------------------------------------------------
def _parse_iso_utc(s: str) -> datetime | None:
    """ISO datetime (co the co 'Z'/offset) -> naive UTC de so voi AuditLog.ts."""
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@app.get("/api/audit", response_model=AuditPage)
def audit_log(
    search: str = "",
    action: str = "",
    ts_from: str = "",
    ts_to: str = "",
    page: int = 1,
    per_page: int = 50,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    page = max(1, page)
    per_page = min(max(1, per_page), 200)
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    if ts_from and (dt := _parse_iso_utc(ts_from)):
        q = q.where(AuditLog.ts >= dt)
    if ts_to and (dt := _parse_iso_utc(ts_to)):
        q = q.where(AuditLog.ts <= dt)
    if search.strip():
        like = f"%{search.strip()}%"
        q = q.where(
            AuditLog.username.ilike(like)
            | AuditLog.target.ilike(like)
            | AuditLog.detail.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(
        q.order_by(AuditLog.ts.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    items = [
        AuditOut(
            id=r.id, ts=r.ts.isoformat(), username=r.username, role=r.role, ip=r.ip,
            action=r.action, action_label=audit.ACTION_LABELS.get(r.action, r.action),
            target=r.target, detail=r.detail,
        )
        for r in rows
    ]
    return AuditPage(items=items, total=total, page=page, per_page=per_page)


# ---------------------------------------------------------------------------
# Hoa don -> BBBG + phan loai
# ---------------------------------------------------------------------------
def _suggest_customer(db: Session, buyer: dict) -> dict | None:
    """De xuat khach hang khop hoa don theo MST (uu tien) roi ten/alias."""
    c = accounts.find_customer(db, buyer.get("name") or "", buyer.get("mst") or "")
    if c:
        return {"id": c.id, "name": c.name}
    return None


@app.post("/api/invoice/parse")
async def invoice_parse(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    content = await storage.read_upload_limited(file, max_bytes=25 * 1024 * 1024)
    head = content.lstrip()[:64]
    try:
        if content[:4] == b"%PDF":
            data = invoice.parse_invoice(content)
        elif head[:5] == b"<?xml" or head[:5] == b"<HDon" or b"<HDon" in content[:400]:
            data = invoice.parse_invoice_xml(content)
        else:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "File phai la hoa don PDF hoac XML")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Không đọc được hóa đơn", e, "ksp.invoice"),
        )
    data["suggested_customer"] = _suggest_customer(db, data.get("buyer") or {})
    # Ghi nho hang hoa co don gia vao danh muc (autofill bao gia sau nay)
    data["products_learned"] = _upsert_products(
        db, [it for it in data.get("items") or [] if it.get("don_gia")]
    )
    return data


@app.get("/api/bbbg/templates")
def bbbg_templates(user: CurrentUser = Depends(require_admin)):
    return {"templates": bbbg.list_templates()}


def _upsert_customer(db: Session, benb) -> int | None:
    """Tao/cap nhat ho so khach hang tu thong tin ben B (tu XML/form).

    Merge profile theo XML; KHONG dong toi tai khoan/mat khau. Match theo
    MST roi ten roi alias (find_customer); chi tao moi khi ca 3 deu truot.
    """
    mst = (benb.mst or "").strip()
    name = (benb.name or "").strip()
    c = accounts.find_customer(db, name, mst)
    if c is None:
        if not name:
            return None
        c = Customer(name=name, tax_code=mst, note="Tạo từ hóa đơn")
        db.add(c)
        db.flush()
    else:
        # Cap nhat profile theo XML (khong tao/doi tai khoan)
        if name:
            c.name = name
        if mst and not c.tax_code:
            c.tax_code = mst
    if benb.address:
        c.address = benb.address
    if benb.email:
        c.email = benb.email
    if benb.dien_thoai and not c.contact:
        c.contact = benb.dien_thoai
    db.commit()
    return c.id


@app.post("/api/bbbg/generate")
def bbbg_generate(
    body: BBBGGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    try:
        pdf = bbbg.render_bbbg(settings, body.model_dump())
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh BBBG thất bại", e, "ksp.bbbg"),
        )
    doc_id = storage.save_upload(pdf)
    customer_id = _upsert_customer(db, body.ben_b)
    _audit(db, user, "bbbg_generate", body.filename, body.ben_b.name)
    return {"doc_id": doc_id, "filename": body.filename, "customer_id": customer_id}


@app.get("/api/factory-certificate/templates")
def factory_certificate_templates(user: CurrentUser = Depends(require_admin)):
    return {"templates": bbbg.list_factory_certificate_templates()}


@app.post("/api/factory-certificate/preview")
def factory_certificate_preview(
    body: FactoryCertificateGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    try:
        pdf = bbbg.render_factory_certificate(settings, body.model_dump())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh giấy xuất xưởng thất bại", e, "ksp.bbbg"),
        )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/api/factory-certificate/generate")
def factory_certificate_generate(
    body: FactoryCertificateGenerate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    if not body.ben_b.name.strip() or not body.ben_b.mst.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bên nhận phải có tên và mã số thuế")
    try:
        pdf = bbbg.render_factory_certificate(settings, body.model_dump())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh giấy xuất xưởng thất bại", e, "ksp.bbbg"),
        )

    doc_id = storage.save_upload(pdf)
    customer_id = _upsert_customer(db, body.ben_b)
    if customer_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Không thể tạo hồ sơ khách hàng")

    note = "Giấy chứng nhận xuất xưởng"
    if body.ma_thiet_bi:
        note += f" · mã thiết bị {body.ma_thiet_bi}"
    if body.reference_quote:
        note += f" · căn cứ báo giá {body.reference_quote}"
    doc = Document(
        doc_id=doc_id,
        filename=body.filename,
        signed=False,
        customer_id=customer_id,
        doc_type="xuat_xuong",
        note=note,
    )
    db.add(doc)
    db.flush()
    share_token = secrets.token_urlsafe(16)
    share_expires = datetime.utcnow() + timedelta(days=settings.share_default_days)
    db.add(Share(token=share_token, document_id=doc.id, expires_at=share_expires))
    db.commit()
    db.refresh(doc)
    _audit(db, user, "factory_certificate_generate", body.filename, body.ben_b.name)
    background.add_task(_bg_nas_sync, doc.id)
    return {
        "doc_id": doc_id,
        "document_id": doc.id,
        "filename": body.filename,
        "customer_id": customer_id,
        "doc_type": "xuat_xuong",
        "share_url": _share_url(settings, share_token),
        "share_expires_at": share_expires.isoformat(),
    }


@app.post("/api/invoice/parse-doc/{doc_pk}")
def invoice_parse_stored(
    doc_pk: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Doc hoa don tu ho so co san (nguon 'tu ho so' cua tab Bao gia)."""
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    if not storage.exists(d.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    try:
        data = invoice.parse_invoice(storage.read_doc(d.doc_id))
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Không đọc được hóa đơn", e, "ksp.invoice"),
        )
    data["suggested_customer"] = (
        {"id": d.customer_id, "name": d.customer.name}
        if d.customer
        else _suggest_customer(db, data.get("buyer") or {})
    )
    data["products_learned"] = _upsert_products(
        db, [it for it in data.get("items") or [] if it.get("don_gia")]
    )
    return data


# ---------------------------------------------------------------------------
# Bao gia / De nghi thanh toan + thuyet minh AI
# ---------------------------------------------------------------------------
@app.get("/api/quote/templates")
def quote_templates(user: CurrentUser = Depends(require_admin)):
    return {"templates": bbbg.list_quote_templates()}


@app.post("/api/quote/preview")
def quote_preview(
    body: QuoteGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Render PDF xem truoc (WYSIWYG) — khong luu storage, khong upsert KH/audit."""
    try:
        pdf, _ = bbbg.render_quote(settings, body.model_dump())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh PDF báo giá thất bại", e, "ksp.quote"),
        )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/api/quote/generate")
def quote_generate(
    body: QuoteGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    if not body.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chua co dong hang hoa nao")
    try:
        pdf, totals = bbbg.render_quote(settings, body.model_dump())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh PDF báo giá thất bại", e, "ksp.quote"),
        )
    doc_id = storage.save_upload(pdf)
    customer_id = _upsert_customer(db, body.ben_b)
    _upsert_products(db, [it.model_dump() for it in body.items])  # hoc danh muc
    doc_type = bbbg.QUOTE_TEMPLATES.get(body.template_key, {}).get("doc_type", "bao_gia")
    label = "đề nghị TT" if body.template_key == "de_nghi_tt" else "báo giá"
    _audit(
        db, user, "quote_generate", body.filename,
        f"{label} · {body.ben_b.name} · {money.vnd(totals['tong_thanh_toan'])}đ",
    )
    return {
        "doc_id": doc_id,
        "filename": body.filename,
        "customer_id": customer_id,
        "doc_type": doc_type,
        "totals": totals,
    }


# ---------------------------------------------------------------------------
# Bao gia Billiards (iNut BilliardLive - Camera & Check VAR)
# ---------------------------------------------------------------------------
@app.get("/api/billiard/quote/estimate")
def billiard_estimate(
    tables: int = Query(10, ge=1, le=100),
    include_camera: bool = Query(True),
    include_software: bool = Query(True),
    agency: str = Query("inut"),
    client_name: str = Query(""),
    user: CurrentUser = Depends(require_admin),
):
    """Tính nhanh khối lượng và giá dự toán cho quán Bida theo số bàn."""
    from .billiard_pricing import build_billiard_quote_data
    data = build_billiard_quote_data(
        num_tables=tables,
        client_name=client_name,
        agency=agency,
        include_camera=include_camera,
        include_software=include_software,
    )
    return {"ok": True, "data": data}


@app.post("/api/billiard/quote/preview")
def billiard_quote_preview(
    body: BilliardQuotePayload,
    user: CurrentUser = Depends(require_admin),
):
    """Sinh PDF xem trước báo giá Billiards (không lưu, không ký số)."""
    from weasyprint import HTML
    from .billiard_pricing import build_billiard_quote_data
    data = build_billiard_quote_data(
        num_tables=body.num_tables,
        client_name=body.client_name,
        contact_person=body.contact_person,
        phone=body.phone,
        address=body.address,
        agency=body.agency,
        include_camera=body.include_camera,
        include_software=body.include_software,
        stream_boxes_count=body.stream_boxes_count,
        date_display=body.date_display or datetime.now().strftime("%d/%m/%Y"),
    )
    tmpl = bbbg._env.get_template("bao_gia_billiard.html")
    html_out = tmpl.render(**data)
    pdf = HTML(string=html_out, url_fetcher=security_utils.safe_weasyprint_url_fetcher).write_pdf()
    return Response(content=pdf, media_type="application/pdf")


@app.post("/api/billiard/quote/generate")
def billiard_quote_generate(
    body: BilliardQuotePayload,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Sinh PDF báo giá Billiards hoàn chỉnh gửi khách (không ký số)."""
    from weasyprint import HTML
    from .billiard_pricing import build_billiard_quote_data
    data = build_billiard_quote_data(
        num_tables=body.num_tables,
        client_name=body.client_name,
        contact_person=body.contact_person,
        phone=body.phone,
        address=body.address,
        agency=body.agency,
        include_camera=body.include_camera,
        include_software=body.include_software,
        date_display=body.date_display or datetime.now().strftime("%d/%m/%Y"),
    )
    tmpl = bbbg._env.get_template("bao_gia_billiard.html")
    html_out = tmpl.render(**data)
    pdf = HTML(string=html_out, url_fetcher=security_utils.safe_weasyprint_url_fetcher).write_pdf()
    doc_id = storage.save_upload(pdf, suffix=".pdf")

    c_name = body.client_name.strip() or f"Billiards {body.num_tables} bàn"
    if body.include_camera and body.include_software:
        mode_code = "-FULL"
        mode_label = "Camera + Billiard Live"
    elif body.include_software and not body.include_camera:
        mode_code = "-PM"
        mode_label = "Chỉ Phần mềm Billiard Live (Đã có Cam)"
    else:
        mode_code = "-CAM"
        mode_label = "Chỉ Camera - Không phần mềm"
    safe_code = f"BG-BIDA-{body.num_tables}BAN{mode_code}"
    filename = body.filename.strip() or f"Bao_gia_{safe_code}.pdf"
    doc = Document(
        doc_id=doc_id,
        filename=filename,
        signer_name="iNut Technology",
        signed=False,
        doc_type="bao_gia",
        note=f"Báo giá Billiards {body.num_tables} bàn ({mode_label}) · {money.vnd(data['grand_total'])}đ · Chưa VAT 8%",
        source_system="billiard_quote",
        source_external_id=safe_code,
    )
    db.add(doc)
    db.commit()

    _audit(
        db, user, "billiard_quote_generate", filename,
        f"Báo giá Bida {body.num_tables} bàn · {c_name} · {money.vnd(data['grand_total'])}đ",
    )

    return {
        "ok": True,
        "doc_id": doc_id,
        "id": doc.id,
        "filename": filename,
        "pdf_url": f"/api/documents/{doc.id}/view",
        "download_url": f"/api/documents/{doc.id}/download",
        "data": data,
    }


# ---------------------------------------------------------------------------
# Hop dong phan mem + chia se cho khach hang
# ---------------------------------------------------------------------------
_CONTRACT_REQUIRED = (
    "10.000.000", "3.000.000", "50%", "60 ngày", "12 tháng",
    "mã nguồn", "phụ lục", "không chịu thuế GTGT",
)


def _validate_contract_terms(text: str) -> None:
    missing = [x for x in _CONTRACT_REQUIRED if x.lower() not in text.lower()]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Điều khoản thiếu nội dung bắt buộc: " + ", ".join(missing),
        )


@app.get("/api/contract/defaults")
def contract_defaults(
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    return {
        "ben_a": bbbg.default_ben_a(settings),
        "dieu_khoan": bbbg.BAOTOAN_CONTRACT_TERMS_REV2,
        "bank": {
            "account_name": settings.bank_account_name,
            "account_number": settings.bank_account_number,
            "bank_name": settings.bank_name,
        },
        "baotoan": {
            "name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN",
            "mst": "0314360282",
            "address": "3/16A Đường 18B, Khu phố 65, Phường Bình Hưng Hòa, Thành phố Hồ Chí Minh, Việt Nam",
            "email": "baotoan.ceo@gmail.com",
        },
    }


def _contract_draft_out(row: ContractDraft) -> dict:
    try:
        payload = json.loads(row.payload)
    except (TypeError, ValueError):
        payload = {}
    return {
        "id": row.id,
        "customer_id": row.customer_id,
        "customer_name": row.customer.name if row.customer else "",
        "title": row.title,
        "version": row.version,
        "status": row.status,
        "document_id": row.document_id,
        "finalized_at": row.finalized_at.isoformat() if row.finalized_at else None,
        "payload": payload,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


@app.get("/api/contract/drafts")
def contract_drafts(
    customer_id: int | None = None,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    q = select(ContractDraft).order_by(ContractDraft.updated_at.desc())
    if customer_id is not None:
        q = q.where(ContractDraft.customer_id == customer_id)
    return [_contract_draft_out(row) for row in db.scalars(q)]


@app.post("/api/contract/drafts")
def contract_draft_create(
    body: ContractDraftSave,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    customer = db.get(Customer, body.customer_id)
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
    title = body.title.strip() or body.payload.so.strip() or "Hợp đồng chưa đặt tên"
    latest_version = db.scalar(select(func.max(ContractDraft.version)).where(
        ContractDraft.customer_id == customer.id)) or 0
    row = ContractDraft(
        customer_id=customer.id, title=title,
        payload=json.dumps(body.payload.model_dump(), ensure_ascii=False),
        version=latest_version + 1,
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, user, "contract_draft_create", title, customer.name)
    return _contract_draft_out(row)


@app.put("/api/contract/drafts/{draft_id}")
def contract_draft_update(
    draft_id: int,
    body: ContractDraftSave,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(ContractDraft, draft_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy bản hợp đồng đang soạn")
    if row.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Phiên hợp đồng đã chốt nên không thể ghi đè")
    customer = db.get(Customer, body.customer_id)
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
    row.customer_id = customer.id
    row.title = body.title.strip() or body.payload.so.strip() or "Hợp đồng chưa đặt tên"
    row.payload = json.dumps(body.payload.model_dump(), ensure_ascii=False)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    _audit(db, user, "contract_draft_update", row.title, customer.name)
    return _contract_draft_out(row)


@app.delete("/api/contract/drafts/{draft_id}")
def contract_draft_delete(
    draft_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    row = db.get(ContractDraft, draft_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy bản hợp đồng đang soạn")
    if row.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Phiên hợp đồng đã chốt phải được giữ lại để đối chiếu")
    title = row.title
    db.delete(row)
    db.commit()
    _audit(db, user, "contract_draft_delete", title)
    return {"ok": True}


@app.post("/api/contract/preview")
def contract_preview(
    body: ContractGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    terms = body.dieu_khoan or bbbg.DEFAULT_CONTRACT_TERMS
    _validate_contract_terms(terms)
    try:
        pdf = bbbg.render_contract(settings, body.model_dump())
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh hợp đồng thất bại", e, "ksp.contract"),
        )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/api/contract/generate")
def contract_generate(
    body: ContractGenerate,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    if not body.ben_b.name.strip() or not body.ben_b.mst.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bên B phải có tên và mã số thuế")
    draft = None
    if body.draft_id is not None:
        draft = db.get(ContractDraft, body.draft_id)
        if not draft:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy phiên hợp đồng đang soạn")
        if draft.status != "draft":
            raise HTTPException(status.HTTP_409_CONFLICT, "Phiên hợp đồng này đã được chốt")
        draft_mst = re.sub(r"\D", "", draft.customer.tax_code if draft.customer else "")
        body_mst = re.sub(r"\D", "", body.ben_b.mst)
        if draft_mst and draft_mst != body_mst:
            raise HTTPException(status.HTTP_409_CONFLICT, "Khách hàng của phiên soạn không khớp Bên B")
    terms = body.dieu_khoan or bbbg.DEFAULT_CONTRACT_TERMS
    _validate_contract_terms(terms)
    try:
        pdf = bbbg.render_contract(settings, body.model_dump())
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Sinh hợp đồng thất bại", e, "ksp.contract"),
        )

    doc_id = storage.save_upload(pdf)
    customer_id = _upsert_customer(db, body.ben_b)
    if customer_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Không thể tạo hồ sơ khách hàng")
    customer = db.get(Customer, customer_id)
    mst_norm = re.sub(r"\D", "", body.ben_b.mst)
    for inv in db.scalars(
        select(IhoadonInvoice).where(IhoadonInvoice.buyer_tax_code_norm == mst_norm)
    ):
        inv.customer_id = customer_id
        inv.match_source = "auto"

    doc = Document(
        doc_id=doc_id, filename=body.filename, signed=False,
        customer_id=customer_id, doc_type="hop_dong",
        note="Bản nháp" if not body.ben_b.dai_dien.strip() else "Sẵn sàng ký",
    )
    db.add(doc)
    db.flush()

    session_finalized = False
    session_version = None
    if draft and body.ben_b.dai_dien.strip():
        draft.payload = json.dumps(body.model_dump(exclude={"draft_id"}), ensure_ascii=False)
        draft.status = "finalized"
        draft.document_id = doc.id
        draft.finalized_at = datetime.now(timezone.utc)
        draft.updated_at = draft.finalized_at
        session_finalized = True
        session_version = draft.version

    share_token = secrets.token_urlsafe(16)
    share_expires = datetime.utcnow() + timedelta(days=settings.share_default_days)
    db.add(Share(token=share_token, document_id=doc.id, expires_at=share_expires))
    username, password = accounts.ensure_account(db, customer)
    account = db.scalar(select(User).where(User.customer_id == customer_id).order_by(User.id))
    login_token = secrets.token_urlsafe(32)
    login_expires = datetime.utcnow() + timedelta(days=7)
    for old in db.scalars(select(LoginLink).where(LoginLink.user_id == account.id)):
        old.revoked = True
    db.add(LoginLink(token=login_token, user_id=account.id, expires_at=login_expires))
    db.commit()
    _audit(db, user, "contract_generate", body.filename, f"{body.ben_b.name} · MST {mst_norm}")
    return {
        "doc_id": doc_id,
        "document_id": doc.id,
        "filename": body.filename,
        "customer_id": customer_id,
        "doc_type": "hop_dong",
        "is_draft": not bool(body.ben_b.dai_dien.strip()),
        "session_finalized": session_finalized,
        "session_version": session_version,
        "share_url": _share_url(settings, share_token),
        "share_expires_at": share_expires.isoformat(),
        "login_url": f"{settings.public_base_url.rstrip('/')}/api/login-link/{login_token}",
        "login_expires_at": login_expires.isoformat(),
        "username": username,
        "temporary_password": password,
    }


@app.post("/api/ai/contract-draft")
def ai_contract_draft(
    body: ContractAIRequest,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    current = body.dieu_khoan_hien_tai.strip() or bbbg.DEFAULT_CONTRACT_TERMS
    prompt = (
        "Hãy rà soát và chỉnh câu chữ dự thảo hợp đồng cung cấp/vận hành phần mềm theo pháp luật "
        "Việt Nam. Giữ nguyên 9 điều, mọi số tiền, thuế, tiến độ, thời hạn, quyền sở hữu mã nguồn, "
        "cơ chế tính năng miễn phí theo lộ trình INUT và tính năng riêng phải ký phụ lục. Không thêm "
        "cam kết uptime tuyệt đối hay cam kết Apple/Google duyệt app. Chỉ trả lại toàn văn điều khoản, "
        "không markdown, không lời dẫn.\n\n"
        f"Bên B: {body.ben_b_name}\nYêu cầu thêm: {body.yeu_cau or 'Chỉnh rõ ràng, cân bằng và chặt chẽ.'}"
        f"\n\nDự thảo hiện tại:\n{current}"
    )
    try:
        text = ai.chat(
            settings,
            [{"role": "system", "content": "Bạn là trợ lý soạn thảo hợp đồng thương mại Việt Nam."},
             {"role": "user", "content": prompt}],
            temperature=0.2,
        )
    except ai.AINotConfigured as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except ai.AIError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi kết nối dịch vụ AI", e, "ksp.ai"),
        )
    _validate_contract_terms(text)
    _audit(db, user, "ai_contract", body.ben_b_name, f"model={settings.ai_model}")
    return {"text": text}


def _upsert_products(db: Session, items: list[dict]) -> int:
    """Hoc danh muc hang hoa (tu bao gia vua sinh HOAC hoa don vua parse).

    Match theo ten (khong phan biet hoa/thuong); gia/DVT/thue lay theo lan moi nhat.
    """
    n = 0
    for it in items:
        ten = (it.get("ten") or "").strip()
        if not ten:
            continue
        dg = money.parse_num(it.get("don_gia"))
        p = db.scalar(select(Product).where(func.lower(Product.ten) == ten.lower()))
        if p is None:
            p = Product(ten=ten, thue_suat=10.0)
            db.add(p)
        if it.get("dvt"):
            p.dvt = it["dvt"]
        if dg:
            p.don_gia = dg
        ts = it.get("thue_suat")
        if ts is not None and str(ts).strip() != "":
            p.thue_suat = money.parse_num(ts)  # "KCT" -> 0
        p.use_count = (p.use_count or 0) + 1
        p.updated_at = datetime.utcnow()
        n += 1
    db.commit()
    return n


@app.get("/api/products", response_model=list[ProductOut])
def list_products(
    search: str = "",
    limit: int = 200,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Danh muc hang hoa da dung — cho autofill form bao gia."""
    q = select(Product)
    if search.strip():
        q = q.where(Product.ten.ilike(f"%{search.strip()}%"))
    q = q.order_by(Product.use_count.desc(), Product.ten).limit(min(max(1, limit), 500))
    return [
        ProductOut(
            id=p.id, ten=p.ten, dvt=p.dvt, don_gia=p.don_gia,
            thue_suat=p.thue_suat, use_count=p.use_count,
        )
        for p in db.scalars(q)
    ]


@app.delete("/api/products/{pid}")
def delete_product(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    p = db.get(Product, pid)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay mat hang")
    db.delete(p)
    db.commit()
    return {"ok": True}


@app.get("/api/ai/status")
def ai_status(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)):
    return {"enabled": settings.ai_enabled, "model": settings.ai_model}


@app.post("/api/ai/quote-narrative")
def ai_quote_narrative(
    body: QuoteNarrativeRequest,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    try:
        text = ai.quote_narrative(
            settings,
            items=[it.model_dump() for it in body.items],
            khach=body.khach,
            tong=body.tong,
            note=body.note,
            loai=body.loai,
        )
    except ai.AINotConfigured as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except ai.AIError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi kết nối dịch vụ AI", e, "ksp.ai"),
        )
    _audit(db, user, "ai_narrative", body.khach, f"model={settings.ai_model}")
    return {"text": text}


@app.post("/api/documents/{doc_pk}/type", response_model=DocumentOut)
def set_doc_type(
    doc_pk: int, body: DocTypeUpdate,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    d.doc_type = body.doc_type
    db.commit()
    db.refresh(d)
    _audit(db, user, "set_type", d.filename, body.doc_type)
    return _doc_out(d)


# ---------------------------------------------------------------------------
# Dong bo NAS (SMB)
# ---------------------------------------------------------------------------
@app.get("/api/nas/status")
def nas_status(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings), db: Session = Depends(get_session)):
    total = db.scalar(select(func.count(Document.id))) or 0
    synced = db.scalar(
        select(func.count(Document.id)).where(Document.nas_synced_at.is_not(None))
    ) or 0
    return {
        "enabled": settings.nas_enabled,
        "host": settings.nas_host,
        "share": settings.nas_share,
        "base_path": settings.nas_base_path,
        "total": total,
        "synced": synced,
        "pending": total - synced,
        "last_error": nas.last_error(),
    }


@app.post("/api/nas/test")
def nas_test(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)):
    ok, msg = nas.test_connection(settings)
    return {"ok": ok, "message": msg}


@app.get("/api/nas/disk")
def nas_disk(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)):
    """Dung luong share NAS (GB): tong / da dung / con trong / % da dung."""
    try:
        return {"ok": True, **nas.disk_usage(settings)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------------------
# Cau hinh dong (AI + NAS) — sua tu web, luu DB (app_settings), khong can restart
# ---------------------------------------------------------------------------
@app.get("/api/settings")
def get_app_settings(
    user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)
):
    """Tra cau hinh AI/NAS hien tai. Secret (api_key/password) chi bao DA-DAT hay chua."""
    return {
        "ai_enabled": settings.ai_enabled,
        "ai_base_url": settings.ai_base_url,
        "ai_api_key_set": bool(settings.ai_api_key and settings.ai_api_key != "public"),
        "ai_model": settings.ai_model,
        "ai_max_tokens": settings.ai_max_tokens,
        "ai_timeout": settings.ai_timeout,
        "training_rate_limit_per_minute": settings.training_rate_limit_per_minute,
        "training_rate_window_seconds": settings.training_rate_window_seconds,
        "public_training_rate_limit": settings.public_training_rate_limit,
        "public_training_rate_window_seconds": settings.public_training_rate_window_seconds,
        "nas_enabled": settings.nas_enabled,
        "nas_host": settings.nas_host,
        "nas_share": settings.nas_share,
        "nas_user": settings.nas_user,
        "nas_password_set": bool(settings.nas_password),
        "nas_base_path": settings.nas_base_path,
        "nas_timeout": settings.nas_timeout,
        "ihoadon_enabled": settings.ihoadon_enabled,
        "ihoadon_base_url": settings.ihoadon_base_url,
        "ihoadon_tax_code": settings.ihoadon_tax_code,
        "ihoadon_username": settings.ihoadon_username,
        "ihoadon_password_set": bool(settings.ihoadon_password),
        "ihoadon_timeout": settings.ihoadon_timeout,
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_username": settings.smtp_username,
        "smtp_password_set": bool(settings.smtp_password),
        "smtp_from": settings.smtp_from,
        "smtp_to": settings.smtp_to,
    }


@app.post("/api/settings")
def save_app_settings(
    body: dict,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Ghi cau hinh AI/NAS vao DB + reload (cache_clear) -> co hieu luc ngay.

    Secret de trong -> giu gia tri cu (khong bat nhap lai). Chi nhan cac key hop le.
    """
    values = {k: v for k, v in (body or {}).items() if k in settings_store.ALLOWED_KEYS}
    settings_store.set_overrides(values)
    settings_store.reload_settings()
    _audit(db, user, "settings_update", "AI/NAS/iHOADON", ", ".join(sorted(values.keys()))[:180])
    return {"ok": True}


@app.post("/api/ai/test")
def ai_test(
    body: dict = Body(default={}),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Goi prompt tu do de kiem tra endpoint/cau hinh AI tu trang Cai dat."""
    if not settings.ai_enabled:
        return {"ok": False, "message": "AI đang tắt (bật AI rồi lưu cấu hình trước)", "reply": ""}
    prompt = str(body.get("prompt") or "Trả lời đúng một từ: OK").strip()
    if not prompt:
        prompt = "Trả lời đúng một từ: OK"
    if len(prompt) > 4000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prompt thử tối đa 4.000 ký tự")
    try:
        reply = ai.chat(
            settings,
            [
                {"role": "system", "content": "Bạn đang chạy trong màn hình kiểm tra cấu hình. Trả lời rõ ràng, ngắn gọn bằng tiếng Việt."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        return {"ok": True, "message": f"Model {settings.ai_model} phản hồi thành công", "reply": reply}
    except ai.AINotConfigured as e:
        return {"ok": False, "message": str(e), "reply": ""}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"{type(e).__name__}: {e}", "reply": ""}


# ---------------------------------------------------------------------------
# Đồng bộ hóa đơn từ cổng Tổng cục Thuế (hoadondientu.gdt.gov.vn)
# ---------------------------------------------------------------------------
@app.get("/api/tax/captcha")
def tax_captcha(user: CurrentUser = Depends(require_admin)):
    """Lấy 1 captcha mới từ cổng thuế (FE hiển thị SVG cho user gõ)."""
    try:
        return tax.get_captcha()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi lấy captcha từ Cổng Thuế", e, "ksp.tax"),
        )


@app.get("/api/tax/credentials")
def tax_get_credentials(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    """Tra MST da luu + co mat khau chua (KHONG tra mat khau ra ngoai)."""
    from .db import AppSetting

    mst = db.get(AppSetting, "tax_mst")
    pw = db.get(AppSetting, "tax_password_enc")
    return {"mst": mst.value if mst else "", "has_password": bool(pw and pw.value)}


@app.get("/api/tax/session")
def tax_session(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    from . import crypto
    from .db import AppSetting

    row = db.get(AppSetting, "tax_token_enc")
    token = crypto.decrypt(row.value) if row and row.value else ""
    return {"valid": tax.check_token(token)}


@app.post("/api/tax/save-credentials")
def tax_save_credentials(
    body: dict, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Luu MST + mat khau cong thue (mat khau MA HOA Fernet, giai ma duoc de auto-login)."""
    from . import crypto
    from .db import AppSetting

    mst = str(body.get("mst") or "").strip()
    pw = str(body.get("password") or "")
    if mst:
        row = db.get(AppSetting, "tax_mst") or AppSetting(key="tax_mst", value="")
        row.value = mst
        db.merge(row)
    if pw:  # de trong = giu nguyen mat khau cu
        row = db.get(AppSetting, "tax_password_enc") or AppSetting(key="tax_password_enc", value="")
        row.value = crypto.encrypt(pw)
        db.merge(row)
    db.commit()
    _audit(db, user, "tax_save_credentials", mst, "đã lưu (mật khẩu mã hóa)")
    return {"ok": True}


def _tax_stored_password(db) -> str:
    return tax_ops.stored_tax_credentials(db)[1]


@app.post("/api/tax/sync")
def tax_sync(
    body: dict,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Đăng nhập cổng thuế + tải HĐ mua/bán trong khoảng + đối chiếu hệ thống.

    body: {mst, password, ckey, cvalue, tu (yyyy-mm-dd), den}. KHÔNG lưu mật khẩu;
    token chỉ dùng trong request này rồi bỏ.
    """
    mst = str(body.get("mst") or "").strip()
    password = str(body.get("password") or "")
    if not password:  # dung mat khau da luu (ma hoa) neu de trong
        password = _tax_stored_password(db)
    ckey = str(body.get("ckey") or "")
    cvalue = str(body.get("cvalue") or "").strip()
    tu = str(body.get("tu") or "").strip()
    den = str(body.get("den") or "").strip()
    if not (tu and den):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu khoảng ngày")

    from . import crypto
    from .db import AppSetting

    def _save_token(tok: str) -> None:
        row = db.get(AppSetting, "tax_token_enc") or AppSetting(key="tax_token_enc", value="")
        row.value = crypto.encrypt(tok)
        db.merge(row)
        db.commit()

    token = ""
    if ckey and cvalue:
        # Dang nhap moi bang captcha -> lay token va LUU lai de lan sau khoi captcha
        if not (mst and password):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu MST/mật khẩu")
        try:
            token = tax.authenticate(mst, password, ckey, cvalue)
        except tax.TaxError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
        _save_token(token)
    else:
        # Khong co captcha -> dung TOKEN da luu (con han thi khoi dang nhap lai)
        row = db.get(AppSetting, "tax_token_enc")
        token = crypto.decrypt(row.value) if row else ""
        if not tax.check_token(token):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Phiên đăng nhập cổng thuế đã hết hạn — nhập captcha để đăng nhập lại",
            )
    try:
        inv = tax.fetch_invoices(token, tu, den)
        result = tax.reconcile(db, inv, tu, den)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi tải hóa đơn từ Cổng Thuế", e, "ksp.tax"),
        )
    # do_import=True -> nap luon cac HD mua thieu vao he thong dang draft (dung
    # cung token, khong can captcha lai). create_purchase_draft tu chong trung.
    if bool(body.get("do_import")):
        imp = tax.import_missing_purchases(db, token, result["missing_mua"])
        result["import"] = imp
        _audit(db, user, "tax_import", mst, f"nạp {imp['imported']} HĐ mua (bỏ qua {imp['skipped']}, lỗi {imp['errors']})")
    else:
        _audit(db, user, "tax_sync", mst, f"{tu}→{den}: thiếu {len(result['missing_mua'])} mua, {len(result['missing_ban'])} bán")
    return result


@app.post("/api/tax/auto-sync")
def tax_auto_sync(
    days_back: int = 7,
    do_import: bool = True,
    send_telegram: bool = True,
    from_date: str | None = None,
    to_date: str | None = None,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tự động giải CAPTCHA, đăng nhập và đồng bộ theo ngày hoặc khoảng chỉ định."""
    from . import tax_auto_sync
    try:
        res = tax_auto_sync.sync_daily_tax_invoices(
            db=db,
            days_back=days_back,
            do_import=do_import,
            send_telegram=send_telegram,
            from_date=from_date,
            to_date=to_date,
        )
        _audit(db, user, "tax_auto_sync", "hoadondientu.gdt.gov.vn",
               f"Đồng bộ {res.get('range', {}).get('tu')}→{res.get('range', {}).get('den')}: "
               f"nạp +{res.get('import', {}).get('imported', 0)} HĐ mua")
        return res
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            security_utils.error_detail("Lỗi đồng bộ hóa đơn tự động", exc, "ksp.tax"),
        ) from exc


@app.get("/api/tax/auto-sync/status")
def tax_auto_sync_status(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Kiểm tra tính hợp lệ của token và cấu hình Cổng Thuế."""
    from . import crypto, tax
    from .db import AppSetting

    mst_row = db.get(AppSetting, "tax_mst")
    pwd_row = db.get(AppSetting, "tax_password_enc")
    tok_row = db.get(AppSetting, "tax_token_enc")

    has_mst = bool(mst_row and mst_row.value)
    has_pwd = bool(pwd_row and pwd_row.value)
    token = crypto.decrypt(tok_row.value) if (tok_row and tok_row.value) else ""
    token_valid = tax.check_token(token) if token else False

    return {
        "mst": mst_row.value if mst_row else "",
        "configured": has_mst and has_pwd,
        "token_active": token_valid,
    }


def _ky_from_range(tu: str, den: str) -> str:
    """Suy 'yyyy-Qn' tu khoang ngay (uu tien thang cuoi)."""
    m = (den or tu or "")[:7]
    try:
        y, mo = m.split("-")
        return f"{y}-Q{(int(mo) - 1) // 3 + 1}"
    except Exception:  # noqa: BLE001
        return ""


@app.post("/api/tax/review/upload")
async def tax_review_upload(
    file: UploadFile = File(...),
    ky: str = "",
    note: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Ke toan up file BCT .xlsx -> parse + cham loi + luu 1 phien ban."""
    name = file.filename or "bct.xlsx"
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chỉ nhận file Excel (.xlsx)")
    content = await storage.read_upload_limited(file, max_bytes=25 * 1024 * 1024)
    try:
        r = tax_review.review_bytes(content)
        tax_review.crosscheck_sales(db, r)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            security_utils.error_detail("Không đọc được file Excel báo cáo thuế", e, "ksp.tax_review"),
        )
    doc_id = storage.save_upload(content, suffix=".xlsx")
    rec = TaxReviewUpload(
        ky=ky.strip(), ten_file=name, doc_id=doc_id,
        findings=json.dumps(r["findings"], ensure_ascii=False),
        ct_snapshot=json.dumps(r["summary"], ensure_ascii=False),
        n_do=r["summary"]["do"], n_vang=r["summary"]["vang"],
        note=note.strip(), uploaded_by=user.username,
    )
    db.add(rec)
    db.commit()
    _audit(db, user, "tax_review_upload", name, f"{ky}: {rec.n_do} đỏ, {rec.n_vang} vàng")
    return {"id": rec.id, "findings": r["findings"], "summary": r["summary"]}


@app.get("/api/tax/review")
def tax_review_list(
    ky: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    q = select(TaxReviewUpload).order_by(TaxReviewUpload.id.desc())
    if ky.strip():
        q = q.where(TaxReviewUpload.ky == ky.strip())
    rows = list(db.scalars(q))
    return [
        {
            "id": r.id, "ky": r.ky, "ten_file": r.ten_file, "note": r.note,
            "n_do": r.n_do, "n_vang": r.n_vang,
            "summary": json.loads(r.ct_snapshot or "{}"),
            "uploaded_by": r.uploaded_by,
            "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else "",
        }
        for r in rows
    ]


@app.get("/api/tax/review/{rid}")
def tax_review_detail(
    rid: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Chi tiet 1 phien ban: findings + grid 3 sheet (doc lai file goc)."""
    rec = db.get(TaxReviewUpload, rid)
    if not rec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy")
    try:
        content = storage.read_doc(rec.doc_id, suffix=".xlsx")
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File gốc không còn")
    r = tax_review.review_bytes(content)
    tax_review.crosscheck_sales(db, r)
    return {
        "id": rec.id, "ky": rec.ky, "ten_file": rec.ten_file, "note": rec.note,
        "findings": r["findings"], "summary": r["summary"], "grids": r["grids"],
    }


@app.get("/api/tax/review/{rid}/file")
def tax_review_file(
    rid: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rec = db.get(TaxReviewUpload, rid)
    if not rec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy")
    data = storage.read_doc(rec.doc_id, suffix=".xlsx")
    disp = f"attachment; filename*=UTF-8''{quote(rec.ten_file)}"
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disp},
    )


@app.delete("/api/tax/review/{rid}")
def tax_review_delete(
    rid: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rec = db.get(TaxReviewUpload, rid)
    if not rec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy")
    db.delete(rec)
    db.commit()
    _audit(db, user, "tax_review_delete", rec.ten_file)
    return {"ok": True}


@app.get("/api/nas/browse")
def nas_browse(
    path: str = "",
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Duyet thu muc NAS (xem tu xa)."""
    try:
        rel, entries = nas.list_dir(settings, path)
    except nas.NasDisabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "NAS dang tat")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi kết nối NAS", e, "ksp.nas"),
        )
    return {"path": rel, "entries": entries}


@app.get("/api/nas/file")
def nas_file(
    path: str,
    request: Request,
    inline: bool = False,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """Xem/tai 1 file tren NAS."""
    try:
        data = nas.read_file(settings, path)
    except nas.NasDisabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "NAS dang tat")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi đọc file từ NAS", e, "ksp.nas"),
        )
    name = path.replace("/", "\\").rsplit("\\", 1)[-1]
    is_pdf = name.lower().endswith(".pdf")
    is_docx = name.lower().endswith(".docx")
    is_md = name.lower().endswith((".md", ".markdown"))
    csp_nonce = getattr(request.state, "csp_nonce", "")
    if inline and is_docx and docx_preview.is_valid_docx(data):
        html_out = docx_preview.render_docx_preview_html(
            data,
            title=name,
            download_url=f"/api/nas/file?path={quote(path)}&inline=false",
        )
        return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
    if inline and is_md and markdown_preview.is_valid_markdown(data, name):
        html_out = markdown_preview.render_markdown_preview_html(
            data,
            title=name,
            download_url=f"/api/nas/file?path={quote(path)}&inline=false",
            csp_nonce=csp_nonce,
        )
        return HTMLResponse(content=html_out)
    media = (
        "application/pdf"
        if is_pdf
        else (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if is_docx
            else ("text/markdown; charset=utf-8" if is_md else "application/octet-stream")
        )
    )
    kind = "inline" if (inline and is_pdf) else "attachment"
    disp = security_utils.safe_content_disposition(name, disposition=kind)
    return StreamingResponse(
        iter([data]), media_type=media, headers={"Content-Disposition": disp}
    )


@app.post("/api/nas/sync-all")
def nas_sync_all(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings), db: Session = Depends(get_session)):
    if not settings.nas_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "NAS dang tat")
    ok, msg = nas.test_connection(settings)
    if not ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Không kết nối được NAS", RuntimeError(msg), "ksp.nas"),
        )
    synced = failed = 0
    for d in db.scalars(select(Document).order_by(Document.id)):
        good, _ = nas.sync_document(settings, db, d)
        if good:
            synced += 1
        else:
            failed += 1
    _audit(db, user, "nas_sync_all", f"{synced} ok / {failed} lỗi")
    return {"ok": True, "synced": synced, "failed": failed}


# ---------------------------------------------------------------------------
# Logo chu ky (thay the duoc)
# ---------------------------------------------------------------------------
@app.get("/api/logo")
def get_logo(settings: Settings = Depends(get_settings)):
    return Response(content=settings.logo_path.read_bytes(), media_type="image/png")


@app.post("/api/logo")
async def upload_logo(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    content = await storage.read_upload_limited(file, max_bytes=5 * 1024 * 1024)
    try:
        img = Image.open(_io.BytesIO(content)).convert("RGBA")
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File anh khong hop le")
    img.save(settings.data_path / "logo.png")
    return {"ok": True}


@app.delete("/api/logo")
def reset_logo(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)):
    p = settings.data_path / "logo.png"
    if p.exists():
        p.unlink()
    return {"ok": True, "message": "Da khoi phuc logo mac dinh"}


# ---------------------------------------------------------------------------
# Trung tam van han hoa don / thue
# ---------------------------------------------------------------------------
@app.get("/api/operations/dashboard")
def operations_dashboard(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    return tax_ops.dashboard(db)


@app.get("/api/tax/policy")
def tax_policy_at(date_value: str = "", user: CurrentUser = Depends(require_admin)):
    from datetime import date as date_type
    try:
        on_date = date_type.fromisoformat(date_value) if date_value else date_type.today()
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ngày phải có dạng YYYY-MM-DD")
    return tax_policy.policy_snapshot(on_date)


@app.get("/api/jobs/tax-sync")
def tax_sync_runs(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    from .db import JobRun
    rows = db.scalars(select(JobRun).where(JobRun.kind == "tax_sync").order_by(JobRun.id.desc()).limit(30))
    return [tax_ops.serialize_run(x) for x in rows]


@app.post("/api/jobs/tax-sync/run")
def tax_sync_run_now(
    body: dict | None = Body(default=None),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    body = body or {}
    tu = str(body.get("tu") or "").strip()
    den = str(body.get("den") or "").strip()
    if bool(tu) != bool(den):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Phải nhập đủ ngày bắt đầu và ngày kết thúc")
    if tu and den:
        try:
            start, end = date.fromisoformat(tu), date.fromisoformat(den)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ngày phải có dạng YYYY-MM-DD") from exc
        if start > end:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ngày bắt đầu không được sau ngày kết thúc")
    run = tax_ops.run_tax_sync(db, tu=tu or None, den=den or None)
    _audit(db, user, "tax_sync_job", str(run.id), run.status)
    return tax_ops.serialize_run(run)


@app.get("/api/jobs/email-sync")
def email_sync_runs_job(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    from .db import JobRun
    rows = db.scalars(select(JobRun).where(JobRun.kind == "email_invoice_sync").order_by(JobRun.id.desc()).limit(30))
    return [tax_ops.serialize_run(x) for x in rows]


@app.post("/api/jobs/email-sync/run")
def email_sync_run_now(
    body: dict | None = Body(default=None),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    from . import email_sync
    body = body or {}
    days = int(body.get("days") or 30)
    try:
        run = email_sync.run_sync(db, settings, days=days)
    except email_sync.EmailSyncBusy as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    except email_sync.EmailAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    except email_sync.EmailConnectionError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            security_utils.error_detail("Lỗi kết nối máy chủ Email", exc, "ksp.email_sync"),
        )
    except email_sync.EmailSyncError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    _audit(db, user, "email_sync_job", str(run.id), run.status)
    return tax_ops.serialize_run(run)



@app.get("/api/tax/reports")
def tax_reports(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    rows = db.scalars(select(TaxReport).order_by(TaxReport.ky.desc(), TaxReport.version.desc()))
    return [tax_ops.serialize_report(x) for x in rows]


@app.post("/api/tax/reports/{ky}/generate")
def tax_report_generate(ky: str, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    try:
        rec = tax_ops.generate_report(db, ky.upper(), user.username)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kỳ phải có dạng YYYY-Q1..Q4")
    _audit(db, user, "tax_report_generate", ky, f"v{rec.version}")
    return tax_ops.serialize_report(rec)


@app.post("/api/tax/reports/{rid}/lock")
def tax_report_lock(rid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    rec = db.get(TaxReport, rid)
    if not rec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tờ khai")
    rec.status = "locked"; rec.locked_at = datetime.now(timezone.utc); db.commit()
    _audit(db, user, "tax_report_lock", rec.ky, f"v{rec.version}")
    return tax_ops.serialize_report(rec)


@app.get("/api/tax/reports/{rid}/xlsx")
def tax_report_file(rid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    rec = db.get(TaxReport, rid)
    if not rec or not rec.doc_id or not storage.exists(rec.doc_id, ".xlsx"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy file tờ khai")
    return Response(
        storage.read_doc(rec.doc_id, ".xlsx"),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": _content_disposition(f"BCT_{rec.ky}_v{rec.version}.xlsx")},
    )


@app.get("/api/tax/reports/{rid}/compare/{review_id}")
def tax_report_compare(rid: int, review_id: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    rec, review = db.get(TaxReport, rid), db.get(TaxReviewUpload, review_id)
    if not rec or not review:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy dữ liệu đối chiếu")
    ours, accountant = json.loads(rec.snapshot or "{}"), json.loads(review.ct_snapshot or "{}")
    diffs = []
    for key in ("22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "40", "41", "43"):
        a = float(ours.get(key, 0) or 0); b = float(accountant.get(key, accountant.get(f"ct_{key}", 0)) or 0)
        diffs.append({"indicator": key, "crm": a, "accountant": b, "difference": a - b, "match": abs(a - b) <= 1})
    return {"ky": rec.ky, "report_id": rid, "review_id": review_id, "differences": diffs}


# ---------------------------------------------------------------------------
# Phuc vu frontend da build (SPA)
# ---------------------------------------------------------------------------
@app.get("/md/{doc_slug:path}")
def public_markdown_viewer(doc_slug: str, request: Request, format: str = "", raw: int = 0):
    """Xem trước hoặc tải tài liệu Markdown (.md) công khai trong thư mục docs/public/ của ksp-pdfsign."""
    md_path = markdown_preview.resolve_repo_markdown_path(REPO_ROOT, doc_slug)
    if not md_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tài liệu Markdown (.md)")
    content = md_path.read_bytes()
    if raw == 1 or format.lower() in ("raw", "md"):
        return Response(
            content=content,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": _content_disposition(md_path.name)},
        )
    if format.lower() == "pdf":
        pdf_bytes = markdown_preview.render_markdown_to_pdf_bytes(content, title=md_path.name)
        pdf_name = md_path.stem + ".pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": security_utils.safe_content_disposition(pdf_name, disposition="inline")},
        )
    slug_enc = quote(doc_slug.lstrip("/"), safe="/")
    csp_nonce = getattr(request.state, "csp_nonce", "")
    html_out = markdown_preview.render_markdown_preview_html(
        content,
        title=md_path.name,
        download_url=f"/md/{slug_enc}?raw=1",
        pdf_url=f"/md/{slug_enc}?format=pdf",
        csp_nonce=csp_nonce,
    )
    return HTMLResponse(content=html_out)


_FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
if (_FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")
    if (_FRONTEND_DIST / "fonts").exists():
        app.mount("/fonts", StaticFiles(directory=_FRONTEND_DIST / "fonts"), name="fonts")

    _ROOT_FILES = {
        "favicon.ico": "image/x-icon",
        "favicon.png": "image/png",
        "apple-touch-icon.png": "image/png",
    }

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str, request: Request):
        if full_path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        if full_path.lower().endswith((".md", ".markdown")):
            md_path = markdown_preview.resolve_repo_markdown_path(REPO_ROOT, full_path)
            if md_path:
                content = md_path.read_bytes()
                slug_enc = quote(full_path.lstrip("/"), safe="/")
                csp_nonce = getattr(request.state, "csp_nonce", "")
                html_out = markdown_preview.render_markdown_preview_html(
                    content,
                    title=md_path.name,
                    download_url=f"/md/{slug_enc}?raw=1",
                    pdf_url=f"/md/{slug_enc}?format=pdf",
                    csp_nonce=csp_nonce,
                )
                return HTMLResponse(content=html_out)
        # Phuc vu cac file tinh o goc (favicon...) neu co
        if full_path in _ROOT_FILES:
            p = _FRONTEND_DIST / full_path
            if p.exists():
                return FileResponse(p, media_type=_ROOT_FILES[full_path])
        # index.html khong cache: deploy ban moi la thay ngay, khong can Ctrl+Shift+R
        # (assets/*.js|css co hash trong ten nen van duoc cache binh thuong)
        return FileResponse(
            _FRONTEND_DIST / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
