"""FastAPI app: dang nhap, ky, kiem tra, quan ly khach hang & ho so."""
from __future__ import annotations

import io as _io
import html
import json
import re
import secrets
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import (
    BackgroundTasks,
    Body,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
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
    verify,
)
from .customs_drive_api import router as customs_drive_router
from .pymid_api import router as pymid_router
from .auth import (
    COOKIE_NAME,
    CurrentUser,
    authenticate,
    create_token,
    ensure_admin_seed,
    require_admin,
    require_full_portal,
    require_training,
    require_user,
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
    TaxReviewUpload,
    TaxReport,
    TrainingShare,
    TrainingQuery,
    TrainingKnowledge,
    TrainingPublicSession,
    TrainingPublicQuery,
    User,
    get_session,
    init_db,
)
from .inventory import normalize_name
from .schemas import (
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

app = FastAPI(title="ksp-pdfsign", version="2.0.0")
app.include_router(inv_router)
app.include_router(payroll_router)
app.include_router(customs_drive_router)
app.include_router(pymid_router)


def _training_error(exc: training.TrainingError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Chan CSRF theo Origin va gan header bao mat cho API/frontend."""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin", "")
        if origin:
            settings = get_settings()
            parsed = urlsplit(settings.public_base_url)
            public_origin = f"{parsed.scheme}://{parsed.netloc}"
            allowed = {public_origin, "http://localhost:5173", "http://127.0.0.1:5173"}
            if origin not in allowed:
                return JSONResponse({"detail": "Nguon yeu cau khong hop le"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self' http://localhost:5173 ws://localhost:5173; "
        "frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    )
    return response


def _content_disposition(filename: str) -> str:
    """Content-Disposition an toan cho ten file tieng Viet (RFC 5987)."""
    ascii_name = filename.encode("ascii", "ignore").decode() or "document.pdf"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    finally:
        gen.close()


def _cleanup_public_training_data(db: Session, settings: Settings) -> None:
    """Xóa lead/hội thoại công khai quá hạn lưu trữ, không đụng dữ liệu CRM."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, settings.public_training_retention_days))
    old_ids = list(db.scalars(select(TrainingPublicSession.id).where(TrainingPublicSession.created_at < cutoff)))
    if not old_ids:
        return
    db.execute(delete(TrainingPublicQuery).where(TrainingPublicQuery.session_id.in_(old_ids)))
    db.execute(delete(TrainingPublicSession).where(TrainingPublicSession.id.in_(old_ids)))
    db.commit()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "using_default_secrets": settings.using_default_secrets}


# Chong do mat khau: sai lien tiep >= N lan trong cua so -> khoa IP 30 phut
LOGIN_LOCK_FAILS = 5
LOGIN_LOCK_MINUTES = 30


def _recent_consecutive_fails(db: Session, ip: str) -> tuple[int, datetime | None]:
    """(so lan login_fail lien tiep trong 30 phut, thoi diem sai gan nhat).

    Dem tu audit log — khong can bang moi, song sot qua restart. Cac lan bi
    chan (login_locked) khong tinh la fail de khoa tu het han sau 30 phut.
    """
    if not ip:
        return 0, None
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        minutes=LOGIN_LOCK_MINUTES
    )
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.ip == ip,
            AuditLog.action.in_(["login", "login_fail"]),
            AuditLog.ts >= since,
        )
        .order_by(AuditLog.ts.desc())
        .limit(LOGIN_LOCK_FAILS * 4)
    )
    fails = 0
    last_fail = None
    for r in rows:
        if r.action == "login":
            break
        fails += 1
        if last_fail is None:
            last_fail = r.ts
    return fails, last_fail


def _count_recent_fails(db: Session, ip: str) -> int:
    return _recent_consecutive_fails(db, ip)[0]


