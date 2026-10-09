"""Ket noi CSDL (SQLite) + khai bao ORM."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    select,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    tax_code: Mapped[str] = mapped_column(String(50), default="")
    contact: Mapped[str] = mapped_column(String(255), default="")
    address: Mapped[str] = mapped_column(String(500), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    logo_url: Mapped[str] = mapped_column(String(1000), default="")
    note: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    users: Mapped[list["User"]] = relationship(back_populates="customer")
    documents: Mapped[list["Document"]] = relationship(back_populates="customer")


class CustomerAlias(Base):
    """Ten cong ty khac da hoc tu gop (merge) -> tro toi 1 Customer chuan.

    name_norm = normalize_name() cua ten cu (cong ty bi gop, hoac ten khac
    cua cung 1 khach). Dung de auto nhan khach o cac lan sau (import HD,
    parse ben B...) ngay ca khi ten ghi khac nhau/sai chinh ta nhe.
    """

    __tablename__ = "customer_aliases"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_norm: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(150), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="customer")  # admin|customer
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    session_version: Mapped[int] = mapped_column(default=1)
    must_change_password: Mapped[bool] = mapped_column(default=False)
    training_access: Mapped[bool] = mapped_column(default=False)

    customer: Mapped["Customer | None"] = relationship(back_populates="users")


class Order(Base):
    """Don hang: gom nhieu bo ho so (bao gia -> BBBG -> BBNT -> de nghi TT)."""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    customer: Mapped["Customer | None"] = relationship()
    documents: Mapped[list["Document"]] = relationship(back_populates="order")

    @property
    def code(self) -> str:
        return f"DH-{self.id:04d}"


class Document(Base):
    """Ho so = mot file PDF da luu (thuong da ky) + metadata + gan khach hang."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(64), index=True)  # id file trong storage
    filename: Mapped[str] = mapped_column(String(255), default="")
    signer_name: Mapped[str] = mapped_column(String(255), default="")
    signed: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str] = mapped_column(String(1000), default="")
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    # Phan loai: hop_dong | bbbg | bao_gia | hoa_don | khac | ""
    doc_type: Mapped[str] = mapped_column(String(20), default="", index=True)
    # Ban da ky cua cac ben tai len (vd hop dong nhieu chu ky)
    signed_upload_id: Mapped[str] = mapped_column(String(64), default="")
    signed_upload_name: Mapped[str] = mapped_column(String(255), default="")
    signed_upload_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Dong bo NAS
    nas_path: Mapped[str] = mapped_column(String(500), default="")
    nas_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Gom nhom theo don hang
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id"), nullable=True, index=True
    )
    source_system: Mapped[str] = mapped_column(String(30), default="", index=True)
    source_external_id: Mapped[str] = mapped_column(String(100), default="", index=True)
    source_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer | None"] = relationship(back_populates="documents")
    order: Mapped["Order | None"] = relationship(back_populates="documents")


class Share(Base):
    """Link chia se cong khai (khong can dang nhap) toi mot ho so, co han."""

    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    document: Mapped["Document"] = relationship()


class TrainingShare(Base):
    """Cau tra loi Training chia se cong khai bang token ngau nhien, co han."""

    __tablename__ = "training_shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    question: Mapped[str] = mapped_column(String(2000))
    answer_json: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class TrainingQuery(Base):
    """Usage telemetry for admin reporting; token counts are explicit estimates."""

    __tablename__ = "training_queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(150), index=True)
    question: Mapped[str] = mapped_column(String(2000))
    answer_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    input_tokens_est: Mapped[int] = mapped_column(default=0)
    output_tokens_est: Mapped[int] = mapped_column(default=0)
    duration_ms: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TrainingPublicSession(Base):
    """Lead công khai; token và số điện thoại không được lưu plaintext."""

    __tablename__ = "training_public_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    phone_ciphertext: Mapped[str] = mapped_column(Text, default="")
    phone_hash: Mapped[str] = mapped_column(String(64), index=True)
    phone_last4: Mapped[str] = mapped_column(String(4), default="")
    locale: Mapped[str] = mapped_column(String(5), default="vi")
    consent_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    note: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    queries: Mapped[list["TrainingPublicQuery"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class TrainingPublicQuery(Base):
    """Một câu hỏi công khai, ràng buộc với đúng lead/session."""

    __tablename__ = "training_public_queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("training_public_sessions.id"), index=True)
    question: Mapped[str] = mapped_column(String(2000))
    answer_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    stage: Mapped[str] = mapped_column(String(160), default="Đang tìm trong kho iNut")
    duration_ms: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    session: Mapped["TrainingPublicSession"] = relationship(back_populates="queries")


class FacebookMessage(Base):
    """Tin nhắn Messenger để lưu inbox/telemetry; Hermes chỉ nhận tối đa 20 lượt đã lọc."""

    __tablename__ = "facebook_messages"
    __table_args__ = (
        Index("ix_facebook_messages_conversation", "page_id", "psid", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[str] = mapped_column(String(64), index=True)
    psid: Mapped[str] = mapped_column(String(128), index=True)
    sender_name: Mapped[str] = mapped_column(String(255), default="")
    message_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    direction: Mapped[str] = mapped_column(String(10), default="inbound", index=True)
    text: Mapped[str] = mapped_column(String(4000), default="")
    status: Mapped[str] = mapped_column(String(20), default="received", index=True)
    reply_to_id: Mapped[int | None] = mapped_column(nullable=True)
    error: Mapped[str] = mapped_column(String(500), default="")
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    queue_latency_ms: Mapped[int] = mapped_column(default=0)
    latency_ms: Mapped[int] = mapped_column(default=0)
    hermes_latency_ms: Mapped[int] = mapped_column(default=0)
    context_latency_ms: Mapped[int] = mapped_column(default=0)
    send_latency_ms: Mapped[int] = mapped_column(default=0)
    profile_lookup_ms: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class TelegramConnection(Base):
    """A single Telegram chat bound to one KSP account."""

    __tablename__ = "telegram_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    chat_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255), default="")
    display_name: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship()


class TelegramLink(Base):
    """Short-lived, single-use link used by the bot /start handshake."""

    __tablename__ = "telegram_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked: Mapped[bool] = mapped_column(default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped["User"] = relationship()


class TrainingKnowledge(Base):
    """Admin-managed notes scoped to one CRM user; never executable instructions."""

    __tablename__ = "training_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    content: Mapped[str] = mapped_column(String(12000))
    enabled: Mapped[bool] = mapped_column(default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class LoginLink(Base):
    """Bearer link co han de khach mo va dang nhap ma khong go mat khau."""

    __tablename__ = "login_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped["User"] = relationship()


class ContractDraft(Base):
    """Ban hop dong dang soan, luu rieng theo tung khach hang."""

    __tablename__ = "contract_drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    payload: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    customer: Mapped["Customer"] = relationship()


class IhoadonInvoice(Base):
    """Hoa don da phat hanh dong bo tu iHOADON de cap cho cong khach hang."""

    __tablename__ = "ihoadon_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(30), default="", index=True)
    invoice_series: Mapped[str] = mapped_column(String(30), default="")
    invoice_date: Mapped[str] = mapped_column(String(10), default="", index=True)
    buyer_tax_code: Mapped[str] = mapped_column(String(30), default="")
    buyer_tax_code_norm: Mapped[str] = mapped_column(String(30), default="", index=True)
    buyer_name: Mapped[str] = mapped_column(String(255), default="")
    total_payment: Mapped[float] = mapped_column(default=0.0)
    status: Mapped[str] = mapped_column(String(30), default="")
    adjustment_type: Mapped[str] = mapped_column(String(20), default="")
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True, index=True
    )
    match_source: Mapped[str] = mapped_column(String(10), default="")  # auto|manual|""
    pdf_doc_id: Mapped[str] = mapped_column(String(64), default="")
    pdf_filename: Mapped[str] = mapped_column(String(255), default="")
    xml_doc_id: Mapped[str] = mapped_column(String(64), default="")
    xml_filename: Mapped[str] = mapped_column(String(255), default="")
    source_updated_at: Mapped[str] = mapped_column(String(40), default="")
    sync_error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    customer: Mapped["Customer | None"] = relationship()


class Product(Base):
    """Danh muc hang hoa/dich vu — tu hoc tu cac bao gia/de nghi TT da sinh."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    ten: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    dvt: Mapped[str] = mapped_column(String(50), default="")
    don_gia: Mapped[float] = mapped_column(default=0.0)
    thue_suat: Mapped[float] = mapped_column(default=10.0)
    use_count: Mapped[int] = mapped_column(default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PymidCoopProduct(Base):
    """Bảng giá hợp tác riêng giữa INUT và PYMID."""

    __tablename__ = "pymid_coop_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500))
    unit: Mapped[str] = mapped_column(String(50), default="Cái")
    source_price: Mapped[float] = mapped_column(default=0.0)
    category: Mapped[str] = mapped_column(String(20), default="hardware")
    level: Mapped[int | None] = mapped_column(nullable=True)
    enabled: Mapped[bool] = mapped_column(default=True, index=True)
    valid_from: Mapped[str] = mapped_column(String(10), default="2026-07-29")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PymidCoopOrder(Base):
    __tablename__ = "pymid_coop_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    level: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    document_date: Mapped[str] = mapped_column(String(10), default="")
    customer_reference: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(String(1000), default="")
    policy_code: Mapped[str] = mapped_column(String(50), default="")
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    invoice_lines_json: Mapped[str] = mapped_column(Text, default="[]")
    total_net: Mapped[float] = mapped_column(default=0.0)
    total_tax: Mapped[float] = mapped_column(default=0.0)
    total_gross: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PieceworkContractor(Base):
    """Danh bạ Nhà cung cấp / Thợ nhận khoán / Cộng tác viên ngoài."""
    __tablename__ = "piecework_contractors"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    id_card: Mapped[str] = mapped_column(String(30), index=True)
    id_card_date: Mapped[str] = mapped_column(String(10), default="")
    id_card_place: Mapped[str] = mapped_column(String(150), default="Cục Cảnh sát QLHC về TTXH")
    tax_code: Mapped[str] = mapped_column(String(30), default="", index=True)
    phone: Mapped[str] = mapped_column(String(30), default="", index=True)
    address: Mapped[str] = mapped_column(String(255), default="")
    bank_account: Mapped[str] = mapped_column(String(50), default="")
    bank_name: Mapped[str] = mapped_column(String(100), default="Techcombank")
    skills: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(String(500), default="")
    
    id_card_front_doc_id: Mapped[str] = mapped_column(String(64), default="")
    id_card_back_doc_id: Mapped[str] = mapped_column(String(64), default="")
    tax_commitment_doc_id: Mapped[str] = mapped_column(String(64), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PieceworkContract(Base):
    """Hợp đồng giao khoán công việc & Quản lý hồ sơ CTV / Thợ ngoài."""
    __tablename__ = "piecework_contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    contractor_id: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    contract_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    contract_type: Mapped[str] = mapped_column(String(30), default="thi_cong", index=True) # thi_cong | boc_xep | gia_cong
    title: Mapped[str] = mapped_column(String(255), default="")
    project_name: Mapped[str] = mapped_column(String(255), default="")
    location: Mapped[str] = mapped_column(String(255), default="")
    contract_date: Mapped[str] = mapped_column(String(10), default="") # YYYY-MM-DD
    
    # Bên B (Người nhận khoán / Thợ / CTV)
    worker_name: Mapped[str] = mapped_column(String(150), default="")
    worker_id_card: Mapped[str] = mapped_column(String(30), default="")
    worker_id_card_date: Mapped[str] = mapped_column(String(10), default="")
    worker_id_card_place: Mapped[str] = mapped_column(String(150), default="")
    worker_tax_code: Mapped[str] = mapped_column(String(30), default="")
    worker_phone: Mapped[str] = mapped_column(String(30), default="")
    worker_address: Mapped[str] = mapped_column(String(255), default="")
    worker_bank_account: Mapped[str] = mapped_column(String(50), default="")
    worker_bank_name: Mapped[str] = mapped_column(String(100), default="")
    
    # Giá trị & Thuế TNCN (Theo Nghị định 253/2026/NĐ-CP)
    total_amount: Mapped[float] = mapped_column(default=0.0) # Gross
    tax_rate: Mapped[float] = mapped_column(default=0.0) # 0.0 hoặc 10.0
    tax_amount: Mapped[float] = mapped_column(default=0.0)
    net_amount: Mapped[float] = mapped_column(default=0.0) # Net
    
    # Chi tiết hạng mục khoán (JSON list)
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    note: Mapped[str] = mapped_column(String(500), default="")
    
    # Trạng thái hồ sơ & Checklist deficiency
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True) # draft | pending_docs | ready_to_pay | completed
    has_id_card_front: Mapped[bool] = mapped_column(default=False)
    has_id_card_back: Mapped[bool] = mapped_column(default=False)
    id_card_front_doc_id: Mapped[str] = mapped_column(String(64), default="")
    id_card_back_doc_id: Mapped[str] = mapped_column(String(64), default="")
    
    has_acceptance: Mapped[bool] = mapped_column(default=False)
    acceptance_doc_id: Mapped[str] = mapped_column(String(64), default="")
    site_photos_json: Mapped[str] = mapped_column(Text, default="[]")
    
    has_tax_commitment: Mapped[bool] = mapped_column(default=False)
    tax_commitment_doc_id: Mapped[str] = mapped_column(String(64), default="")
    
    has_bank_proof: Mapped[bool] = mapped_column(default=False) # UNC Techcombank 79713
    bank_proof_doc_id: Mapped[str] = mapped_column(String(64), default="")
    
    # Chữ ký Online của thợ & Ảnh chân dung eKYC lúc ký
    is_signed_by_worker: Mapped[bool] = mapped_column(default=False)
    worker_signature_data: Mapped[str] = mapped_column(Text, default="")
    worker_signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    worker_face_photo_data: Mapped[str] = mapped_column(Text, default="")
    worker_face_doc_id: Mapped[str] = mapped_column(String(64), default="")
    # Ký số điện tử Bên A (INUT)
    is_signed_by_inut: Mapped[bool] = mapped_column(default=False)
    inut_signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contract_pdf_doc_id: Mapped[str] = mapped_column(String(64), default="")
    
    # Token portal di động cho thợ
    portal_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    
    # Dong bo Google Drive Ke toan theo quy
    drive_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    drive_folder: Mapped[str] = mapped_column(String(255), default="")
    drive_link: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

class AuditLog(Base):
    """Nhat ky thao tac de truy vet."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    username: Mapped[str] = mapped_column(String(150), default="", index=True)
    role: Mapped[str] = mapped_column(String(20), default="")
    ip: Mapped[str] = mapped_column(String(50), default="")
    action: Mapped[str] = mapped_column(String(50), index=True)
    target: Mapped[str] = mapped_column(String(255), default="")
    detail: Mapped[str] = mapped_column(String(500), default="")


class PayrollEmployee(Base):
    """Ho so luong nhan vien; thong tin nhay cam chi danh cho admin."""

    __tablename__ = "payroll_employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    position: Mapped[str] = mapped_column(String(150), default="")
    base_salary: Mapped[float] = mapped_column(default=0.0)
    insurance_salary: Mapped[float] = mapped_column(default=0.0)
    meal_allowance: Mapped[float] = mapped_column(default=0.0)
    phone_allowance: Mapped[float] = mapped_column(default=0.0)
    fuel_allowance: Mapped[float] = mapped_column(default=0.0)
    responsibility_allowance: Mapped[float] = mapped_column(default=0.0)
    dependents: Mapped[int] = mapped_column(default=0)
    active: Mapped[bool] = mapped_column(default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PayrollPeriod(Base):
    __tablename__ = "payroll_periods"
    __table_args__ = (UniqueConstraint("month", "version", name="uq_payroll_month_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    source: Mapped[str] = mapped_column(String(30), default="crm")
    policy_snapshot: Mapped[str] = mapped_column(Text, default="{}")
    findings: Mapped[str] = mapped_column(Text, default="[]")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PayrollLine(Base):
    __tablename__ = "payroll_lines"
    __table_args__ = (UniqueConstraint("period_id", "employee_id", name="uq_payroll_line"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("payroll_periods.id"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("payroll_employees.id"), index=True)
    employee_snapshot: Mapped[str] = mapped_column(Text, default="{}")
    standard_days: Mapped[float] = mapped_column(default=22.0)
    actual_days: Mapped[float] = mapped_column(default=0.0)
    overtime_pay: Mapped[float] = mapped_column(default=0.0)
    bonus: Mapped[float] = mapped_column(default=0.0)
    other_taxable: Mapped[float] = mapped_column(default=0.0)
    unpaid_deduction: Mapped[float] = mapped_column(default=0.0)
    computed: Mapped[str] = mapped_column(Text, default="{}")
    overrides: Mapped[str] = mapped_column(Text, default="{}")
    override_reason: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PayrollImport(Base):
    __tablename__ = "payroll_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    drive_file_id: Mapped[str] = mapped_column(String(255), default="", index=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    snapshot: Mapped[str] = mapped_column(Text, default="{}")
    findings: Mapped[str] = mapped_column(Text, default="[]")
    imported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PayrollWorkbookDraft(Base):
    __tablename__ = "payroll_workbook_drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("payroll_imports.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    changes: Mapped[str] = mapped_column(Text, default="[]")
    findings: Mapped[str] = mapped_column(Text, default="[]")
    local_path: Mapped[str] = mapped_column(String(500), default="")
    drive_filename: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PayrollEmployeeAlias(Base):
    """Ten trong file Excel duoc gan ve mot ho so nhan vien HR."""

    __tablename__ = "payroll_employee_aliases"

    id: Mapped[int] = mapped_column(primary_key=True)
    normalized_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("payroll_employees.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PayrollStatement(Base):
    """Snapshot dong luong theo tung phien ban file; chi mot ban current moi duoc cong."""

    __tablename__ = "payroll_statements"
    __table_args__ = (
        UniqueConstraint("employee_id", "month", "source_import_id",
                         name="uq_payroll_statement_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("payroll_employees.id"), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    source_import_id: Mapped[int] = mapped_column(ForeignKey("payroll_imports.id"), index=True)
    source_row: Mapped[int] = mapped_column(default=0)
    is_current: Mapped[bool] = mapped_column(default=True, index=True)
    gross_income: Mapped[float] = mapped_column(default=0.0)
    employee_insurance: Mapped[float] = mapped_column(default=0.0)
    taxable_income_before_deductions: Mapped[float] = mapped_column(default=0.0)
    pit_withheld: Mapped[float] = mapped_column(default=0.0)
    net_payable: Mapped[float] = mapped_column(default=0.0)
    employer_cost: Mapped[float] = mapped_column(default=0.0)
    dependent_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PayrollPayment(Base):
    """So thanh toan luong; giao dich hoan tat khong sua, chi duoc huy co ly do."""

    __tablename__ = "payroll_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("payroll_employees.id"), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    amount: Mapped[float] = mapped_column(default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="prepared", index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bank_name: Mapped[str] = mapped_column(String(150), default="")
    transaction_ref: Mapped[str] = mapped_column(String(150), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    evidence_path: Mapped[str] = mapped_column(String(500), default="")
    evidence_name: Mapped[str] = mapped_column(String(255), default="")
    evidence_sha256: Mapped[str] = mapped_column(String(64), default="")
    cancel_reason: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------------------------------------------------------------------------
# Ton kho (ke toan kho)
# ---------------------------------------------------------------------------
class InvWarehouse(Base):
    """Kho: HH (hang hoa) | NVL (nguyen vat lieu) | TP (thanh pham)."""

    __tablename__ = "inv_warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class InvItem(Base):
    """Mat hang ton kho (ma hang on dinh, khac bang products tu hoc)."""

    __tablename__ = "inv_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    ma_hang: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    ten: Mapped[str] = mapped_column(String(500), index=True)
    ten_norm: Mapped[str] = mapped_column(String(500), default="", index=True)
    dvt: Mapped[str] = mapped_column(String(50), default="")
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id"), nullable=True
    )
    note: Mapped[str] = mapped_column(String(500), default="")
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class InvMove(Base):
    """So kho (moi dong = 1 lan nhap/xuat). Chi sinh khi ghi so chung tu.

    ngay: chuoi ISO 'YYYY-MM-DD' (ngay dan su tren chung tu, khong dung UTC).
    so_luong luon >= 0, chieu theo loai; rieng dieu_chinh cho phep am (giam ton).
    don_gia/gia_tri cua dong XUAT do replay() tinh lai (binh quan gia quyen).
    """

    __tablename__ = "inv_moves"
    __table_args__ = (Index("ix_inv_moves_iwn", "item_id", "warehouse_id", "ngay"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("inv_warehouses.id"))
    ngay: Mapped[str] = mapped_column(String(10), index=True)
    # dau_ky | nhap | xuat | sx_in | sx_out | dieu_chinh
    loai: Mapped[str] = mapped_column(String(12))
    so_luong: Mapped[float] = mapped_column(default=0.0)
    don_gia: Mapped[float] = mapped_column(default=0.0)
    gia_tri: Mapped[float] = mapped_column(default=0.0)
    lot_number: Mapped[str] = mapped_column(String(100), default="")
    serial_numbers: Mapped[str] = mapped_column(Text, default="")
    # Nguon goc: purchase|issue|production|opening|manual + id chung tu/dong
    ref_type: Mapped[str] = mapped_column(String(20), default="")
    ref_id: Mapped[int | None] = mapped_column(nullable=True)
    ref_line_id: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    item: Mapped["InvItem"] = relationship()
    warehouse: Mapped["InvWarehouse"] = relationship()


class InvPurchase(Base):
    """Hoa don mua vao (draft -> duyet -> ghi so)."""

    __tablename__ = "inv_purchase_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_hd: Mapped[str] = mapped_column(String(20), default="")
    ky_hieu: Mapped[str] = mapped_column(String(20), default="")
    mst_ban: Mapped[str] = mapped_column(String(20), default="", index=True)
    ten_ban: Mapped[str] = mapped_column(String(255), default="")
    ngay: Mapped[str] = mapped_column(String(10), default="")
    tong_truoc_thue: Mapped[float] = mapped_column(default=0.0)
    tong_thue: Mapped[float] = mapped_column(default=0.0)
    tong_tien: Mapped[float] = mapped_column(default=0.0)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # xml|pdf|scan_ai|manual
    doc_id: Mapped[str] = mapped_column(String(64), default="")  # file goc trong storage
    doc_suffix: Mapped[str] = mapped_column(String(10), default=".pdf")
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)  # draft|posted|void
    # hang_hoa = nhap kho; dich_vu = chi phi/dich vu, chi luu vet KHONG nhap kho
    loai: Mapped[str] = mapped_column(String(10), default="hang_hoa")
    confidence: Mapped[float] = mapped_column(default=1.0)
    warnings: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    dup_of: Mapped[int | None] = mapped_column(nullable=True)
    # dong bo file goc len NAS (checksum de biet file da co chua)
    nas_path: Mapped[str] = mapped_column(String(500), default="")
    nas_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nas_sha256: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["InvPurchaseLine"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class InvPurchaseLine(Base):
    __tablename__ = "inv_purchase_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("inv_purchase_invoices.id"), index=True
    )
    stt: Mapped[int] = mapped_column(default=0)
    ten_raw: Mapped[str] = mapped_column(String(500), default="")
    dvt: Mapped[str] = mapped_column(String(50), default="")
    so_luong: Mapped[float] = mapped_column(default=0.0)
    don_gia: Mapped[float] = mapped_column(default=0.0)
    thanh_tien: Mapped[float] = mapped_column(default=0.0)
    thue_suat: Mapped[float] = mapped_column(default=0.0)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("inv_items.id"), nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_warehouses.id"), nullable=True
    )
    match_kind: Mapped[str] = mapped_column(String(10), default="none")  # exact|fuzzy|manual|new|none
    confidence: Mapped[float] = mapped_column(default=1.0)
    warnings: Mapped[str] = mapped_column(Text, default="[]")

    invoice: Mapped["InvPurchase"] = relationship(back_populates="lines")


class InvItemAlias(Base):
    """Alias hoc tu tu lan gan tay: (ten hang chuan hoa, MST ben ban) -> mat hang.

    Ghi tu dong khi ghi so hoa don mua co dong match_kind='manual'/'learned'.
    mst_ban="" la fallback dung chung cho moi NCC khi khong co ban ghi rieng.
    Dung de auto-match cac lan import sau, thay vi phai chon tay lai tu ten.
    """

    __tablename__ = "inv_item_aliases"
    __table_args__ = (UniqueConstraint("ten_norm", "mst_ban"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ten_norm: Mapped[str] = mapped_column(String(500), index=True)
    mst_ban: Mapped[str] = mapped_column(String(20), default="")
    item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"))
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_warehouses.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class InvSale(Base):
    """Hoa don BAN RA cua iNut (iNut = ben ban). draft -> reviewed -> void.

    GD1 chi import + doi chieu ton kho, KHONG tao InvMove (khong tru kho).
    """

    __tablename__ = "inv_sale_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_hd: Mapped[str] = mapped_column(String(20), default="")
    ky_hieu: Mapped[str] = mapped_column(String(20), default="")
    mst_mua: Mapped[str] = mapped_column(String(20), default="", index=True)  # ben MUA (khach)
    ten_mua: Mapped[str] = mapped_column(String(255), default="")
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    ngay: Mapped[str] = mapped_column(String(10), default="")
    tong_truoc_thue: Mapped[float] = mapped_column(default=0.0)
    tong_thue: Mapped[float] = mapped_column(default=0.0)
    tong_tien: Mapped[float] = mapped_column(default=0.0)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # xml|pdf|scan_ai|manual
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    doc_suffix: Mapped[str] = mapped_column(String(10), default=".pdf")
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)  # draft|reviewed|void
    is_dieu_chinh: Mapped[bool] = mapped_column(default=False)  # HD dieu chinh/thay the -> bo qua kho
    dc_ref: Mapped[str] = mapped_column(String(255), default="")  # "HD so 22 C25TPK"
    confidence: Mapped[float] = mapped_column(default=1.0)
    warnings: Mapped[str] = mapped_column(Text, default="[]")
    dup_of: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer | None"] = relationship()
    lines: Mapped[list["InvSaleLine"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class InvSaleLine(Base):
    __tablename__ = "inv_sale_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("inv_sale_invoices.id"), index=True
    )
    stt: Mapped[int] = mapped_column(default=0)
    ten_raw: Mapped[str] = mapped_column(String(500), default="")
    dvt: Mapped[str] = mapped_column(String(50), default="")
    so_luong: Mapped[float] = mapped_column(default=0.0)
    don_gia_ban: Mapped[float] = mapped_column(default=0.0)
    thanh_tien: Mapped[float] = mapped_column(default=0.0)
    thue_suat: Mapped[float] = mapped_column(default=0.0)
    thue_kct: Mapped[bool] = mapped_column(default=False)  # KCT (khong chiu thue) -> phan mem
    item_id: Mapped[int | None] = mapped_column(ForeignKey("inv_items.id"), nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_warehouses.id"), nullable=True
    )
    match_kind: Mapped[str] = mapped_column(String(10), default="none")  # exact|fuzzy|manual|new|none
    line_class: Mapped[str] = mapped_column(String(10), default="other")  # inut|camera|phan_mem|other
    fulfil_kind: Mapped[str] = mapped_column(String(10), default="none")  # ton|sx|doanh_thu|none
    confidence: Mapped[float] = mapped_column(default=1.0)
    warnings: Mapped[str] = mapped_column(Text, default="[]")

    invoice: Mapped["InvSale"] = relationship(back_populates="lines")
    item: Mapped["InvItem | None"] = relationship()


class InvIssue(Base):
    """Phieu xuat kho (ban hang)."""

    __tablename__ = "inv_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_ct: Mapped[str] = mapped_column(String(20), default="")  # so chung tu (sinh khi post)
    ngay: Mapped[str] = mapped_column(String(10), default="")
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    # truy vet: PX nay xuat cho hoa don ban nao (sinh tu generate_from_sale)
    sale_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_sale_invoices.id"), nullable=True, index=True
    )
    # muc dich xuat: ban | san_xuat | noi_bo | dieu_chuyen | huy -> dinh khoan goi y
    muc_dich: Mapped[str] = mapped_column(String(12), default="ban")
    ly_do: Mapped[str] = mapped_column(String(255), default="")  # ly do xuat (tach khoi note)
    nguoi_nhan: Mapped[str] = mapped_column(String(150), default="")
    bo_phan: Mapped[str] = mapped_column(String(150), default="")
    tk_no: Mapped[str] = mapped_column(String(10), default="")  # dinh khoan goi y
    tk_co: Mapped[str] = mapped_column(String(10), default="")
    tong_gia_von: Mapped[float] = mapped_column(default=0.0)  # luu khi post
    created_by: Mapped[int | None] = mapped_column(nullable=True)  # nguoi lap phieu
    note: Mapped[str] = mapped_column(String(500), default="")
    # ghi so du am kho (user thua nhan sai, se nhap bu) — ly do luu o ly_do
    am_kho_override: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer | None"] = relationship()
    lines: Mapped[list["InvIssueLine"]] = relationship(
        back_populates="issue", cascade="all, delete-orphan"
    )


class InvIssueLine(Base):
    __tablename__ = "inv_issue_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("inv_issues.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("inv_warehouses.id"))
    so_luong: Mapped[float] = mapped_column(default=0.0)
    don_gia_ban: Mapped[float] = mapped_column(default=0.0)  # gia ban (tuy chon)
    # gia von "dong bang" tai thoi diem post (copy tu InvMove.gia_tri) -> chung tu
    # khong doi khi replay lai; = 0 khi con draft.
    gia_von: Mapped[float] = mapped_column(default=0.0)
    thanh_tien_ban: Mapped[float] = mapped_column(default=0.0)  # so_luong * don_gia_ban

    issue: Mapped["InvIssue"] = relationship(back_populates="lines")
    item: Mapped["InvItem"] = relationship()


class InvProduction(Base):
    """Lenh san xuat: tieu hao NVL/HH -> nhap thanh pham theo gia thanh."""

    __tablename__ = "inv_productions"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_ct: Mapped[str] = mapped_column(String(20), default="")  # so chung tu (sinh khi post)
    ngay: Mapped[str] = mapped_column(String(10), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(String(500), default="")  # mo ta (AI sinh)
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)
    recipe_id: Mapped[int | None] = mapped_column(nullable=True)  # cong thuc goc (so dinh muc)
    cp_nhan_cong: Mapped[float] = mapped_column(default=0.0)  # 622 - nhap tay
    cp_sxc: Mapped[float] = mapped_column(default=0.0)  # 627 - nhap tay
    tong_gia_thanh: Mapped[float] = mapped_column(default=0.0)  # luu khi post
    gia_ban_du_kien: Mapped[float] = mapped_column(default=0.0)  # /dvi TP -> tinh ti suat
    # truy vet: LSX nay san xuat cho hoa don ban / dong nao
    sale_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_sale_invoices.id"), nullable=True
    )
    sale_line_id: Mapped[int | None] = mapped_column(nullable=True)
    lot_number: Mapped[str] = mapped_column(String(100), default="")
    serial_numbers: Mapped[str] = mapped_column(Text, default="")
    mfg_date: Mapped[str] = mapped_column(String(20), default="")
    exp_date: Mapped[str] = mapped_column(String(20), default="")
    # ghi so du am kho NVL (user thua nhan sai, se nhap bu) — ly do luu o note
    am_kho_override: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["InvProductionLine"]] = relationship(
        back_populates="production", cascade="all, delete-orphan"
    )


class InvProductionLine(Base):
    __tablename__ = "inv_production_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    production_id: Mapped[int] = mapped_column(
        ForeignKey("inv_productions.id"), index=True
    )
    chieu: Mapped[str] = mapped_column(String(3))  # vao (tieu hao) | ra (thanh pham)
    item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("inv_warehouses.id"))
    so_luong: Mapped[float] = mapped_column(default=0.0)
    # gia tam tinh (khi NVL chua co gia von tai ngay SX) - chi dong tieu hao 'vao'
    don_gia_tam: Mapped[float] = mapped_column(default=0.0)
    lot_number: Mapped[str] = mapped_column(String(100), default="")
    serial_numbers: Mapped[str] = mapped_column(Text, default="")
    # thay mat hang tuong tu: ly do + mat hang goc bi thay (fork cong thuc)
    note: Mapped[str] = mapped_column(String(255), default="")
    orig_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_items.id"), nullable=True
    )

    production: Mapped["InvProduction"] = relationship(back_populates="lines")
    item: Mapped["InvItem"] = relationship(foreign_keys=[item_id])


class InvRecipe(Base):
    """Cong thuc san xuat (dinh muc NVL cho 1 thanh pham) de dung lai."""

    __tablename__ = "inv_recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    output_item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"))
    output_qty: Mapped[float] = mapped_column(default=1.0)
    parent_id: Mapped[int | None] = mapped_column(nullable=True)  # cong thuc goc khi fork
    note: Mapped[str] = mapped_column(String(500), default="")  # ly do fork / ghi chu
    description: Mapped[str] = mapped_column(String(500), default="")  # mo ta (AI sinh)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    output_item: Mapped["InvItem"] = relationship()
    lines: Mapped[list["InvRecipeLine"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan"
    )


class InvRecipeLine(Base):
    __tablename__ = "inv_recipe_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("inv_recipes.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inv_items.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("inv_warehouses.id"))
    so_luong: Mapped[float] = mapped_column(default=0.0)

    recipe: Mapped["InvRecipe"] = relationship(back_populates="lines")
    item: Mapped["InvItem"] = relationship()


class InvCustomsDecl(Base):
    """To khai nhap khau (VNACCS 7N) da parse tu Excel — draft -> posted (nhap kho)."""

    __tablename__ = "inv_customs_decls"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_to_khai: Mapped[str] = mapped_column(String(15), unique=True, index=True)
    ngay_dang_ky: Mapped[str] = mapped_column(String(10), default="")
    ma_loai_hinh: Mapped[str] = mapped_column(String(5), default="")
    phan_luong: Mapped[str] = mapped_column(String(1), default="")
    co_quan_hq: Mapped[str] = mapped_column(String(20), default="")
    nguoi_xk: Mapped[str] = mapped_column(String(255), default="")
    nuoc_xk: Mapped[str] = mapped_column(String(5), default="")
    so_van_don: Mapped[str] = mapped_column(String(50), default="")
    so_hoa_don: Mapped[str] = mapped_column(String(50), default="")
    ngay_hoa_don: Mapped[str] = mapped_column(String(10), default="")
    phuong_thuc_tt: Mapped[str] = mapped_column(String(10), default="")
    incoterm: Mapped[str] = mapped_column(String(5), default="")
    nguyen_te: Mapped[str] = mapped_column(String(3), default="")
    tri_gia_nt: Mapped[float] = mapped_column(default=0.0)
    phi_ship_nt: Mapped[float] = mapped_column(default=0.0)
    ti_gia: Mapped[float] = mapped_column(default=0.0)
    tri_gia_tinh_thue: Mapped[float] = mapped_column(default=0.0)
    tong_thue_nk: Mapped[float] = mapped_column(default=0.0)
    tong_thue_vat: Mapped[float] = mapped_column(default=0.0)
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    doc_suffix: Mapped[str] = mapped_column(String(10), default=".xlsx")
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["InvCustomsLine"]] = relationship(
        back_populates="decl", cascade="all, delete-orphan"
    )
    costs: Mapped[list["InvCustomsCost"]] = relationship(
        back_populates="decl", cascade="all, delete-orphan"
    )


class InvCustomsLine(Base):
    __tablename__ = "inv_customs_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    decl_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_decls.id"), index=True)
    stt: Mapped[int] = mapped_column(default=0)
    ma_hs: Mapped[str] = mapped_column(String(12), default="")
    mo_ta: Mapped[str] = mapped_column(String(500), default="")
    so_luong: Mapped[float] = mapped_column(default=0.0)
    dvt: Mapped[str] = mapped_column(String(20), default="")
    don_gia_nt: Mapped[float] = mapped_column(default=0.0)
    tri_gia_nt: Mapped[float] = mapped_column(default=0.0)
    tri_gia_tinh_thue: Mapped[float] = mapped_column(default=0.0)
    thue_suat_nk: Mapped[float] = mapped_column(default=0.0)
    tien_thue_nk: Mapped[float] = mapped_column(default=0.0)
    thue_suat_vat: Mapped[float] = mapped_column(default=0.0)
    tien_thue_vat: Mapped[float] = mapped_column(default=0.0)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("inv_items.id"), nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("inv_warehouses.id"), nullable=True
    )
    match_kind: Mapped[str] = mapped_column(String(10), default="none")
    gia_von: Mapped[float] = mapped_column(default=0.0)

    decl: Mapped["InvCustomsDecl"] = relationship(back_populates="lines")
    item: Mapped["InvItem | None"] = relationship()


