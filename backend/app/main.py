"""FastAPI app: dang nhap, upload, liet ke chung thu, ky, kiem tra."""
from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import agent_client, signing, storage, verify
from .auth import COOKIE_NAME, create_token, require_user, verify_login
from .config import Settings, get_settings
from .schemas import (
    AgentTarget,
    LoginRequest,
    SignRequest,
    SignResponse,
    VerifyResponse,
)

app = FastAPI(title="ksp-pdfsign", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "using_default_secrets": settings.using_default_secrets}


@app.post("/api/login")
def login(body: LoginRequest, settings: Settings = Depends(get_settings)):
    if not verify_login(body.username, body.password, settings):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sai tai khoan hoac mat khau")
    token = create_token(body.username, settings)
    resp = JSONResponse({"ok": True, "username": body.username})
    resp.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        max_age=settings.jwt_ttl_minutes * 60,
    )
    return resp


@app.post("/api/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp


@app.get("/api/me")
def me(user: str = Depends(require_user), settings: Settings = Depends(get_settings)):
    return {
        "username": user,
        "agent_default_ip": settings.agent_default_ip,
        "using_default_secrets": settings.using_default_secrets,
    }


@app.post("/api/upload")
async def upload(
    file: UploadFile = File(...),
    user: str = Depends(require_user),
):
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chi chap nhan file PDF")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    doc_id = storage.save_upload(content)
    return {"doc_id": doc_id, "filename": file.filename}


@app.get("/api/doc/{doc_id}")
def get_doc(doc_id: str, user: str = Depends(require_user)):
    """Tra file PDF de frontend render (yeu cau dang nhap)."""
    if not storage.exists(doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    data = storage.read_doc(doc_id)
    return Response(content=data, media_type="application/pdf")


@app.post("/api/certs")
def list_certs(
    body: AgentTarget,
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
):
    """Liet ke chung thu tren token qua agent."""
    try:
        certs = agent_client.list_certs(settings, body.ip, body.admin_password)
    except agent_client.AgentError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return {"certs": [c.model_dump() for c in certs]}


@app.post("/api/sign", response_model=SignResponse)
def sign(
    body: SignRequest,
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
):
    if not storage.exists(body.doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    try:
        signed_id = signing.sign_document(settings, body)
    except agent_client.AgentError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Ky that bai: {e}")
    return SignResponse(
        doc_id=signed_id,
        signed=True,
        download_url=f"/api/download/{signed_id}",
    )


@app.get("/api/download/{doc_id}")
def download(doc_id: str, user: str = Depends(require_user)):
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
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
):
    # Route sync (chay o threadpool) de pyHanko validate_pdf_signature (dung
    # asyncio.run ben trong) khong bi ket voi event loop dang chay.
    content = file.file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File khong phai PDF hop le")
    doc_id = storage.save_upload(content)
    return verify.verify_document(settings, content, doc_id)


@app.get("/api/verify/{doc_id}", response_model=VerifyResponse)
def verify_existing(
    doc_id: str,
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
):
    if not storage.exists(doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Khong tim thay tai lieu")
    data = storage.read_doc(doc_id)
    return verify.verify_document(settings, data, doc_id)
