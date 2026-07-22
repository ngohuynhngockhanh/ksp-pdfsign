"""FastAPI app: dang nhap, ky, kiem tra, quan ly khach hang & ho so."""
from __future__ import annotations

import io as _io
import html
import json
import secrets
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import (
    BackgroundTasks,
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
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import (
    accounts,
    ai,
    audit,
    bbbg,
    classify,
    invoice,
    money,
    nas,
    settings_store,
    signing,
    tax,
    tax_ops,
    tax_policy,
    tax_review,
    storage,
    token_backend,
    verify,
)
from .auth import (
    COOKIE_NAME,
    CurrentUser,
    authenticate,
    create_token,
    ensure_admin_seed,
    require_admin,
    require_user,
)
from .config import REPO_ROOT, Settings, get_settings
from .db import (
    AuditLog,
    Customer,
    CustomerAlias,
    Document,
    InvIssue,
    InvSale,
    Order,
    Product,
    Share,
    TaxReviewUpload,
    TaxReport,
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

app = FastAPI(title="ksp-pdfsign", version="2.0.0")
app.include_router(inv_router)


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
    finally:
        gen.close()


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
        "customer_id": user.customer_id,
        "customer_name": customer_name,
        "agent_default_ip": settings.agent_default_ip,
        "default_location": settings.default_location,
        "using_default_secrets": settings.using_default_secrets,
        "must_change_password": bool(db_user and db_user.must_change_password),
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
        address=c.address or "", email=c.email or "", note=c.note,
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
        name=body.name, tax_code=body.tax_code, contact=body.contact, note=body.note
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
    for f in ("name", "tax_code", "contact", "note"):
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


@app.get("/api/documents/{doc_pk}/verify", response_model=VerifyResponse)
def verify_document_record(
    doc_pk: int,
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Kiem tra chu ky cua mot ho so da luu (admin bat ky / khach hang cua minh)."""
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


@app.post("/api/documents/{doc_pk}/share", response_model=ShareResponse)
def create_share(
    doc_pk: int,
    body: ShareRequest,
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
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
        ))
    return out


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
def ai_test(user: CurrentUser = Depends(require_admin), settings: Settings = Depends(get_settings)):
    """Goi thu AI 1 cau ngan de kiem tra endpoint/cau hinh (test tu web)."""
    if not settings.ai_enabled:
        return {"ok": False, "message": "AI đang tắt (bật 'ai_enabled' trước)"}
    try:
        reply = ai.chat(
            settings,
            [{"role": "user", "content": "Trả lời đúng một từ: OK"}],
            temperature=0,
        )
        return {"ok": True, "message": f"Model {settings.ai_model} phản hồi: {reply[:120]}"}
    except ai.AINotConfigured as e:
        return {"ok": False, "message": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}


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
