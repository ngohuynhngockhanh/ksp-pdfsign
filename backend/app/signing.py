"""Loi ky PDF bang pyHanko + ky ngoai (external signing) qua Windows Agent.

Luong:
  1. Lay chung thu ky (+ chuoi) tu agent.
  2. Tao mot Signer "ngoai" (ExternalTokenSigner): khi pyHanko can chu ky raw,
     no goi agent de token ky.
  3. pyHanko chuan bi signature field + appearance hien thi tai o nguoi dung chon,
     tinh digest, goi Signer, roi nhung CMS + (tuy chon) timestamp.
"""
from __future__ import annotations

import io

from asn1crypto import x509
from pyhanko.pdf_utils.images import PdfImage
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.layout import AxisAlignment, InnerScaling, SimpleBoxLayoutRule
from pyhanko.sign import fields, signers
from pyhanko.sign.signers import Signer
from pyhanko.sign.timestamps import HTTPTimeStamper
from pyhanko.stamp import TextStampStyle
from pyhanko_certvalidator.registry import SimpleCertificateStore

from . import appearance, storage, token_backend
from .config import Settings
from .schemas import SignRequest


class ExternalTokenSigner(Signer):
    """Signer uy quyen viec ky raw cho Windows Agent (token WIN-CA)."""

    def __init__(
        self,
        settings: Settings,
        request: SignRequest,
        signing_cert: x509.Certificate,
        cert_registry: SimpleCertificateStore,
    ):
        self._settings = settings
        self._request = request
        super().__init__(signing_cert=signing_cert, cert_registry=cert_registry)

    @property
    def _key_len(self) -> int:
        """Do dai chu ky RSA (byte) = kich thuoc modulus."""
        return (self.signing_cert.public_key.bit_size + 7) // 8

    async def async_sign_raw(
        self, data: bytes, digest_algorithm: str, dry_run: bool = False
    ) -> bytes:
        if dry_run:
            # Chi can dung KICH THUOC de pyHanko cap phat cho de nhung chu ky.
            return b"\x00" * self._key_len
        # Goi backend token (SSH hoac HTTP agent) de token ky raw `data`.
        return token_backend.sign_raw(
            self._settings,
            self._request.agent,
            self._request.cert_id,
            data,
            digest_algorithm,
        )


def _build_cert_registry(
    chain_der: list[bytes],
) -> tuple[x509.Certificate, SimpleCertificateStore]:
    if not chain_der:
        raise ValueError("Agent khong tra ve chung thu ky.")
    certs = [x509.Certificate.load(der) for der in chain_der]
    signing_cert = certs[0]
    registry = SimpleCertificateStore()
    registry.register_multiple(certs)
    return signing_cert, registry


def sign_document(settings: Settings, req: SignRequest) -> tuple[str, str]:
    """Ky PDF theo yeu cau, tra ve (doc_id file da ky, ten nguoi ky)."""
    pdf_bytes = storage.read_doc(req.doc_id)

    # 1) Lay chung thu ky + chuoi tu backend token.
    chain = token_backend.get_cert_chain(
        settings, req.agent.ip, req.agent.admin_password, req.cert_id
    )
    signing_cert, registry = _build_cert_registry(chain)
    external_signer = ExternalTokenSigner(settings, req, signing_cert, registry)

    # 2) Cau hinh chu ky + o hien thi (kieu Foxit: logo chim + du truong).
    field_name = _next_field_name(pdf_bytes)
    signer_label = req.signer_name or _subject_common_name(signing_cert)
    mst = _subject_mst(signing_cert)
    x1, y1, x2, y2 = req.rect.as_box()
    stamp_style = _build_stamp_style(
        settings, req, signer_label, mst, box_w=x2 - x1, box_h=y2 - y1
    )

    sig_meta = signers.PdfSignatureMetadata(
        field_name=field_name,
        reason=req.reason or None,
        location=req.location or None,
        name=signer_label,
        subfilter=fields.SigSeedSubFilter.PADES,
        embed_validation_info=settings.enable_ltv,
    )
    timestamper = HTTPTimeStamper(settings.tsa_url) if settings.tsa_url else None

    new_field = fields.SigFieldSpec(
        sig_field_name=field_name,
        on_page=req.rect.page,
        box=req.rect.as_box(),
    )
    pdf_signer = signers.PdfSigner(
        sig_meta,
        signer=external_signer,
        stamp_style=stamp_style,
        timestamper=timestamper,
        new_field_spec=new_field,
    )

    # 3) Ky (goi async_sign_raw -> agent -> token).
    reader = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
    out = io.BytesIO()
    pdf_signer.sign_pdf(
        reader,
        existing_fields_only=False,
        output=out,
        appearance_text_params={"signer": signer_label},
    )

    return storage.save_upload(out.getvalue()), signer_label


def _next_field_name(pdf_bytes: bytes) -> str:
    """Sinh ten field khong trung voi cac field chu ky hien co."""
    existing: set[str] = set()
    try:
        r = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        for item in fields.enumerate_sig_fields(r):
            existing.add(item[0])
    except Exception:
        pass
    i = 1
    while f"Signature{i}" in existing:
        i += 1
    return f"Signature{i}"


def _subject_common_name(cert: x509.Certificate) -> str:
    try:
        return cert.subject.native.get("common_name", "Nguoi ky")
    except Exception:
        return "Nguoi ky"


def _subject_mst(cert: x509.Certificate) -> str:
    """Trich ma so thue tu subject (truong userid dang 'MST:...')."""
    try:
        for v in cert.subject.native.values():
            if isinstance(v, str) and "MST" in v.upper():
                return v.split(":")[-1].strip()
    except Exception:
        pass
    return ""


def _build_stamp_style(
    settings: Settings,
    req: SignRequest,
    signer_label: str,
    mst: str,
    box_w: float,
    box_h: float,
) -> TextStampStyle:
    """Hinh thuc chu ky: ve toan bo bang Pillow (logo chim + du truong, tieng
    Viet chuan, can trai) roi nhung lam ANH. Tranh loi gian chu cua pyHanko.
    """
    img = appearance.render_signature(
        settings, box_w, box_h, signer_label, mst, req.reason, req.location
    )
    # Anh dung ty le khung -> STRETCH_FILL lap day khong meo.
    return TextStampStyle(
        stamp_text="",
        border_width=0,
        background=PdfImage(img),
        background_opacity=1.0,
        background_layout=SimpleBoxLayoutRule(
            x_align=AxisAlignment.ALIGN_MID,
            y_align=AxisAlignment.ALIGN_MID,
            inner_content_scaling=InnerScaling.STRETCH_FILL,
        ),
    )
