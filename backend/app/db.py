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
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="customer")  # admin|customer
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

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
        },
        "customers": {
            "address": "VARCHAR(500) DEFAULT ''",
            "email": "VARCHAR(255) DEFAULT ''",
        },
        "inv_purchase_invoices": {
            "loai": "VARCHAR(10) DEFAULT 'hang_hoa'",
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
        },
        "inv_issue_lines": {
            "gia_von": "FLOAT DEFAULT 0",
            "thanh_tien_ban": "FLOAT DEFAULT 0",
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
