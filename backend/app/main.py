"""FastAPI app: dang nhap, ky, kiem tra, quan ly khach hang & ho so."""
from __future__ import annotations

import io as _io

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import signing, storage, token_backend, verify
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
from .db import Customer, Document, User, get_session, init_db
from .schemas import (
    AccountCreate,
    AgentTarget,
    AssignRequest,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    DocumentOut,
    LoginRequest,
    SignRequest,
    SignResponse,
    VerifyResponse,
)
from .security import hash_password

app = FastAPI(title="ksp-pdfsign", version="2.0.0")

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


@app.get("/api/documents", response_model=list[DocumentOut])
def list_documents(
    customer_id: int | None = None, unassigned: bool = False,
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session),
):
    q = select(Document).order_by(Document.created_at.desc())
    if unassigned:
        q = q.where(Document.customer_id.is_(None))
    elif customer_id is not None:
        q = q.where(Document.customer_id == customer_id)
    return [_doc_out(d) for d in db.scalars(q)]


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
        headers={"Content-Disposition": f'attachment; filename="{d.filename}"'},
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

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        return FileResponse(_FRONTEND_DIST / "index.html")
