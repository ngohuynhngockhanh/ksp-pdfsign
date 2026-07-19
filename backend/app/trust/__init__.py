"""Nap cac chung thu goc tin cay (WIN-CA + Root CA quoc gia VNRCA).

Dat cac file .cer/.crt/.pem cua CA vao thu muc nay; tat ca se duoc nap
lam trust root khi kiem tra chu ky.
"""
from __future__ import annotations

from pathlib import Path

from asn1crypto import pem, x509

from ..config import Settings

_EXTS = {".pem", ".crt", ".cer", ".der"}


def _load_one(path: Path) -> list[x509.Certificate]:
    data = path.read_bytes()
    certs: list[x509.Certificate] = []
    if pem.detect(data):
        for _, _, der in pem.unarmor(data, multiple=True):
            certs.append(x509.Certificate.load(der))
    else:
        certs.append(x509.Certificate.load(data))
    return certs


def load_trust_roots(settings: Settings) -> list[x509.Certificate]:
    roots: list[x509.Certificate] = []
    for path in sorted(settings.trust_path.iterdir()):
        if path.suffix.lower() in _EXTS:
            try:
                roots.extend(_load_one(path))
            except Exception:
                # Bo qua file loi, khong lam sap qua trinh kiem tra.
                continue
    return roots
