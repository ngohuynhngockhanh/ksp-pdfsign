"""Ket noi CSDL (SQLite) + khai bao ORM."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
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

    customer: Mapped["Customer | None"] = relationship(back_populates="documents")


class Share(Base):
    """Link chia se cong khai (khong can dang nhap) toi mot ho so, co han."""

    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    document: Mapped["Document"] = relationship()


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
        },
        "customers": {
            "address": "VARCHAR(500) DEFAULT ''",
            "email": "VARCHAR(255) DEFAULT ''",
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
