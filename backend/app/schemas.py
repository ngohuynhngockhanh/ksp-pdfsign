"""Cac model du lieu vao/ra cho API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class Rect(BaseModel):
    """Vung dat chu ky, toa do theo DIEM PDF (goc duoi-trai)."""
    page: int = Field(ge=0)
    x1: float
    y1: float
    x2: float
    y2: float

    def as_box(self) -> tuple[float, float, float, float]:
        # pyHanko box = (x1, y1, x2, y2) voi (x1,y1) goc duoi-trai.
        lx, rx = sorted((self.x1, self.x2))
        by, ty = sorted((self.y1, self.y2))
        return (lx, by, rx, ty)


class AgentTarget(BaseModel):
    """Thong tin ket noi toi may Windows cam token."""
    ip: str
    admin_password: str
    pin: str


class CertInfo(BaseModel):
    id: str
    subject: str
    issuer: str
    serial: str
    valid_from: str
    valid_to: str


class SignRequest(BaseModel):
    doc_id: str
    rect: Rect
    cert_id: str
    agent: AgentTarget
    reason: str = ""
    location: str = ""
    signer_name: str = ""
    filename: str = ""
    customer_id: int | None = None  # gan luon khi ky (tuy chon)
    doc_type: str = ""  # phan loai (bbbg khi ky BBBG vua sinh)


class SignResponse(BaseModel):
    doc_id: str
    signed: bool
    download_url: str


class SignatureReport(BaseModel):
    field_name: str
    signer_name: str
    signing_time: str | None = None
    intact: bool           # byte-range con nguyen ven
    valid: bool            # hop le mat ma
    trusted: bool          # chuoi CA tin cay
    revocation_ok: bool | None = None
    has_timestamp: bool = False
    ltv: str | None = None
    coverage: str          # toan bo tai lieu / co sua sau khi ky
    summary: str           # ket luan ngan gon
    problems: list[str] = Field(default_factory=list)


class VerifyResponse(BaseModel):
    doc_id: str
    signature_count: int
    signatures: list[SignatureReport]


# --- Khach hang / Tai khoan / Ho so ---
class CustomerCreate(BaseModel):
    name: str
    tax_code: str = ""
    contact: str = ""
    note: str = ""
    # Tao luon tai khoan cho khach hang (tuy chon)
    account_username: str | None = None
    account_password: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = None
    tax_code: str | None = None
    contact: str | None = None
    note: str | None = None


class AccountCreate(BaseModel):
    username: str
    password: str


class CustomerOut(BaseModel):
    id: int
    name: str
    tax_code: str
    contact: str
    note: str
    created_at: str
    document_count: int = 0
    account_usernames: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    id: int
    doc_id: str
    filename: str
    signer_name: str
    signed: bool
    note: str
    customer_id: int | None
    customer_name: str | None = None
    created_at: str
    download_url: str
    nas_synced: bool = False
    doc_type: str = ""


class AssignRequest(BaseModel):
    customer_id: int | None  # None = bo gan (chua phan loai)


class DocumentsPage(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    per_page: int


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


class PasswordReset(BaseModel):
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    customer_id: int | None
    customer_name: str | None = None


class ShareRequest(BaseModel):
    days: int = 7
    include_account: bool = False


class AccountInfo(BaseModel):
    username: str
    password: str


class ShareResponse(BaseModel):
    token: str
    url: str
    filename: str
    expires_at: str
    account: AccountInfo | None = None


class BulkAssign(BaseModel):
    ids: list[int]
    customer_id: int | None


class BulkIds(BaseModel):
    ids: list[int]


# --- BBBG (sinh tu hoa don) ---
class BBBGDate(BaseModel):
    day: int
    month: int
    year: int


class BBBGItem(BaseModel):
    ten: str = ""
    dvt: str = ""
    so_luong: str = ""


class BBBGBenB(BaseModel):
    name: str = ""
    address: str = ""
    mst: str = ""
    dai_dien: str = ""
    chuc_vu: str = ""
    nguoi_nhan: str = ""
    dien_thoai: str = ""


class BBBGGenerate(BaseModel):
    so_bb: str = ""
    noi_lap: str = "Đắk Lắk"
    ngay: BBBGDate
    ben_b: BBBGBenB
    items: list[BBBGItem] = Field(default_factory=list)
    template_key: str = "bbbg_thiet_bi"
    ben_a: dict | None = None
    filename: str = "bien-ban-ban-giao.pdf"


class DocTypeUpdate(BaseModel):
    doc_type: str