def _login_lock_remaining(db: Session, ip: str) -> int:
    """So phut IP con bi khoa (0 = khong khoa)."""
    fails, last_fail = _recent_consecutive_fails(db, ip)
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
    locked = _login_lock_remaining(db, ip)
    if locked:
        audit.record(db, body.username, "?", ip, "login_locked", detail=f"còn {locked} phút")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"IP tạm khóa {LOGIN_LOCK_MINUTES} phút do nhập sai mật khẩu "
            f"{LOGIN_LOCK_FAILS} lần liên tiếp — thử lại sau {locked} phút",
        )
    user = authenticate(db, body.username, body.password)
    if user is None:
        audit.record(db, body.username, "?", ip, "login_fail")
        con_lai = LOGIN_LOCK_FAILS - _count_recent_fails(db, ip)
        if con_lai <= 0:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                f"Sai tai khoan hoac mat khau — IP bị khóa {LOGIN_LOCK_MINUTES} phút",
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
def logout():
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
# Ky so (admin)
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...), user: CurrentUser = Depends(require_admin)):
    content = await file.read()
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
    content = await file.read()
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
    for info in pdf_infos:
        data = zf.read(info)
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Ky that bai: {e}")

    # Phan loai: uu tien loai chi dinh (vd BBBG), nguoc lai tu nhan dien.
    dtype = body.doc_type
    if not dtype:
        try:
            dtype = classify.detect_doc_type(storage.read_doc(signed_id))
        except Exception:
            dtype = ""

    # Luu ho so
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
    content = file.file.read()
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
    jwt_token = create_token(account, settings)
    audit.record(
        db, account.username, account.role,
        request.client.host if request.client else "", "login_link",
    )
    resp = RedirectResponse(url="/ho-so-cua-toi", status_code=302)
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
    return DocumentOut(
        id=d.id, doc_id=d.doc_id, filename=d.filename, signer_name=d.signer_name,
        signed=d.signed, note=d.note, customer_id=d.customer_id,
        customer_name=d.customer.name if d.customer else None,
        created_at=d.created_at.isoformat(),
        download_url=f"/api/documents/{d.id}/download",
        nas_synced=d.nas_synced_at is not None,
        doc_type=d.doc_type or "",
        signed_upload_name=d.signed_upload_name or "",
        order_id=d.order_id,
        order_code=f"{d.order.code} · {d.order.name}" if d.order else "",
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
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    old = d.filename
    d.filename = name
    db.commit()
    db.refresh(d)
    _audit(db, user, "rename_doc", name, f"từ: {old}")
    background.add_task(_bg_nas_sync, d.id)  # dong bo NAS voi ten moi
    return _doc_out(d)


@app.delete("/api/documents/{doc_pk}")
def delete_document(doc_pk: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
    _audit(db, user, "delete_doc", d.filename)
    db.delete(d)
    db.commit()
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
    if not storage.exists(d.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    data = storage.read_doc(d.doc_id)
    return StreamingResponse(
        iter([data]), media_type="application/pdf",
        headers={"Content-Disposition": _content_disposition(d.filename)},
    )


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
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    up_id = storage.save_upload(content)
    d.signed_upload_id = up_id
    d.signed_upload_name = file.filename or f"da-ky-{up_id}.pdf"
    d.signed_upload_at = datetime.utcnow()
    db.commit()
    _audit(db, user, "upload_signed", d.filename, d.signed_upload_name)
    # Backup NAS (best-effort)
    if settings.nas_enabled:
        try:
            nas.sync_extra_file(
                settings, d.customer.name if d.customer else "",
                "da-ky", d.signed_upload_name, content,
            )
        except Exception:
            pass
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
            if storage.exists(d.doc_id):
                zf.writestr(_zip_arcname("ho-so", f"{d.id}_{d.filename}", f"ho-so-{d.id}.pdf"), storage.read_doc(d.doc_id))
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
    if not storage.exists(d.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    return verify.verify_document(settings, storage.read_doc(d.doc_id), d.doc_id)


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
    for d in db.scalars(select(Document).where(Document.id.in_(body.ids))):
        db.delete(d)
        n += 1
    db.commit()
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
    since = datetime.now(timezone.utc) - timedelta(minutes=15)
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
        limit = max(1, min(int(request.query_params.get("limit", "10")), 20))
    except ValueError:
        limit = 10
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
def training_eval_report(settings: Settings = Depends(get_settings)):
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
    try:
        data = training.ask(settings, question, session_id, _training_personal_context(db, user.id))
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
    try:
        personal_context = _training_personal_context(db, user.id)
        job_id = training_jobs.start(
            user.username,
            settings,
            str(body.get("question", "")),
            str(body.get("session_id", "")),
            personal_context,
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


@app.get("/api/training/stats")
def training_stats(
    _user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rows = list(db.scalars(select(TrainingQuery).order_by(TrainingQuery.created_at.desc()).limit(1000)))
    users: dict[str, dict] = {}
    for row in rows:
        item = users.setdefault(row.username, {"username": row.username, "questions": 0, "tokens": 0, "durationMs": 0})
        item["questions"] += 1
        item["tokens"] += row.input_tokens_est + row.output_tokens_est
        item["durationMs"] += row.duration_ms
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
        "tokenNote": "Token ước tính từ độ dài câu hỏi và câu trả lời; Hermes CLI chưa trả usage chuẩn.",
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
        "answer": public_training.sanitize_public_result(answer, settings),
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
    if not storage.exists(d.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File khong ton tai")
    if inline:
        # Xem truc tiep trong trinh duyet
        disp = f"inline; filename*=UTF-8''{quote(d.filename)}"
    else:
        disp = _content_disposition(d.filename)
    return StreamingResponse(
        iter([storage.read_doc(d.doc_id)]),
        media_type="application/pdf",
        headers={"Content-Disposition": disp},
    )


@app.get("/api/share/{token}/download")
def share_download(token: str, db: Session = Depends(get_session)):
    return _share_file(token, db, inline=False)


@app.get("/api/share/{token}/view")
def share_view(token: str, db: Session = Depends(get_session)):
    return _share_file(token, db, inline=True)


@app.get("/s/{token}", response_class=HTMLResponse)
def share_page(token: str, db: Session = Depends(get_session)):
    s = db.scalar(select(Share).where(Share.token == token))
    if not s:
        return HTMLResponse(_share_html("Link không tồn tại", None, None), status_code=404)
    expired = datetime.utcnow() > s.expires_at
    exp = s.expires_at.strftime("%d/%m/%Y %H:%M")
    if expired:
        return HTMLResponse(
            _share_html(f"Link đã hết hạn (từ {exp})", s.document.filename, None), status_code=410
        )
    return HTMLResponse(_share_html(None, s.document.filename, token, exp))


def _share_html(error: str | None, filename: str | None, token: str | None, exp: str = "") -> str:
    error = html.escape(error or "", quote=True) if error else None
    filename = html.escape(filename or "", quote=True) if filename else None
    token = quote(token or "", safe="") if token else None
    exp = html.escape(exp, quote=True)
    if error:
        inner = (
            f'<div class="card"><div class="brand">🖊️ KSP PDF Signer</div>'
            f'<h1>Chia sẻ tài liệu</h1><p class="err">{error}</p></div>'
        )
        preview = ""
    else:
        inner = (
            f'<div class="bar">'
            f'<div class="brand">🖊️ KSP · <span class="fn">📄 {filename}</span></div>'
            f'<div class="acts">'
            f'<a class="btn ghost" href="/api/share/{token}/view" target="_blank">🔍 Xem toàn màn hình</a>'
            f'<a class="btn" href="/api/share/{token}/download">⬇️ Tải xuống</a>'
            f'</div></div><div class="exp">Link có hiệu lực đến {exp}</div>'
        )
        preview = f'<iframe class="pdf" src="/api/share/{token}/view" title="{filename}"></iframe>'
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.png"><title>Xem / Tải tài liệu — KSP</title>
<style>
*{{box-sizing:border-box}}
body{{font-family:system-ui,'Segoe UI',Roboto,sans-serif;background:#eef1f4;margin:0;
color:#1c2530;min-height:100vh;display:flex;flex-direction:column}}
.bar{{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
background:#fff;border-bottom:1px solid #d9dee5;padding:12px 18px}}
.brand{{color:#1e6fd9;font-weight:700}}.fn{{color:#1c2530;font-weight:600}}
.acts{{display:flex;gap:8px;flex-wrap:wrap}}
.btn{{display:inline-block;background:#1e6fd9;color:#fff;text-decoration:none;
padding:9px 18px;border-radius:8px;font-size:.9rem}}
.btn:hover{{background:#1857aa}}
.btn.ghost{{background:#fff;color:#1e6fd9;border:1px solid #1e6fd9}}
.btn.ghost:hover{{background:#eef4fd}}
.exp{{background:#fff6e0;color:#8a6300;font-size:.8rem;padding:5px 18px;border-bottom:1px solid #f0dca0}}
.pdf{{flex:1;width:100%;border:0;min-height:70vh}}
.card{{background:#fff;border:1px solid #d9dee5;border-radius:14px;padding:34px 40px;
text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:420px;margin:auto}}
h1{{font-size:1.2rem;margin:0 0 6px}}.err{{color:#d13b3b}}
.thanks{{text-align:center;padding:12px 18px;font-size:.85rem;color:#6b7683;
background:#fff;border-top:1px solid #e6eaef}}
.thanks a{{color:#1e6fd9;text-decoration:none}}
</style></head><body>{inner}{preview}
<footer class="thanks">💙 Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của
<a href="https://inut.vn" target="_blank">INUT</a></footer>
</body></html>"""


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
    content = await file.read()
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Khong doc duoc hoa don: {e}")
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sinh BBBG that bai: {e}")
    doc_id = storage.save_upload(pdf)
    customer_id = _upsert_customer(db, body.ben_b)
    _audit(db, user, "bbbg_generate", body.filename, body.ben_b.name)
    return {"doc_id": doc_id, "filename": body.filename, "customer_id": customer_id}


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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Khong doc duoc hoa don: {e}")
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sinh PDF that bai: {e}")
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sinh PDF that bai: {e}")
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sinh hợp đồng thất bại: {e}")
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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Sinh hợp đồng thất bại: {e}")

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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{type(e).__name__}: {e}")


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
    from . import crypto
    from .db import AppSetting

    pw = db.get(AppSetting, "tax_password_enc")
    return crypto.decrypt(pw.value) if pw else ""


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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Lỗi tải hóa đơn: {type(e).__name__}: {e}")
    # do_import=True -> nap luon cac HD mua thieu vao he thong dang draft (dung
    # cung token, khong can captcha lai). create_purchase_draft tu chong trung.
    if bool(body.get("do_import")):
        imp = tax.import_missing_purchases(db, token, result["missing_mua"])
        result["import"] = imp
        _audit(db, user, "tax_import", mst, f"nạp {imp['imported']} HĐ mua (bỏ qua {imp['skipped']}, lỗi {imp['errors']})")
    else:
        _audit(db, user, "tax_sync", mst, f"{tu}→{den}: thiếu {len(result['missing_mua'])} mua, {len(result['missing_ban'])} bán")
    return result


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
    content = await file.read()
    try:
        r = tax_review.review_bytes(content)
        tax_review.crosscheck_sales(db, r)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Không đọc được file: {type(e).__name__}: {e}")
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Loi NAS: {e}")
    return {"path": rel, "entries": entries}


@app.get("/api/nas/file")
def nas_file(
    path: str,
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
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Loi NAS: {e}")
    name = path.replace("/", "\\").rsplit("\\", 1)[-1]
    is_pdf = name.lower().endswith(".pdf")
    media = "application/pdf" if is_pdf else "application/octet-stream"
    kind = "inline" if (inline and is_pdf) else "attachment"
    disp = f"{kind}; filename*=UTF-8''{quote(name)}"
    return StreamingResponse(
        iter([data]), media_type=media, headers={"Content-Disposition": disp}
    )


@app.post("/api/nas/sync-all")
def nas_sync_all(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings), db: Session = Depends(get_session)):
    if not settings.nas_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "NAS dang tat")
    ok, msg = nas.test_connection(settings)
    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Khong ket noi NAS: {msg}")
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
    content = await file.read()
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
def tax_sync_run_now(user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    run = tax_ops.run_tax_sync(db)
    _audit(db, user, "tax_sync_job", str(run.id), run.status)
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
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        # Phuc vu cac file tinh o goc (favicon...) neu co
        if full_path in _ROOT_FILES:
            p = _FRONTEND_DIST / full_path
            if p.exists():
                return FileResponse(p, media_type=_ROOT_FILES[full_path])
        # index.html khong cache: deploy ban moi la thay ngay, khong can Ctrl+Shift+R
        # (assets/*.js|css co hash trong ten nen van duoc cache binh thuong)
        return FileResponse(
            _FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )
