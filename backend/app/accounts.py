"""Tien ich tai khoan khach hang: ten dang nhap slug + mat khau mac dinh."""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Customer, User
from .security import hash_password


def slug_username(name: str) -> str:
    s = unicodedata.normalize("NFD", name)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "D").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def default_password(tax_code: str) -> str:
    m = (tax_code or "").strip()
    return (m if m else "") + "inut12345"


def ensure_account(db: Session, customer: Customer) -> tuple[str, str]:
    """Bao dam khach hang co tai khoan; reset ve mat khau mac dinh.

    Tra ve (username, password) de gui cho khach.
    """
    password = default_password(customer.tax_code)
    u = db.scalar(select(User).where(User.customer_id == customer.id))
    if u:
        username = u.username
        u.password_hash = hash_password(password)
    else:
        username = slug_username(customer.name) or f"kh{customer.id}"
        if db.scalar(select(User).where(User.username == username)):
            username = f"{username}_{customer.id}"
        db.add(User(
            username=username, password_hash=hash_password(password),
            role="customer", customer_id=customer.id,
        ))
    db.commit()
    return username, password
