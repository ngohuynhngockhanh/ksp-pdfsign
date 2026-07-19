"""FastAPI app: dang nhap, ky, kiem tra, quan ly khach hang & ho so."""
from __future__ import annotations

import io as _io
import secrets
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
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

from . import accounts, signing, storage, token_backend, verify
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
from .db import Customer, Document, Share, User, get_session, init_db
from .schemas import (
    AccountCreate,
    AccountInfo,
    AgentTarget,
    AssignRequest,
    BulkAssign,
    BulkIds,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    DocumentOut,
    DocumentsPage,
    LoginRequest,
    PasswordChange,
    PasswordReset,
    ShareRequest,
    ShareResponse,
    SignRequest,
    SignResponse,
    UserOut,
    VerifyResponse,
)
from .security import hash_password, verify_password

app = FastAPI(title="ksp-pdfsign", version="2.0.0")


def _content_disposition(filename: str) -> str:
    """Content-Disposition an toan cho ten file tieng Viet (RFC 5987)."""
    ascii_name = filename.encode("ascii", "ignore").decode() or "document.pdf"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"

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
    settings = get_settings()
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


@app.post("/api/login")
def login(
    body: LoginRequest,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    user = authenticate(db, body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sai tai khoan hoac mat khau")
    token = create_token(user, settings)
    resp = JSONResponse({"ok": True, "username": user.username, "role": user.role})
    resp.set_cookie(
        COOKIE_NAME, token, httponly=True, samesite="lax",
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

    # Luu ho so
    doc = Document(
        doc_id=signed_id,
        filename=body.filename or f"signed-{signed_id}.pdf",
        signer_name=signer_label,
        signed=True,
        customer_id=body.customer_id,
    )
    db.add(doc)
    db.commit()
    return SignResponse(doc_id=signed_id, signed=True, download_url=f"/api/download/{signed_id}")


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
    return CustomerOut(
        id=c.id, name=c.name, tax_code=c.tax_code, contact=c.contact, note=c.note,
        created_at=c.created_at.isoformat(), document_count=doc_count or 0,
        account_usernames=usernames,
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
    # Tao luon tai khoan neu co
    if body.account_username and body.account_password:
        if db.scalar(select(User).where(User.username == body.account_username)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Ten tai khoan da ton tai")
        db.add(User(
            username=body.account_username,
            password_hash=hash_password(body.account_password),
            role="customer", customer_id=c.id,
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
    else:
        db.add(User(
            username=body.username, password_hash=hash_password(body.password),
            role="customer", customer_id=cid,
        ))
    db.commit()
    return {"ok": True, "username": body.username}


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
    )


@app.get("/api/documents", response_model=DocumentsPage)
def list_documents(
    customer_id: int | None = None,
    unassigned: bool = False,
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
    doc_pk: int, body: AssignRequest,
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
    return _doc_out(d)


@app.delete("/api/documents/{doc_pk}")
def delete_document(doc_pk: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)):
    d = db.get(Document, doc_pk)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay ho so")
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
# Thao tac hang loat (bulk)
# ---------------------------------------------------------------------------
@app.post("/api/documents/bulk-assign")
def bulk_assign(
    body: BulkAssign, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    if body.customer_id is not None and not db.get(Customer, body.customer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay khach hang")
    n = 0
    for d in db.scalars(select(Document).where(Document.id.in_(body.ids))):
        d.customer_id = body.customer_id
        n += 1
    db.commit()
    return {"ok": True, "count": n}


@app.post("/api/documents/bulk-delete")
def bulk_delete(
    body: BulkIds, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    n = 0
    for d in db.scalars(select(Document).where(Document.id.in_(body.ids))):
        db.delete(d)
        n += 1
    db.commit()
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
    if len(body.new_password) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mat khau moi qua ngan")
    u.password_hash = hash_password(body.new_password)
    db.commit()
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
    if len(body.new_password) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mat khau qua ngan")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True, "username": u.username}


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
# Phuc vu frontend da build (SPA)
# ---------------------------------------------------------------------------
_FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
if (_FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")

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
        return FileResponse(_FRONTEND_DIST / "index.html")
