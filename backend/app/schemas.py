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