class InvCustomsCost(Base):
    """Chi phi phat sinh theo to khai: le phi HQ, TTDB, phi ngan hang... (phan bo vao gia von)."""

    __tablename__ = "inv_customs_costs"

    id: Mapped[int] = mapped_column(primary_key=True)
    decl_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_decls.id"), index=True)
    loai: Mapped[str] = mapped_column(String(20), default="")
    ten: Mapped[str] = mapped_column(String(255), default="")
    so_tien: Mapped[float] = mapped_column(default=0.0)
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    doc_suffix: Mapped[str] = mapped_column(String(10), default=".pdf")
    ghi_chu: Mapped[str] = mapped_column(String(255), default="")

    decl: Mapped["InvCustomsDecl"] = relationship(back_populates="costs")


class InvCustomsDriveSource(Base):
    """Folder Drive goc cua tung nam, chi duoc dong bo mot chieu ve CRM."""

    __tablename__ = "inv_customs_drive_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(unique=True, index=True)
    folder_id: Mapped[str] = mapped_column(String(255), unique=True)
    enabled: Mapped[bool] = mapped_column(default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    folders: Mapped[list["InvCustomsDriveFolder"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class InvCustomsDriveFolder(Base):
    __tablename__ = "inv_customs_drive_folders"
    __table_args__ = (
        UniqueConstraint("source_id", "drive_folder_id", name="uq_customs_drive_folder"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_drive_sources.id"), index=True)
    drive_folder_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(500), default="")
    path: Mapped[str] = mapped_column(String(1000), default="")
    customs_id: Mapped[int | None] = mapped_column(ForeignKey("inv_customs_decls.id"), nullable=True, index=True)
    link_status: Mapped[str] = mapped_column(String(30), default="waiting_declaration", index=True)
    dossier_status: Mapped[str] = mapped_column(String(30), default="missing_documents", index=True)
    match_reason: Mapped[str] = mapped_column(String(500), default="")
    checklist: Mapped[str] = mapped_column(Text, default="{}")
    findings: Mapped[str] = mapped_column(Text, default="[]")
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    source: Mapped["InvCustomsDriveSource"] = relationship(back_populates="folders")
    documents: Mapped[list["InvCustomsDriveDocument"]] = relationship(
        back_populates="folder", cascade="all, delete-orphan"
    )


class InvCustomsDriveDocument(Base):
    __tablename__ = "inv_customs_drive_documents"
    __table_args__ = (
        UniqueConstraint("folder_id", "drive_file_id", name="uq_customs_drive_document"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_drive_folders.id"), index=True)
    drive_file_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(500), default="")
    path: Mapped[str] = mapped_column(String(1000), default="")
    mime_type: Mapped[str] = mapped_column(String(150), default="")
    size: Mapped[int] = mapped_column(default=0)
    modified_time: Mapped[str] = mapped_column(String(50), default="")
    kind: Mapped[str] = mapped_column(String(30), default="other", index=True)
    kind_manual: Mapped[bool] = mapped_column(default=False)
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    doc_suffix: Mapped[str] = mapped_column(String(20), default="")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    parse_error: Mapped[str] = mapped_column(String(500), default="")
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    folder: Mapped["InvCustomsDriveFolder"] = relationship(back_populates="documents")


class InvCustomsEcusExport(Base):
    """PDF extracted from an ECUS attachment and optionally copied to Drive."""

    __tablename__ = "inv_customs_ecus_exports"
    __table_args__ = (
        UniqueConstraint("customs_id", "sha256", name="uq_customs_ecus_export_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customs_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_decls.id"), index=True)
    source_row_id: Mapped[str] = mapped_column(String(64), default="")
    declaration_number: Mapped[str] = mapped_column(String(15), default="", index=True)
    original_name: Mapped[str] = mapped_column(String(255), default="")
    filename: Mapped[str] = mapped_column(String(255), default="")
    sha256: Mapped[str] = mapped_column(String(64), default="", index=True)
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    doc_suffix: Mapped[str] = mapped_column(String(10), default=".pdf")
    drive_folder_id: Mapped[str] = mapped_column(String(255), default="")
    drive_path: Mapped[str] = mapped_column(String(1000), default="")
    status: Mapped[str] = mapped_column(String(20), default="extracted", index=True)
    source_time: Mapped[str] = mapped_column(String(50), default="")
    error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customs: Mapped["InvCustomsDecl"] = relationship()


class InvCustomsCheckTask(Base):
    """Task tự động định kỳ kiểm tra trạng thái tờ khai luồng vàng/đỏ từ Cổng Hải quan."""

    __tablename__ = "inv_customs_check_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    so_to_khai: Mapped[str] = mapped_column(String(20), index=True)
    ma_doanh_nghiep: Mapped[str] = mapped_column(String(20), default="4401053694")
    so_cmt: Mapped[str] = mapped_column(String(20), default="054096010424")
    folder_name: Mapped[str] = mapped_column(String(255), default="")
    phan_luong: Mapped[str] = mapped_column(String(50), default="")
    interval_minutes: Mapped[int] = mapped_column(Integer, default=60)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active, completed, paused
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status_text: Mapped[str] = mapped_column(String(100), default="")  # Đang xử lý, Hoàn thành xử lý...
    last_officer: Mapped[str] = mapped_column(String(100), default="")
    last_error: Mapped[str] = mapped_column(String(500), default="")
    ngay_thong_quan: Mapped[str] = mapped_column(String(50), default="")
    ngay_qua_kvgs: Mapped[str] = mapped_column(String(50), default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_result_json: Mapped[str] = mapped_column(Text, default="")
    telegram_notify: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_mode: Mapped[str] = mapped_column(String(20), default="always")  # always | on_change
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    logs: Mapped[list["InvCustomsCheckLog"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="desc(InvCustomsCheckLog.id)"
    )


class InvCustomsCheckLog(Base):
    """Lịch sử từng lần tự động tra cứu tờ khai hải quan."""

    __tablename__ = "inv_customs_check_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("inv_customs_check_tasks.id"), index=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    trang_thai_xu_ly: Mapped[str] = mapped_column(String(100), default="")
    cong_chuc_kiem_tra: Mapped[str] = mapped_column(String(100), default="")
    ngay_thong_quan: Mapped[str] = mapped_column(String(50), default="")
    thue_da_nop: Mapped[float] = mapped_column(Float, default=0.0)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    telegram_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    message: Mapped[str] = mapped_column(Text, default="")

    task: Mapped["InvCustomsCheckTask"] = relationship(back_populates="logs")


class TaxReviewUpload(Base):
    """File BCT (to khai GTGT) ke toan up len -> he thong cham loi + xem online.

    Luu nhieu phien ban theo ky de doi chieu (lan 1, lan 2...). File goc trong storage.
    """

    __tablename__ = "tax_review_uploads"

    id: Mapped[int] = mapped_column(primary_key=True)
    ky: Mapped[str] = mapped_column(String(20), default="", index=True)  # "2026-Q2"
    ten_file: Mapped[str] = mapped_column(String(255), default="")
    doc_id: Mapped[str] = mapped_column(String(64), default="")  # file .xlsx trong storage
    findings: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    ct_snapshot: Mapped[str] = mapped_column(Text, default="{}")  # JSON summary
    n_do: Mapped[int] = mapped_column(default=0)
    n_vang: Mapped[int] = mapped_column(default=0)
    note: Mapped[str] = mapped_column(String(500), default="")
    uploaded_by: Mapped[str] = mapped_column(String(64), default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class JobRun(Base):
    """Lich su job nen de dashboard co the bao loi thay vi nuot exception."""

    __tablename__ = "job_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    period_from: Mapped[str] = mapped_column(String(10), default="")
    period_to: Mapped[str] = mapped_column(String(10), default="")
    stats: Mapped[str] = mapped_column(Text, default="{}")
    error: Mapped[str] = mapped_column(Text, default="")
    needs_action: Mapped[bool] = mapped_column(default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TaxReport(Base):
    """Ban to khai noi bo theo quy; draft duoc cap nhat den khi khoa."""

    __tablename__ = "tax_reports"
    __table_args__ = (UniqueConstraint("ky", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ky: Mapped[str] = mapped_column(String(20), index=True)
    tu: Mapped[str] = mapped_column(String(10))
    den: Mapped[str] = mapped_column(String(10))
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)
    snapshot: Mapped[str] = mapped_column(Text, default="{}")
    warnings: Mapped[str] = mapped_column(Text, default="[]")
    doc_id: Mapped[str] = mapped_column(String(64), default="")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AppSetting(Base):
    """Cau hinh dong (key-value) sua duoc tu web — override len Settings tu .env.

    Dung cho AI endpoint (ai_*) va NAS (nas_*). Secret (password/api_key) luu thang
    (khong ma hoa trong pham vi hien tai) — chi admin sua/xem.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TqcCertificate(Base):
    """Normalized TQC CNHQ records verified from an official certificate number."""

    __tablename__ = "tqc_certificates"
    __table_args__ = (
        Index("ix_tqc_certificates_model_norm", "model_norm"),
        Index("ix_tqc_certificates_manufacturer_norm", "manufacturer_norm"),
        Index("ix_tqc_certificates_applicant_norm", "applicant_norm"),
        Index("ix_tqc_certificates_tax_code_norm", "tax_code_norm"),
        Index("ix_tqc_certificates_status", "derived_status"),
        Index("ix_tqc_certificates_expiry", "expiry_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    certificate_no: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    certificate_no_norm: Mapped[str] = mapped_column(String(120), index=True)
    tax_code: Mapped[str | None] = mapped_column(String(32), nullable=True, default="")
    tax_code_norm: Mapped[str | None] = mapped_column(String(32), nullable=True, default="")
    issue_date: Mapped[str] = mapped_column(String(40), default="")
    expiry_date: Mapped[str] = mapped_column(String(40), default="")
    applicant_name: Mapped[str] = mapped_column(String(500), default="")
    applicant_norm: Mapped[str] = mapped_column(String(500), default="")
    product_name: Mapped[str] = mapped_column(String(1000), default="")
    product_norm: Mapped[str] = mapped_column(String(1000), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    model_norm: Mapped[str] = mapped_column(String(255), default="")
    manufacturer: Mapped[str] = mapped_column(String(500), default="")
    manufacturer_norm: Mapped[str] = mapped_column(String(500), default="")
    factory_name: Mapped[str] = mapped_column(String(500), default="")
    factory_address: Mapped[str] = mapped_column(String(1000), default="")
    technical_regulations_json: Mapped[str] = mapped_column(Text, default="[]")
    certification_method: Mapped[str] = mapped_column(String(100), default="")
    serial_form_no: Mapped[str] = mapped_column(String(255), default="")
    source_status: Mapped[str] = mapped_column(String(100), default="")
    derived_status: Mapped[str] = mapped_column(String(30), default="unknown")
    verification_status: Mapped[str] = mapped_column(String(40), default="verified_cached")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SpxShipment(Base):
    """Van don giao hang qua SPX Express (spx.vn)."""

    __tablename__ = "spx_shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    tracking_no: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    order_code: Mapped[str] = mapped_column(String(50), default="", index=True)
    recipient_name: Mapped[str] = mapped_column(String(150), default="")
    recipient_phone: Mapped[str] = mapped_column(String(20), default="")
    recipient_address: Mapped[str] = mapped_column(String(500), default="")
    province: Mapped[str] = mapped_column(String(100), default="")
    district: Mapped[str] = mapped_column(String(100), default="")
    ward: Mapped[str] = mapped_column(String(100), default="")
    cod_amount: Mapped[float] = mapped_column(default=0.0)
    weight_gram: Mapped[int] = mapped_column(default=500)
    length_cm: Mapped[int] = mapped_column(default=10)
    width_cm: Mapped[int] = mapped_column(default=10)
    height_cm: Mapped[int] = mapped_column(default=10)
    item_description: Mapped[str] = mapped_column(String(500), default="")
    note: Mapped[str] = mapped_column(String(500), default="Cho xem hàng, không cho thử")
    payer: Mapped[str] = mapped_column(String(20), default="sender")  # sender | recipient
    status: Mapped[str] = mapped_column(String(30), default="ready_to_ship", index=True)  # ready_to_ship | picking | delivering | delivered | cancelled
    shipping_fee: Mapped[float] = mapped_column(default=0.0)
    label_doc_id: Mapped[str] = mapped_column(String(64), default="")
    sender_name: Mapped[str] = mapped_column(String(150), default="")
    sender_phone: Mapped[str] = mapped_column(String(20), default="")
    sender_address: Mapped[str] = mapped_column(String(500), default="")
    is_printed: Mapped[bool] = mapped_column(default=False, index=True)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)



class BiddingBookmark(Base):
    """Goi thau quan tam trong phan he Dau Thau (Mua Sam Cong)."""

    __tablename__ = "bidding_bookmarks"

    id: Mapped[int] = mapped_column(primary_key=True)
    tbmt_code: Mapped[str] = mapped_column(String(50), default="", index=True)
    tender_name: Mapped[str] = mapped_column(String(500), default="")
    procuring_entity: Mapped[str] = mapped_column(String(255), default="")
    investor: Mapped[str] = mapped_column(String(255), default="")
    field: Mapped[str] = mapped_column(String(100), default="", index=True)
    bid_price: Mapped[float] = mapped_column(default=0.0)
    bid_deadline: Mapped[str] = mapped_column(String(100), default="")
    bid_opening_date: Mapped[str] = mapped_column(String(100), default="")
    province: Mapped[str] = mapped_column(String(100), default="", index=True)
    bidding_method: Mapped[str] = mapped_column(String(150), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    status: Mapped[str] = mapped_column(String(30), default="watching", index=True)  # watching | preparing | submitted | won | lost
    note: Mapped[str] = mapped_column(Text, default="")
    ai_summary: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class BiddingWatchlist(Base):
    """Quy tac theo doi tu dong goi thau (Watchlist & Canh Bao Telegram)."""

    __tablename__ = "bidding_watchlists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    keyword: Mapped[str] = mapped_column(String(255), default="")
    province: Mapped[str] = mapped_column(String(100), default="")
    field: Mapped[str] = mapped_column(String(100), default="")
    min_price: Mapped[float] = mapped_column(default=0.0)
    max_price: Mapped[float] = mapped_column(default=0.0)
    method: Mapped[str] = mapped_column(String(150), default="")
    notify_telegram: Mapped[bool] = mapped_column(default=True)
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class BiddingAlertLog(Base):
    """Nhat ky canh bao tranh spam trung lap goi thau da ban tin."""

    __tablename__ = "bidding_alert_logs"
    __table_args__ = (
        UniqueConstraint("watchlist_id", "tbmt_code", name="uq_bidding_alert_watchlist_tbmt"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    watchlist_id: Mapped[int] = mapped_column(
        ForeignKey("bidding_watchlists.id", ondelete="CASCADE"), index=True
    )
    tbmt_code: Mapped[str] = mapped_column(String(50), index=True)
    alerted_at: Mapped[datetime] = mapped_column(DateTime, default=_now)



class BiddingDossierReview(Base):
    """Báo cáo Thẩm định Hồ sơ Thầu Toàn Diện & Tình Báo Đấu Thầu (Dossier Review)."""

    __tablename__ = "bidding_dossier_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    tbmt_code: Mapped[str] = mapped_column(String(50), default="", index=True)
    package_name: Mapped[str] = mapped_column(String(500), default="")
    procuring_entity: Mapped[str] = mapped_column(String(255), default="")
    contractor_name: Mapped[str] = mapped_column(String(255), default="")
    contractor_tax_code: Mapped[str] = mapped_column(String(50), default="")
    drive_folder_url: Mapped[str] = mapped_column(String(1000), default="")
    drive_folder_id: Mapped[str] = mapped_column(String(100), default="")
    total_bid_price: Mapped[float] = mapped_column(default=0.0)
    estimated_package_price: Mapped[float] = mapped_column(default=0.0)
    discount_amount: Mapped[float] = mapped_column(default=0.0)
    discount_rate_pct: Mapped[float] = mapped_column(default=0.0)
    overall_score: Mapped[int] = mapped_column(default=90)
    compliance_status: Mapped[str] = mapped_column(String(30), default="needs_revision", index=True)  # qualified | needs_revision | high_risk
    executive_summary: Mapped[str] = mapped_column(Text, default="")
    recommendations_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class BiddingDossierFileReview(Base):
    """Thẩm định chi tiết độc lập từng tệp tài liệu trong hồ sơ dự thầu."""

    __tablename__ = "bidding_dossier_file_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("bidding_dossier_reviews.id", ondelete="CASCADE"), index=True)
    file_code: Mapped[str] = mapped_column(String(20), default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_title: Mapped[str] = mapped_column(String(500), default="")
    doc_type: Mapped[str] = mapped_column(String(50), default="technical")
    compliance_status: Mapped[str] = mapped_column(String(30), default="pass")  # pass | warning | fail
    score: Mapped[int] = mapped_column(default=100)
    findings: Mapped[str] = mapped_column(Text, default="")
    critical_risks: Mapped[str] = mapped_column(Text, default="")
    remediation: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class BiddingDossierItemReview(Base):
    """Đánh giá chi tiết từng hạng mục thiết bị trong Bảng đối chiếu kỹ thuật & Bảng giá."""

    __tablename__ = "bidding_dossier_item_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("bidding_dossier_reviews.id", ondelete="CASCADE"), index=True)
    item_no: Mapped[int] = mapped_column(default=1)
    system_id: Mapped[str] = mapped_column(String(50), default="")
    item_name: Mapped[str] = mapped_column(String(500), default="")
    proposed_model: Mapped[str] = mapped_column(String(255), default="")
    manufacturer: Mapped[str] = mapped_column(String(255), default="")
    origin: Mapped[str] = mapped_column(String(100), default="")
    unit: Mapped[str] = mapped_column(String(50), default="bộ")
    quantity: Mapped[float] = mapped_column(default=1.0)
    unit_price: Mapped[float] = mapped_column(default=0.0)
    total_price: Mapped[float] = mapped_column(default=0.0)
    compliance_status: Mapped[str] = mapped_column(String(30), default="compliant")  # compliant | clarification_needed | non_compliant
    proof_documents: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    inut_role: Mapped[str] = mapped_column(String(100), default="")

class IpTrademark(Base):
    """Nhan hieu / Van bang so huu tri tue (Cuc SHTT / WIPO Publish)."""

    __tablename__ = "ip_trademarks"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    application_id: Mapped[str] = mapped_column(String(50), default="", index=True)
    registration_number: Mapped[str] = mapped_column(String(50), default="", index=True)
    mark_name: Mapped[str] = mapped_column(String(255), default="", index=True)
    owner_name: Mapped[str] = mapped_column(String(500), default="")
    owner_address: Mapped[str] = mapped_column(String(500), default="")
    filing_date: Mapped[str] = mapped_column(String(20), default="")
    publication_date: Mapped[str] = mapped_column(String(20), default="")
    grant_date: Mapped[str] = mapped_column(String(20), default="")
    expiry_date: Mapped[str] = mapped_column(String(20), default="")
    nice_classes: Mapped[str] = mapped_column(String(100), default="")
    goods_services: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50), default="", index=True)
    colors: Mapped[str] = mapped_column(String(255), default="")
    mark_type: Mapped[str] = mapped_column(String(50), default="")
    remote_logo_url: Mapped[str] = mapped_column(String(1000), default="")
    logo_doc_id: Mapped[str] = mapped_column(String(64), default="")
    logo_suffix: Mapped[str] = mapped_column(String(10), default=".jpg")
    renewal_window_start: Mapped[str] = mapped_column(String(20), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

_engine = None
_SessionLocal = None



def _init_engine():
    global _engine, _SessionLocal
    if _engine is not None:
        return
    db_path = get_settings().data_path / "ksp.db"
    _engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    _init_engine()
    Base.metadata.create_all(_engine)
    _migrate_add_columns()
    _seed_warehouses()
    _seed_customs_drive_sources()
    _seed_pymid_catalog()

    _seed_ip_trademarks()
    _seed_piecework_contracts()
    _seed_bidding_reviews()
def _seed_warehouses() -> None:
    """Tao 3 kho mac dinh neu chua co."""
    with _SessionLocal() as db:
        if db.query(InvWarehouse).count() == 0:
            db.add_all([
                InvWarehouse(code="HH", name="Hàng hóa"),
                InvWarehouse(code="NVL", name="Nguyên vật liệu"),
                InvWarehouse(code="TP", name="Thành phẩm"),
            ])
            db.commit()


def _seed_customs_drive_sources() -> None:
    """Cau hinh san folder ho so nhap khau nam 2026 da duoc phe duyet."""
    with _SessionLocal() as db:
        if db.scalar(select(InvCustomsDriveSource).where(InvCustomsDriveSource.year == 2026)) is None:
            db.add(InvCustomsDriveSource(year=2026,
                                         folder_id="1yg_TqCrWS4dDx-O-bYYhfktFq1OdNk9z"))
            db.commit()

def _seed_piecework_contracts() -> None:
    """Khởi tạo sẵn 3 hợp đồng khoán mẫu thực tế cho CRM với đầy đủ chứng từ thực."""
    import io
    import json
    from . import storage
    from .piecework_api import render_piecework_pdf
    from PIL import Image, ImageDraw
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    def _make_id_card(name: str, cccd: str, dob: str, addr: str) -> tuple[str, str]:
        img_f = Image.new("RGB", (856, 540), color=(240, 248, 255))
        d_f = ImageDraw.Draw(img_f)
        d_f.rectangle([10, 10, 846, 530], outline=(2, 132, 199), width=5)
        d_f.rectangle([10, 10, 846, 85], fill=(2, 132, 199))
        d_f.text((30, 25), "CONG HOA XA HOI CHU NGHIA VIET NAM", fill=(255, 255, 255))
        d_f.text((30, 50), "CAN CUOC CONG DAN / CITIZEN IDENTITY CARD", fill=(255, 255, 255))
        d_f.rectangle([40, 120, 240, 380], outline=(148, 163, 184), width=2, fill=(226, 232, 240))
        d_f.text((80, 240), "[ ANH THE ]", fill=(100, 116, 139))
        d_f.text((280, 130), f"So / No.: {cccd}", fill=(185, 28, 28))
        d_f.text((280, 180), f"Ho va ten: {name.upper()}", fill=(15, 23, 42))
        d_f.text((280, 230), f"Ngay sinh / Date of birth: {dob}", fill=(15, 23, 42))
        d_f.text((280, 280), "Quoc tich / Nationality: Viet Nam", fill=(15, 23, 42))
        d_f.text((280, 330), f"Noi thuong tru: {addr}", fill=(15, 23, 42))
        buf_f = io.BytesIO()
        img_f.save(buf_f, format="JPEG", quality=92)
        f_id = storage.save_upload(buf_f.getvalue(), suffix=".jpg")

        img_b = Image.new("RGB", (856, 540), color=(248, 250, 252))
        d_b = ImageDraw.Draw(img_b)
        d_b.rectangle([10, 10, 846, 530], outline=(2, 132, 199), width=5)
        d_b.rectangle([60, 60, 200, 180], outline=(202, 138, 4), fill=(254, 240, 138), width=3)
        d_b.text((90, 110), "[ CHIP ]", fill=(133, 77, 14))
        d_b.rectangle([40, 380, 816, 500], fill=(226, 232, 240))
        d_b.text((60, 400), f"IDVNM{cccd}<<<<<<<<<<<<<<<", fill=(30, 41, 59))
        d_b.text((60, 430), f"{name.upper()}<<<<<<<<<<<<<<<<<<<<<<", fill=(30, 41, 59))
        buf_b = io.BytesIO()
        img_b.save(buf_b, format="JPEG", quality=92)
        b_id = storage.save_upload(buf_b.getvalue(), suffix=".jpg")
        return f_id, b_id

    def _make_photo(title: str, desc: str) -> str:
        img = Image.new("RGB", (1280, 720), color=(15, 23, 42))
        d = ImageDraw.Draw(img)
        d.rectangle([15, 15, 1265, 705], outline=(56, 189, 248), width=5)
        d.text((50, 60), "INUT TECHNOLOGY & COMPLIANCE - PROOF OF WORK", fill=(56, 189, 248))
        d.text((50, 130), title, fill=(255, 255, 255))
        d.text((50, 190), desc, fill=(203, 213, 225))
        d.text((50, 640), "GPS: Verified | Timestamp: Verified | Site Installation OK", fill=(148, 163, 184))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        return storage.save_upload(buf.getvalue(), suffix=".jpg")

    def _make_pdf(title: str, lines: list[str]) -> str:
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(50, 800, title)
        c.setFont("Helvetica", 11)
        y = 750
        for it in lines:
            c.drawString(50, y, it)
            y -= 22
        c.save()
        return storage.save_upload(buf.getvalue(), suffix=".pdf")

    def _make_face(name: str) -> tuple[str, str]:
        import base64
        img = Image.new("RGB", (480, 640), color=(241, 245, 249))
        d = ImageDraw.Draw(img)
        d.rectangle([10, 10, 470, 630], outline=(2, 132, 199), width=4)
        d.ellipse([140, 140, 340, 340], outline=(15, 23, 42), fill=(254, 215, 170), width=3)
        d.ellipse([180, 200, 210, 230], fill=(30, 41, 59))
        d.ellipse([270, 200, 300, 230], fill=(30, 41, 59))
        d.arc([200, 260, 280, 300], start=0, end=180, fill=(185, 28, 28), width=3)
        d.rectangle([100, 380, 380, 620], outline=(15, 23, 42), fill=(59, 130, 246), width=3)
        d.rectangle([20, 20, 460, 65], fill=(15, 23, 42))
        d.text((30, 32), f"eKYC: {name.upper()}", fill=(56, 189, 248))
        d.text((30, 590), "VERIFIED LIVE CAMERA CAPTURE AT SIGNING", fill=(100, 116, 139))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        raw_b = buf.getvalue()
        doc_id = storage.save_upload(raw_b, suffix=".jpg")
        data_url = "data:image/jpeg;base64," + base64.b64encode(raw_b).decode("ascii")
        return doc_id, data_url

    with _SessionLocal() as db:
        if db.query(PieceworkContractor).count() == 0:
            db.add_all([
                PieceworkContractor(
                    id=1,
                    code="CTV-HAI-4512",
                    name="Lê Văn Hải",
                    id_card="038092004512",
                    id_card_date="2022-04-15",
                    id_card_place="Cục Cảnh sát QLHC về TTXH",
                    tax_code="8492004512",
                    phone="0961 197 999",
                    address="Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa",
                    bank_account="19034567891011",
                    bank_name="Techcombank",
                    skills="Lắp đặt Kiosk VNMAP AI, căn chỉnh tủ điện, thiết bị đọc thẻ CCCD",
                    notes="Nhà cung cấp khoán thi công Thanh Hóa quen thuộc",
                ),
                PieceworkContractor(
                    id=2,
                    code="CTV-DUNG-8231",
                    name="Hoàng Văn Dũng",
                    id_card="014095008231",
                    id_card_date="2023-08-20",
                    id_card_place="Cục Cảnh sát QLHC về TTXH",
                    tax_code="8500823190",
                    phone="0865 949 205",
                    address="Bản Chiềng Đi, Xã Vân Hồ, Huyện Vân Hồ, Tỉnh Sơn La",
                    bank_account="101872057703",
                    bank_name="VietinBank",
                    skills="Khảo sát cơ khí, dựng trụ đo mực nước, kéo cáp RS485",
                    notes="Thợ thi công cơ khí trạm quan trắc Sơn La",
                ),
                PieceworkContractor(
                    id=3,
                    code="CTV-BAO-1874",
                    name="Trần Quốc Bảo",
                    id_card="066093001874",
                    id_card_date="2021-11-05",
                    id_card_place="Cục Cảnh sát QLHC về TTXH",
                    tax_code="8660930018",
                    phone="0916 089 573",
                    address="Phường 7, TP. Tuy Hòa, Tỉnh Đắk Lắk",
                    bank_account="0916089573",
                    bank_name="VPBank",
                    skills="Bốc dỡ hàng, kiểm đếm linh kiện webcam, dán tem nhãn kho",
                    notes="Cộng tác viên kho hàng thiết bị iNut Đắk Lắk",
                ),
            ])
            db.commit()

    with _SessionLocal() as db:
        if db.scalar(select(AppSetting).where(AppSetting.key == "piecework_seed_disabled")):
            return
        if db.query(PieceworkContract).count() == 0:
            # Generate assets for C1
            c1_f, c1_b = _make_id_card("Lê Văn Hải", "038092004512", "15/04/1992", "Tổ 2, Phường Đông Sơn, TP. Thanh Hóa")
            c1_p1 = _make_photo("KIOSK VNMAP AI ONE - PHUONG DONG SON", "Hinh anh lap dat Kiosk tai Bo phan Mot cua UBND Phuong")
            c1_p2 = _make_photo("DAU NOI DAU DOC CCCD DTA VERIBOX S", "Hinh anh thu nghiem doc the CCCD PACE-CAM hoat dong tot")
            c1_acc = _make_pdf("BIEN BAN NGHIEM THU HOAN THANH CONG VIEC", [
                "Cong trinh: Kiosk VNMAP AI ONE - Phuong Dong Son, TP. Thanh Hoa",
                "Nguoi nhan khoan: Le Van Hai - CCCD: 038092004512",
                "Gia tri: 4,500,000 VND - Danh gia: Dat tieu chuan",
                "Ngay nghiem thu: 29/09/2026"
            ])
            c1_face_id, c1_face_data = _make_face("Lê Văn Hải")

            # Generate assets for C2
            c2_f, _ = _make_id_card("Hoàng Văn Dũng", "014095008231", "20/08/1995", "Bản Chiềng Đi, Xã Vân Hồ, Sơn La")
            c2_p1 = _make_photo("TRAM DO MUC NUOC CAM BIEN HCRZ-LL100 SON LA", "Hinh anh dung tru do bo ke suoi Nam La")

            # Generate assets for C3
            c3_f, c3_b = _make_id_card("Trần Quốc Bảo", "066093001874", "05/11/1993", "Phường 7, TP. Tuy Hòa, Đắk Lắk")
            c3_acc = _make_pdf("BIEN BAN NGHIEM THU BOC XEP & DONG GOI", [
                "Hang muc: Kho hang thiet bi iNut - Lo 60 Webcam 11MP",
                "Nguoi nhan khoan: Tran Quoc Bao - CCCD: 066093001874",
                "Gia tri: 2,800,000 VND - Ngay: 25/09/2026"
            ])
            c3_p1 = _make_photo("KHO THIET BI INUT DAK LAK", "Kiem dem 60 bo webcam 11MP Song Long")
            c3_p2 = _make_photo("DAN TEM NHAN THONG SO KY THUAT", "Dan tem nhan 70x45mm hoan tat")
            c3_unc = _make_pdf("UY NHIEM CHI - TECHCOMBANK 79713", [
                "Don vi tra tien: CONG TY CO PHAN DAU TU VA PHAT TRIEN CONG NGHE INUT",
                "Tai khoan: 79713 tai Techcombank",
                "Don vi thu huong: TRAN QUOC BAO - TK: 0916089573 tai VPBank",
                "So tien: 2,800,000 VND - Giao dich thanh cong ngay 25/09/2026"
            ])

            contracts = [
                PieceworkContract(
                    contract_code="01/2026/HĐGK-DONGSON",
                    contract_type="thi_cong",
                    title="Hợp đồng giao khoán thi công lắp đặt Kiosk VNMAP AI ONE tại UBND Phường Đông Sơn",
                    project_name="Kiosk VNMAP AI ONE - Phường Đông Sơn, TP. Thanh Hóa",
                    location="Bộ phận Một cửa UBND Phường Đông Sơn, TP. Thanh Hóa",
                    contract_date="2026-09-28",
                    worker_name="Lê Văn Hải",
                    worker_id_card="038092004512",
                    worker_id_card_date="2022-04-15",
                    worker_id_card_place="Cục Cảnh sát QLHC về TTXH",
                    worker_tax_code="8492004512",
                    worker_phone="0961 197 999",
                    worker_address="Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa",
                    worker_bank_account="19034567891011",
                    worker_bank_name="Techcombank",
                    total_amount=4500000.0,
                    tax_rate=0.0,
                    tax_amount=0.0,
                    net_amount=4500000.0,
                    items_json=json.dumps([
                        {"ten": "Thi công lắp đặt chân đế, cân chỉnh Kiosk, đấu nối nguồn điện và mạng LAN bảo mật", "dvt": "Gói", "so_luong": 1, "don_gia": 2000000, "thanh_tien": 2000000},
                        {"ten": "Lắp đặt và hiệu chỉnh đầu đọc thẻ CCCD eMRTD (DTA VeriBOX S / Hanel HN212)", "dvt": "Gói", "so_luong": 1, "don_gia": 1500000, "thanh_tien": 1500000},
                        {"ten": "Kiểm thử luồng nộp hồ sơ DVC và hướng dẫn vận hành tại chỗ", "dvt": "Buổi", "so_luong": 1, "don_gia": 1000000, "thanh_tien": 1000000}
                    ], ensure_ascii=False),
                    note="Khoán dưới 5 triệu đồng theo Khoản 2 Điều 50 Nghị định 253/2026/NĐ-CP (Miễn khấu trừ 10% thuế TNCN).",
                    status="ready_to_pay",
                    has_id_card_front=True,
                    has_id_card_back=True,
                    id_card_front_doc_id=c1_f,
                    id_card_back_doc_id=c1_b,
                    has_acceptance=True,
                    acceptance_doc_id=c1_acc,
                    site_photos_json=json.dumps([c1_p1, c1_p2]),
                    has_tax_commitment=False,
                    has_bank_proof=False,
                    is_signed_by_worker=True,
                    worker_face_doc_id=c1_face_id,
                    worker_face_photo_data=c1_face_data,
                    worker_signed_at=datetime(2026, 9, 29, 16, 30, tzinfo=timezone.utc),
                    is_signed_by_inut=True,
                    inut_signed_at=datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc),
                    portal_token="dongson-kiosk-token-849200",
                ),
                PieceworkContract(
                    contract_code="02/2026/HĐGK-SONLA-LL100",
                    contract_type="thi_cong",
                    title="Hợp đồng giao khoán khảo sát, dựng trụ và lắp đặt trạm đo mực nước cảm biến HCRZ-LL100 tại Sơn La",
                    project_name="Trạm quan trắc cảnh báo lũ tự động - Cảm biến LL100 Sơn La",
                    location="Suối Nậm La, Phường Quyết Tâm, TP. Sơn La, Tỉnh Sơn La",
                    contract_date="2026-10-02",
                    worker_name="Hoàng Văn Dũng",
                    worker_id_card="014095008231",
                    worker_id_card_date="2023-08-20",
                    worker_id_card_place="Cục Cảnh sát QLHC về TTXH",
                    worker_tax_code="8500823190",
                    worker_phone="0865 949 205",
                    worker_address="Bản Chiềng Đi, Xã Vân Hồ, Huyện Vân Hồ, Tỉnh Sơn La",
                    worker_bank_account="101872057703",
                    worker_bank_name="VietinBank",
                    total_amount=6000000.0,
                    tax_rate=10.0,
                    tax_amount=600000.0,
                    net_amount=5400000.0,
                    items_json=json.dumps([
                        {"ten": "Gia công cơ khí giá đỡ và dựng trụ đo cảm biến mực nước tại bờ kè suối", "dvt": "Trụ", "so_luong": 1, "don_gia": 3500000, "thanh_tien": 3500000},
                        {"ten": "Kéo cáp tín hiệu RS485 và đấu nối vào tủ Datalogger iNut PC", "dvt": "Tủ", "so_luong": 1, "don_gia": 2500000, "thanh_tien": 2500000}
                    ], ensure_ascii=False),
                    note="Giá trị từ 5.000.000đ trở lên, bắt buộc khấu trừ 10% thuế TNCN theo Nghị định 253/2026/NĐ-CP (hoặc nộp Cam kết thuế 08/CK-TNCN).",
                    status="pending_docs",
                    has_id_card_front=True,
                    has_id_card_back=False,
                    id_card_front_doc_id=c2_f,
                    has_acceptance=False,
                    site_photos_json=json.dumps([c2_p1]),
                    has_tax_commitment=False,
                    has_bank_proof=False,
                    is_signed_by_worker=False,
                    is_signed_by_inut=True,
                    inut_signed_at=datetime(2026, 10, 2, 8, 41, 12, tzinfo=timezone.utc),
                    portal_token="sonla-ll100-token-850082",
                ),
                PieceworkContract(
                    contract_code="03/2026/HĐGK-DAKLAK-WEBCAM",
                    contract_type="boc_xep",
                    title="Hợp đồng giao khoán bốc dỡ, kiểm đếm và dán tem đóng gói 60 webcam 11MP tại kho iNut Đắk Lắk",
                    project_name="Kho hàng thiết bị iNut - Lô 60 Webcam 11MP Song Long",
                    location="161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk",
                    contract_date="2026-09-24",
                    worker_name="Trần Quốc Bảo",
                    worker_id_card="066093001874",
                    worker_id_card_date="2021-11-05",
                    worker_id_card_place="Cục Cảnh sát QLHC về TTXH",
                    worker_tax_code="8660930018",
                    worker_phone="0916 089 573",
                    worker_address="Phường 7, TP. Tuy Hòa, Tỉnh Đắk Lắk",
                    worker_bank_account="0916089573",
                    worker_bank_name="VPBank",
                    total_amount=2800000.0,
                    tax_rate=0.0,
                    tax_amount=0.0,
                    net_amount=2800000.0,
                    items_json=json.dumps([
                        {"ten": "Bốc dỡ kiện hàng linh kiện camera và webcam từ xe chuyển phát vào kho", "dvt": "Chuyến", "so_luong": 1, "don_gia": 1200000, "thanh_tien": 1200000},
                        {"ten": "Mở hộp, kiểm tra ngoại quan và dán tem nhãn thông số kỹ thuật 60 bộ", "dvt": "Lô", "so_luong": 1, "don_gia": 1600000, "thanh_tien": 1600000}
                    ], ensure_ascii=False),
                    note="Đã hoàn tất nghiệm thu và chuyển khoản thanh toán 100% từ TK Techcombank 79713.",
                    status="completed",
                    has_id_card_front=True,
                    has_id_card_back=True,
                    id_card_front_doc_id=c3_f,
                    id_card_back_doc_id=c3_b,
                    has_acceptance=True,
                    acceptance_doc_id=c3_acc,
                    site_photos_json=json.dumps([c3_p1, c3_p2]),
                    has_tax_commitment=False,
                    has_bank_proof=True,
                    bank_proof_doc_id=c3_unc,
                    is_signed_by_worker=True,
                    worker_signed_at=datetime(2026, 9, 25, 11, 23, 49, tzinfo=timezone.utc),
                    is_signed_by_inut=True,
                    inut_signed_at=datetime(2026, 9, 24, 14, 18, 36, tzinfo=timezone.utc),
                    portal_token="daklak-webcam-token-866093",
                )
            ]
            for c in contracts:
                pdf_bytes = render_piecework_pdf(c)
                if c.is_signed_by_inut and c.inut_signed_at:
                    try:
                        from .piecework_api import sign_piecework_pdf_pyhanko
                        pdf_bytes = sign_piecework_pdf_pyhanko(pdf_bytes, c.inut_signed_at)
                    except Exception:
                        pass
                c.contract_pdf_doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
            db.add_all(contracts)
            db.commit()

def _seed_bidding_reviews() -> None:
    """Khởi tạo sẵn hồ sơ thẩm định thầu dự án Thủy lợi Sơn La IB2600557773."""
    import json
    with _SessionLocal() as db:
        if db.query(BiddingDossierReview).count() == 0:
            rec_list = [
                "SỬA GẤP FILE 06: Điền ngay số km và cung đường thực tế vào 12 ô placeholder trước khi nộp lên E-GP (Bản Mòn: 22km; Chiềng Khoi: 64km; Suối Chiếu: 128km; Suối Hòm: 145km).",
                "LẤY VĂN BẢN HÃNG INUT: Nhận Giấy cam kết hỗ trợ kỹ thuật P2P/LAN và giải pháp chống sét SPD của INUT Technology (MST 4401053694) đính kèm Mục 4 và Mục 17.",
                "SỬA LỖI CHÍNH TẢ FILE 01: Sửa cơ quan cấp ĐKKD từ 'Sở Tài chính' thành 'Sở Kế hoạch và Đầu tư tỉnh Sơn La'.",
                "CHIẾN LƯỢC GIÁ THẮNG THẦU: Cân nhắc nộp kèm Thư giảm giá 5% - 7% (giảm 60 - 84 triệu đồng) để nắm chắc phần thắng trước các đối thủ cạnh tranh ngoại tỉnh."
            ]
            review = BiddingDossierReview(
                tbmt_code="IB2600557773",
                package_name="Lắp đặt thiết bị quan trắc khí tượng thuỷ văn chuyên dùng và tài nguyên nước các hồ chứa (Bản Mòn, Suối Hòm, Suối Chiếu, Chiềng Khoi)",
                procuring_entity="Công ty TNHH MTV Quản lý, khai thác công trình thủy lợi Sơn La",
                contractor_name="CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HÓA IOT",
                contractor_tax_code="5500649200",
                drive_folder_url="https://drive.google.com/drive/folders/1l17rxMHd4-B988GJ3cwIBmFGCC3oazHV",
                drive_folder_id="1l17rxMHd4-B988GJ3cwIBmFGCC3oazHV",
                total_bid_price=1194900000.0,
                estimated_package_price=1199656000.0,
                discount_amount=4756000.0,
                discount_rate_pct=0.39,
                overall_score=96,
                compliance_status="needs_revision",
                executive_summary="Hồ sơ thầu đạt 96/100 điểm, có năng lực pháp lý, tài chính và kinh nghiệm vượt trội nhờ đã hoàn thành dự án quan trắc hồ Chiềng Dong cho chính Chủ đầu tư. Có 2 điểm nóng cần khắc phục ngay trước khi nộp thầu: 1) Bảng cung đường vận chuyển ở File 06 còn để placeholder; 2) Cần kẹp Văn bản cam kết kỹ thuật của hãng sản xuất INUT Technology.",
                recommendations_json=json.dumps(rec_list, ensure_ascii=False),
            )
            db.add(review)
            db.flush()

            # Seed 9 file reviews
            files = [
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="01",
                    file_name="01_Thuyet_minh_nang_luc_phap_ly.docx",
                    file_title="Bản thuyết minh tư cách hợp lệ và năng lực pháp lý nhà thầu",
                    doc_type="legal",
                    compliance_status="warning",
                    score=95,
                    findings="Tư cách hợp lệ đầy đủ theo Luật Đấu thầu số 22/2023/QH15. Vốn điều lệ 9 tỷ đồng. ĐKKD đủ các mã ngành 2651, 3320, 6290, 6310 phù hợp gói thầu.",
                    critical_risks="Kê khai nhầm cơ quan cấp ĐKKD là 'Sở Tài chính tỉnh Sơn La'. Cơ quan có thẩm quyền theo Nghị định 01/2021/NĐ-CP là Sở Kế hoạch và Đầu tư.",
                    remediation="Hiệu chỉnh lại cơ quan cấp thành 'Phòng Đăng ký kinh doanh - Sở Kế hoạch và Đầu tư tỉnh Sơn La'.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="02",
                    file_name="02_Mau_05A_Hop_dong_tuong_tu.docx",
                    file_title="Mẫu số 05A. Hợp đồng tương tự do nhà thầu thực hiện",
                    doc_type="experience",
                    compliance_status="pass",
                    score=100,
                    findings="Hợp đồng hồ Chiềng Dong HD2500183146_2511071031 ngày 10/11/2025 giá trị 973.296.000 VNĐ, hoàn thành 10/12/2025. Cùng Chủ đầu tư Thủy lợi Sơn La.",
                    critical_risks="Không có rủi ro. Giá trị đạt 162.3% mức tối thiểu yêu cầu (≥ 599.828.000 VNĐ).",
                    remediation="Đính kèm đầy đủ file PDF hợp nhất Hợp đồng + Biên bản nghiệm thu + Biên bản thanh lý.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="03",
                    file_name="03_Mau_08_Tinh_hinh_tai_chinh.docx",
                    file_title="Mẫu số 08. Tình hình tài chính của nhà thầu",
                    doc_type="finance",
                    compliance_status="pass",
                    score=100,
                    findings="Doanh thu bình quân 3 năm đạt 4.638.982.217 VNĐ (vượt 283.5% yêu cầu ≥ 1.635.895.000 VNĐ). Giá trị tài sản ròng 2025 dương (15.359.501.900 VNĐ). Lợi nhuận sau thuế dương cả 3 năm.",
                    critical_risks="Không có rủi ro. Có xác nhận không nợ thuế đến 30/09/2026.",
                    remediation="Kiểm tra đối chiếu số liệu khớp từng dòng với Báo cáo tài chính nộp Tổng cục Thuế.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="04",
                    file_name="04_Bang_doi_chieu_ky_thuat_18_hang_muc.docx",
                    file_title="Bảng đối chiếu đáp ứng kỹ thuật 18 hạng mục (Mẫu 10B)",
                    doc_type="technical",
                    compliance_status="warning",
                    score=92,
                    findings="15/18 hạng mục đáp ứng xuất sắc. Cảm biến radar HCRZ-LD100-A2 dải 70m vượt yêu cầu 20m. Camera Hikvision 4MP vượt yêu cầu 2MP.",
                    critical_risks="Ghi chú mục 4 ghi 'CHƯA ĐỦ CĂN CỨ VỀ LAN/P2P' và mục 17 ghi 'CẦN XÁC NHẬN GIẢI PHÁP CHỐNG SÉT'. Có nguy cơ bị yêu cầu làm rõ.",
                    remediation="Lấy Giấy cam kết hỗ trợ kỹ thuật và bảo hành của Hãng sản xuất INUT Technology đính kèm hồ sơ.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="05",
                    file_name="05_Thuyet_minh_giai_phap_ky_thuat.docx",
                    file_title="Thuyết minh giải pháp kỹ thuật lắp đặt thiết bị quan trắc",
                    doc_type="technical",
                    compliance_status="pass",
                    score=96,
                    findings="Kiến trúc SCADA/IoT đồng bộ 4 trạm hồ chứa (Bản Mòn, Suối Hòm, Suối Chiếu, Chiềng Khoi). Giao thức MQTT/Modbus chuẩn công nghiệp, lưu trữ lịch sử > 10 năm.",
                    critical_risks="Không có rủi ro nghiêm trọng.",
                    remediation="Chuẩn bị sẵn tài liệu thuyết minh kiến trúc mở để bảo vệ trong giai đoạn thương thảo.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="06",
                    file_name="06_Bien_phap_to_chuc_cung_cap_lap_dat.docx",
                    file_title="Biện pháp tổ chức cung cấp, lắp đặt hàng hóa và cung đường vận chuyển",
                    doc_type="installation",
                    compliance_status="fail",
                    score=70,
                    findings="Biện pháp an toàn thi công mép nước (áo phao 100%, dây bảo hiểm neo cố định) và PCCC rất tốt.",
                    critical_risks="RỦI RO CHÍ MẠNG: Bảng cung đường Table 2 còn để 12 ô placeholder [CẦN NHÀ THẦU XÁC NHẬN...]. Nộp lên E-GP sẽ bị đánh FAIL Tiêu chí 2.2!",
                    remediation="Điền ngay bảng cự ly chuẩn: Bản Mòn 22km; Chiềng Khoi 64km; Suối Chiếu 128km; Suối Hòm 145km.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="07",
                    file_name="07_Cam_ket_bao_hanh_bao_tri_48h.docx",
                    file_title="Bản cam kết bảo hành, bảo trì và dịch vụ sau bán hàng",
                    doc_type="warranty",
                    compliance_status="pass",
                    score=100,
                    findings="Bảo hành 12 tháng, bảo trì 6 tháng/lần, xử lý sự cố có mặt trong 48 giờ. Bàn giao 100% mã nguồn phần mềm và tài khoản Admin.",
                    critical_risks="Không có rủi ro. Cam kết bàn giao mã nguồn là điểm cộng vượt trội.",
                    remediation="Giữ nguyên cam kết, đây là thế mạnh cạnh tranh lớn.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="08",
                    file_name="08_Mau_10A_Tien_do_cung_cap.docx",
                    file_title="Mẫu số 10A. Bảng tiến độ cung cấp hàng hóa và lắp đặt thiết bị",
                    doc_type="schedule",
                    compliance_status="pass",
                    score=98,
                    findings="Tiến độ 60 ngày trọn gói kể từ ngày hợp đồng có hiệu lực. Phân kỳ hợp lý theo 4 giai đoạn cuốn chiếu 2 mũi thi công.",
                    critical_risks="Cần lưu ý thời tiết mưa lũ sạt lở đèo Chẹn sang Phù Yên.",
                    remediation="Chủ động tập kết vật tư cơ khí và tủ điện sớm trong 15 ngày đầu.",
                ),
                BiddingDossierFileReview(
                    review_id=review.id,
                    file_code="09",
                    file_name="09_Mau_12_1A_Bang_gia_du_thau.docx",
                    file_title="Mẫu số 12.1A. Bảng giá dự thầu của hàng hóa (Hợp đồng trọn gói)",
                    doc_type="pricing",
                    compliance_status="pass",
                    score=95,
                    findings="Tổng giá dự thầu 1.194.900.000 VNĐ. Biên lợi nhuận gộp ước tính đạt ~63.6% (lãi ~760 triệu đồng) do tự chủ thiết bị INUT và phần mềm.",
                    critical_risks="Mức giảm giá hiện tại chỉ 0.39% (4.756.000 đ). Nếu đối thủ giảm 3-5% sẽ bị mất điểm giá.",
                    remediation="Cân nhắc nộp Thư giảm giá chiến lược 5% - 7% để thắng thầu áp đảo.",
                ),
            ]
            db.add_all(files)

            # Seed 18 equipment items
            items = [
                BiddingDossierItemReview(
                    review_id=review.id, item_no=1, system_id="9712321004573360",
                    item_name="Cảm biến đo mực nước hồ dải đo 0-20m",
                    proposed_model="HCRZ-LD100-A2", manufacturer="Xiamen Haichuan Runze IoT", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=27000000.0, total_price=108000000.0,
                    compliance_status="compliant",
                    proof_documents="Catalog chính hãng: radar 0.3-70m, sai số ±3mm, RS485, IP67",
                    notes="Đáp ứng vượt yêu cầu kỹ thuật", inut_role="Đối tác nhập khẩu",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=2, system_id="10372511277793344",
                    item_name="Cảm biến đo mưa kiểu gầu lật",
                    proposed_model="RD-RG-S", manufacturer="HONDE TECHNOLOGY", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=27000000.0, total_price=108000000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet độ phân giải 0.1mm, sai số ≤ ±2%, xung/RS485",
                    notes="Giấy kiểm định đo lường bàn giao trước vận hành", inut_role="Đối tác nhập khẩu",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=3, system_id="9690885214865814",
                    item_name="Cảm biến đo độ mở cống xả môi trường 0-3m",
                    proposed_model="MPS-M-3000MM-A2", manufacturer="Miran Technology", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=21600000.0, total_price=86400000.0,
                    compliance_status="compliant",
                    proof_documents="Catalogue kéo dây 3000mm, 4-20mA/RS485, IP65 kèm hộp bảo vệ",
                    notes="Đáp ứng kèm hộp bảo vệ kỹ thuật ngoài trời", inut_role="Đối tác nhập khẩu",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=4, system_id="7311694621595033",
                    item_name="Bộ truyền nhận dữ liệu hỗ trợ Modbus RS485 qua Wifi/LAN/Internet, Web/App",
                    proposed_model="iNut RS485 Wi-Fi", manufacturer="iNut", origin="Việt Nam",
                    unit="bộ", quantity=4.0, unit_price=27000000.0, total_price=108000000.0,
                    compliance_status="clarification_needed",
                    proof_documents="Catalog iNut RS485: Modbus RTU, Wi-Fi, MQTT, Web/App, 10-30VDC",
                    notes="Cần Giấy xác nhận hỗ trợ kỹ thuật của Hãng INUT về tính năng LAN/P2P", inut_role="Nhà sản xuất OEM",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=5, system_id="11229152944446910",
                    item_name="Bộ chuyển đổi tín hiệu Analog sang RS485",
                    proposed_model="Z-4AI", manufacturer="Seneca", origin="Italy",
                    unit="bộ", quantity=4.0, unit_price=4860000.0, total_price=19440000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet 4 kênh Analog 16-bit, RS485 Modbus RTU, CE",
                    notes="Đáp ứng xuất sắc tiêu chuẩn Châu Âu", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=6, system_id="9953576538745532",
                    item_name="Bộ chuyển đổi nguồn 220VAC/24VDC 2.5A",
                    proposed_model="MDR-60-24", manufacturer="Meanwell", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=2700000.0, total_price=10800000.0,
                    compliance_status="compliant",
                    proof_documents="Catalogue vào 85-264VAC, ra 24VDC 2.5A (60W), bảo vệ quá tải",
                    notes="Đáp ứng", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=7, system_id="10093415080698814",
                    item_name="Aptomat 2 pha hoặc tương đương",
                    proposed_model="HDB3WN2C6", manufacturer="Himel", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=135000.0, total_price=540000.0,
                    compliance_status="compliant",
                    proof_documents="MCB 2P 6A cắt 6kA phù hợp IEC 60898-1",
                    notes="Đáp ứng", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=8, system_id="8302281187678332",
                    item_name="Hệ thống camera IP ngoài trời gồm đầu ghi và 03 camera chọn bộ",
                    proposed_model="Trọn bộ HIKVISION", manufacturer="HIKVISION", origin="Trung Quốc",
                    unit="bộ", quantity=4.0, unit_price=6480000.0, total_price=25920000.0,
                    compliance_status="compliant",
                    proof_documents="Đồng bộ thương hiệu Hikvision gồm NVR + PTZ + Bullet + Switch PoE",
                    notes="Đáp ứng theo hệ thống trọn gói", inut_role="Đại lý Hikvision",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=9, system_id="10585993153809508",
                    item_name="Đầu ghi camera: 4 kênh IP AcuSense",
                    proposed_model="DS-7604NXI-K1", manufacturer="HIKVISION", origin="Trung Quốc",
                    unit="Cái", quantity=4.0, unit_price=3780000.0, total_price=15120000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet 4 kênh IP, 12MP, H.265+, 4K HDMI, AI AcuSense",
                    notes="Đáp ứng", inut_role="Đại lý Hikvision",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=10, system_id="11720770932610216",
                    item_name="Camera soi mực nước hồ và toàn cảnh hồ giám sát an ninh",
                    proposed_model="DS-2DE4425IWG1-EHUN (VIE LH)", manufacturer="HIKVISION", origin="Trung Quốc",
                    unit="Cái", quantity=4.0, unit_price=18360000.0, total_price=73440000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet 4MP, zoom quang 25x, IR 100m, quay 360°, IP67, mic/loa",
                    notes="Đáp ứng vượt trội yêu cầu E-HSMT", inut_role="Đại lý Hikvision",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=11, system_id="7187374061207317",
                    item_name="Camera giám sát tràn tự do và hạ lưu xả tràn",
                    proposed_model="DS-2CD1T43G2-LIUF/SL", manufacturer="HIKVISION", origin="Trung Quốc",
                    unit="Cái", quantity=8.0, unit_price=2700000.0, total_price=21600000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet 4MP (cao hơn 2MP tham khảo), IR 50m, IP67",
                    notes="Đáp ứng", inut_role="Đại lý Hikvision",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=12, system_id="11091121408153376",
                    item_name="Switch mạng 4 cổng PoE",
                    proposed_model="DS-3E1106P-EI/M", manufacturer="HIKVISION", origin="Trung Quốc",
                    unit="Cái", quantity=4.0, unit_price=1620000.0, total_price=6480000.0,
                    compliance_status="compliant",
                    proof_documents="Datasheet 4 PoE + 2 uplink, 45W, chống sét 6kV",
                    notes="Đáp ứng", inut_role="Đại lý Hikvision",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=13, system_id="12646120897964258",
                    item_name="Vỏ tủ điện 350x400x180",
                    proposed_model="BC-AGQ-405020 (400x500x200mm)", manufacturer="BOXCO", origin="Hàn Quốc",
                    unit="Tủ", quantity=4.0, unit_price=2700000.0, total_price=10800000.0,
                    compliance_status="compliant",
                    proof_documents="Catalog BOXCO nhựa ABS, IP66/IP67, IK08, kích thước lớn hơn tối thiểu",
                    notes="Đáp ứng vượt yêu cầu kích thước và cấp bảo vệ", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=14, system_id="10488624643833576",
                    item_name="Cảm biến đo mực nước hạ lưu dải đo 0-20m",
                    proposed_model="HCRZ-LD100-A2", manufacturer="Xiamen Haichuan Runze IoT", origin="Trung Quốc",
                    unit="Bộ", quantity=1.0, unit_price=27000000.0, total_price=27000000.0,
                    compliance_status="compliant",
                    proof_documents="Đồng bộ với mục 1, radar 0.3-70m, ±3mm, RS485, IP67",
                    notes="Lắp đặt tại hồ Suối Hòm", inut_role="Đối tác nhập khẩu",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=15, system_id="10703955077008738",
                    item_name="Bộ PC máy chủ và màn hình 24 inh",
                    proposed_model="Dell ECT1250 Core i5-14400 / Dell E2425HM", manufacturer="DELL", origin="Trung Quốc",
                    unit="Bộ", quantity=3.0, unit_price=42120000.0, total_price=126360000.0,
                    compliance_status="compliant",
                    proof_documents="Tài liệu Dell: Core i5-14400, RAM DDR5, SSD NVMe, IPS FHD 24 inch",
                    notes="Đáp ứng khớp 100% cấu hình", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=16, system_id="11086600573521676",
                    item_name="Hệ điều hành",
                    proposed_model="Windows 11 Pro bản quyền", manufacturer="Microsoft", origin="Mỹ",
                    unit="Bộ", quantity=3.0, unit_price=5000000.0, total_price=15000000.0,
                    compliance_status="compliant",
                    proof_documents="Bản quyền chính hãng, tương đương/cao hơn Windows 10",
                    notes="Bàn giao khóa bản quyền hợp pháp", inut_role="Thương mại",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=17, system_id="10505899694801712",
                    item_name="Bộ Gateway/Data logger công nghiệp hoặc tương đương",
                    proposed_model="iNut Smartcity Data Logger v2 64-bit - MASTER", manufacturer="iNut", origin="Việt Nam",
                    unit="Bộ", quantity=3.0, unit_price=43200000.0, total_price=129600000.0,
                    compliance_status="clarification_needed",
                    proof_documents="Catalog iNut: ARM RK3318 64-bit, 4GB RAM, 32GB eMMC, MQTT/P2P",
                    notes="Cần bổ sung thuyết minh giải pháp chống sét lan truyền SPD tích hợp", inut_role="Nhà sản xuất OEM",
                ),
                BiddingDossierItemReview(
                    review_id=review.id, item_no=18, system_id="11395824481237872",
                    item_name="Chi phí lập trình, cấu hình phần mềm giám sát thời gian thực và kết nối truyền dữ liệu",
                    proposed_model="Phần mềm IOT SCADA", manufacturer="IOT", origin="Việt Nam",
                    unit="Bộ", quantity=4.0, unit_price=75600000.0, total_price=302400000.0,
                    compliance_status="compliant",
                    proof_documents="Tài liệu mô tả tính năng SCADA, cam kết bàn giao 100% mã nguồn (source code) và quyền Admin",
                    notes="Lợi thế cạnh tranh đột phá so với phần mềm đóng gói", inut_role="Tự phát triển",
                ),
            ]
            db.add_all(items)
            db.commit()
            print("Seeded Son La Bidding Dossier Review IB2600557773 successfully.")



def _seed_pymid_catalog() -> None:
    from .pymid import CATALOG

    with _SessionLocal() as db:
        existing = set(db.scalars(select(PymidCoopProduct.code)))
        rows = [PymidCoopProduct(**item) for item in CATALOG if item["code"] not in existing]
        if rows:
            db.add_all(rows)
            db.commit()


def _seed_standards_benchmarks() -> None:
    """Khoi tao tap du lieu chuan (benchmark) cho tra cuu QCVN va MST neu chua co."""
    from .standards import seed_benchmark_certificates

    with _SessionLocal() as db:
        seed_benchmark_certificates(db)


def _seed_ip_trademarks() -> None:
    """Khoi tao du lieu mac dinh 5 don nhan hieu INUT neu chua co."""
    from .trademark import seed_inut_trademarks

    with _SessionLocal() as db:
        seed_inut_trademarks(db)

def _migrate_add_columns() -> None:
    """Them cot moi vao bang da ton tai (SQLite create_all khong tu ALTER)."""
    from sqlalchemy import text

    wanted = {
        "tqc_certificates": {
            "tax_code": "VARCHAR(32) DEFAULT ''",
            "tax_code_norm": "VARCHAR(32) DEFAULT ''",
        },
        "documents": {
            "nas_path": "VARCHAR(500) DEFAULT ''",
            "nas_synced_at": "DATETIME",
            "doc_type": "VARCHAR(20) DEFAULT ''",
            "signed_upload_id": "VARCHAR(64) DEFAULT ''",
            "signed_upload_name": "VARCHAR(255) DEFAULT ''",
            "signed_upload_at": "DATETIME",
            "order_id": "INTEGER",
            "source_system": "VARCHAR(30) DEFAULT ''",
            "source_external_id": "VARCHAR(100) DEFAULT ''",
            "source_synced_at": "DATETIME",
        },
        "customers": {
            "address": "VARCHAR(500) DEFAULT ''",
            "email": "VARCHAR(255) DEFAULT ''",
            "logo_url": "VARCHAR(1000) DEFAULT ''",
        },
        "users": {
            "display_name": "VARCHAR(150) DEFAULT ''",
            "session_version": "INTEGER DEFAULT 1",
            "must_change_password": "BOOLEAN DEFAULT 0",
            "training_access": "BOOLEAN DEFAULT 0",
        },
        "training_queries": {
            "answer_json": "TEXT DEFAULT '{}'",
        },
        "facebook_messages": {
            "sender_name": "VARCHAR(255) DEFAULT ''",
            "processing_started_at": "DATETIME",
            "replied_at": "DATETIME",
            "queue_latency_ms": "INTEGER DEFAULT 0",
            "latency_ms": "INTEGER DEFAULT 0",
            "hermes_latency_ms": "INTEGER DEFAULT 0",
            "context_latency_ms": "INTEGER DEFAULT 0",
            "send_latency_ms": "INTEGER DEFAULT 0",
            "profile_lookup_ms": "INTEGER DEFAULT 0",
        },
        "inv_purchase_invoices": {
            "loai": "VARCHAR(10) DEFAULT 'hang_hoa'",
            "nas_path": "VARCHAR(500) DEFAULT ''",
            "nas_synced_at": "DATETIME",
            "nas_sha256": "VARCHAR(64) DEFAULT ''",
        },
        "inv_productions": {
            "sale_id": "INTEGER",
            "sale_line_id": "INTEGER",
            "so_ct": "VARCHAR(20) DEFAULT ''",
            "description": "VARCHAR(500) DEFAULT ''",
            "recipe_id": "INTEGER",
            "cp_nhan_cong": "FLOAT DEFAULT 0",
            "cp_sxc": "FLOAT DEFAULT 0",
            "tong_gia_thanh": "FLOAT DEFAULT 0",
            "gia_ban_du_kien": "FLOAT DEFAULT 0",
            "am_kho_override": "BOOLEAN DEFAULT 0",
            "lot_number": "VARCHAR(100) DEFAULT ''",
            "serial_numbers": "TEXT DEFAULT ''",
            "mfg_date": "VARCHAR(20) DEFAULT ''",
            "exp_date": "VARCHAR(20) DEFAULT ''",
        },
        "inv_production_lines": {
            "note": "VARCHAR(255) DEFAULT ''",
            "orig_item_id": "INTEGER",
            "don_gia_tam": "FLOAT DEFAULT 0",
            "lot_number": "VARCHAR(100) DEFAULT ''",
            "serial_numbers": "TEXT DEFAULT ''",
        },
        "inv_moves": {
            "lot_number": "VARCHAR(100) DEFAULT ''",
            "serial_numbers": "TEXT DEFAULT ''",
        },
        "inv_recipes": {
            "parent_id": "INTEGER",
            "note": "VARCHAR(500) DEFAULT ''",
            "description": "VARCHAR(500) DEFAULT ''",
        },
        "inv_issues": {
            "so_ct": "VARCHAR(20) DEFAULT ''",
            "muc_dich": "VARCHAR(12) DEFAULT 'ban'",
            "ly_do": "VARCHAR(255) DEFAULT ''",
            "nguoi_nhan": "VARCHAR(150) DEFAULT ''",
            "bo_phan": "VARCHAR(150) DEFAULT ''",
            "tk_no": "VARCHAR(10) DEFAULT ''",
            "tk_co": "VARCHAR(10) DEFAULT ''",
            "tong_gia_von": "FLOAT DEFAULT 0",
            "created_by": "INTEGER",
            "sale_id": "INTEGER",
            "am_kho_override": "BOOLEAN DEFAULT 0",
        },
        "inv_issue_lines": {
            "gia_von": "FLOAT DEFAULT 0",
            "thanh_tien_ban": "FLOAT DEFAULT 0",
        },
        "inv_customs_drive_documents": {
            "kind_manual": "BOOLEAN DEFAULT 0",
        },
        "contract_drafts": {
            "version": "INTEGER DEFAULT 1",
            "status": "VARCHAR(20) DEFAULT 'draft'",
            "document_id": "INTEGER",
            "finalized_at": "DATETIME",
        },
        "bidding_bookmarks": {
            "tbmt_code": "VARCHAR(50) DEFAULT ''",
            "tender_name": "VARCHAR(500) DEFAULT ''",
            "procuring_entity": "VARCHAR(255) DEFAULT ''",
            "investor": "VARCHAR(255) DEFAULT ''",
            "field": "VARCHAR(100) DEFAULT ''",
            "bid_price": "FLOAT DEFAULT 0",
            "bid_deadline": "VARCHAR(100) DEFAULT ''",
            "bid_opening_date": "VARCHAR(100) DEFAULT ''",
            "province": "VARCHAR(100) DEFAULT ''",
            "bidding_method": "VARCHAR(150) DEFAULT ''",
            "source_url": "VARCHAR(1000) DEFAULT ''",
            "status": "VARCHAR(30) DEFAULT 'watching'",
            "note": "TEXT DEFAULT ''",
            "ai_summary": "TEXT DEFAULT ''",
            "created_by": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "bidding_watchlists": {
            "name": "VARCHAR(255) DEFAULT ''",
            "keyword": "VARCHAR(255) DEFAULT ''",
            "province": "VARCHAR(100) DEFAULT ''",
            "field": "VARCHAR(100) DEFAULT ''",
            "min_price": "FLOAT DEFAULT 0",
            "max_price": "FLOAT DEFAULT 0",
            "method": "VARCHAR(150) DEFAULT ''",
            "notify_telegram": "BOOLEAN DEFAULT 1",
            "is_active": "BOOLEAN DEFAULT 1",
            "last_checked_at": "DATETIME",
            "created_by": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "bidding_alert_logs": {
            "watchlist_id": "INTEGER",
            "tbmt_code": "VARCHAR(50) DEFAULT ''",
            "alerted_at": "DATETIME",
        },
        "spx_shipments": {
            "order_code": "VARCHAR(100) DEFAULT ''",
            "recipient_name": "VARCHAR(255) DEFAULT ''",
            "recipient_phone": "VARCHAR(50) DEFAULT ''",
            "recipient_address": "VARCHAR(500) DEFAULT ''",
            "province": "VARCHAR(100) DEFAULT ''",
            "district": "VARCHAR(100) DEFAULT ''",
            "ward": "VARCHAR(100) DEFAULT ''",
            "cod_amount": "FLOAT DEFAULT 0",
            "weight_gram": "FLOAT DEFAULT 0",
            "length_cm": "FLOAT DEFAULT 0",
            "width_cm": "FLOAT DEFAULT 0",
            "height_cm": "FLOAT DEFAULT 0",
            "item_description": "TEXT DEFAULT ''",
            "note": "VARCHAR(500) DEFAULT ''",
            "payer": "VARCHAR(50) DEFAULT 'SENDER'",
            "status": "VARCHAR(50) DEFAULT 'READY_TO_SHIP'",
            "shipping_fee": "FLOAT DEFAULT 0",
            "label_doc_id": "INTEGER",
            "sender_name": "VARCHAR(255) DEFAULT ''",
            "sender_phone": "VARCHAR(50) DEFAULT ''",
            "sender_address": "VARCHAR(500) DEFAULT ''",
            "is_printed": "BOOLEAN DEFAULT 0",
            "printed_at": "DATETIME",
        },
        "ip_trademarks": {
            "application_number": "VARCHAR(50) DEFAULT ''",
            "application_id": "VARCHAR(50) DEFAULT ''",
            "registration_number": "VARCHAR(50) DEFAULT ''",
            "mark_name": "VARCHAR(255) DEFAULT ''",
            "owner_name": "VARCHAR(500) DEFAULT ''",
            "owner_address": "VARCHAR(500) DEFAULT ''",
            "filing_date": "VARCHAR(20) DEFAULT ''",
            "publication_date": "VARCHAR(20) DEFAULT ''",
            "grant_date": "VARCHAR(20) DEFAULT ''",
            "expiry_date": "VARCHAR(20) DEFAULT ''",
            "nice_classes": "VARCHAR(100) DEFAULT ''",
            "goods_services": "TEXT DEFAULT ''",
            "status": "VARCHAR(50) DEFAULT ''",
            "colors": "VARCHAR(255) DEFAULT ''",
            "mark_type": "VARCHAR(50) DEFAULT ''",
            "remote_logo_url": "VARCHAR(1000) DEFAULT ''",
            "logo_doc_id": "VARCHAR(64) DEFAULT ''",
            "logo_suffix": "VARCHAR(10) DEFAULT '.jpg'",
            "renewal_window_start": "VARCHAR(20) DEFAULT ''",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "piecework_contracts": {
            "worker_face_photo_data": "TEXT DEFAULT ''",
            "worker_face_doc_id": "VARCHAR(64) DEFAULT ''",
            "contractor_id": "INTEGER DEFAULT NULL",
            "drive_synced_at": "DATETIME DEFAULT NULL",
            "drive_folder": "VARCHAR(255) DEFAULT ''",
            "drive_link": "VARCHAR(500) DEFAULT ''",
        },
    }
    with _engine.begin() as conn:
        for table, cols in wanted.items():
            existing = {
                r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tqc_certificates_tax_code_norm ON tqc_certificates(tax_code_norm)"))


def get_session():
    """Dependency FastAPI: cung cap 1 Session, tu dong dong."""
    _init_engine()
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def reset_engine_for_tests() -> None:
    """Cho test: quen engine cu de tao lai theo DATA_DIR moi."""
    global _engine, _SessionLocal
    _engine = None
    _SessionLocal = None
