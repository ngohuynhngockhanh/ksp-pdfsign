"""Ket noi CSDL (SQLite) + khai bao ORM."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
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
    """Tin nhắn Messenger đã nhận/gửi, dùng để giữ ngữ cảnh theo từng PSID."""

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


def _seed_pymid_catalog() -> None:
    from .pymid import CATALOG

    with _SessionLocal() as db:
        existing = set(db.scalars(select(PymidCoopProduct.code)))
        rows = [PymidCoopProduct(**item) for item in CATALOG if item["code"] not in existing]
        if rows:
            db.add_all(rows)
            db.commit()


def _migrate_add_columns() -> None:
    """Them cot moi vao bang da ton tai (SQLite create_all khong tu ALTER)."""
    from sqlalchemy import text

    wanted = {
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
        },
        "inv_production_lines": {
            "note": "VARCHAR(255) DEFAULT ''",
            "orig_item_id": "INTEGER",
            "don_gia_tam": "FLOAT DEFAULT 0",
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
    }
    with _engine.begin() as conn:
        for table, cols in wanted.items():
            existing = {
                r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


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
