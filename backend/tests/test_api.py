"""Test tang HTTP: login -> upload -> sign -> verify (agent duoc mock)."""
from __future__ import annotations

import datetime
import io
import zipfile

import pytest

pytest.importorskip("pyhanko")
pytest.importorskip("fastapi")

from cryptography import x509 as cx509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _key_cert():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = cx509.Name([cx509.NameAttribute(NameOID.COMMON_NAME, "API Test Signer")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        cx509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(cx509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            cx509.KeyUsage(
                digital_signature=True, content_commitment=True, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
    b"0000000052 00000 n \n0000000101 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n"
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_ENABLED", "false")  # khong dong bo NAS that khi test
    from app.config import get_settings

    get_settings.cache_clear()

    from app import db as dbmod
    from app import token_backend, verify
    from app.auth import ensure_admin_seed
    from asn1crypto import x509 as ax509

    # DB moi theo tmp_path + seed admin
    dbmod.reset_engine_for_tests()
    dbmod.init_db()
    gen = dbmod.get_session()
    _s = next(gen)
    ensure_admin_seed(_s, get_settings())
    gen.close()

    key, cert = _key_cert()
    cert_der = cert.public_bytes(serialization.Encoding.DER)

    monkeypatch.setattr(
        token_backend, "get_cert_chain", lambda s, ip, pw, cid: [cert_der]
    )

    def fake_sign_raw(s, agent, cid, data, alg):
        h = {"sha256": hashes.SHA256}[alg]()
        return key.sign(data, padding.PKCS1v15(), h)

    monkeypatch.setattr(token_backend, "sign_raw", fake_sign_raw)
    monkeypatch.setattr(
        verify, "load_trust_roots", lambda s: [ax509.Certificate.load(cert_der)]
    )

    from app.main import app

    return TestClient(app)


def _login(client):
    r = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200


def test_requires_auth(client):
    assert client.post("/api/upload").status_code == 401


def test_login_bad(client):
    r = client.post("/api/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_full_flow(client):
    _login(client)
    up = client.post("/api/upload", files={"file": ("t.pdf", PDF, "application/pdf")})
    assert up.status_code == 200
    doc_id = up.json()["doc_id"]

    sign = client.post(
        "/api/sign",
        json={
            "doc_id": doc_id,
            "rect": {"page": 0, "x1": 350, "y1": 50, "x2": 560, "y2": 130},
            "cert_id": "test",
            "agent": {"ip": "127.0.0.1", "admin_password": "NhapHang123", "pin": "1234"},
            "reason": "Duyet",
            "location": "Ha Noi",
            "signer_name": "",
        },
    )
    assert sign.status_code == 200, sign.text
    signed_id = sign.json()["doc_id"]

    signed_pdf = client.get(f"/api/download/{signed_id}")
    assert signed_pdf.status_code == 200

    ver = client.post(
        "/api/verify",
        files={"file": ("signed.pdf", signed_pdf.content, "application/pdf")},
    )
    assert ver.status_code == 200, ver.text
    body = ver.json()
    assert body["signature_count"] == 1
    sig = body["signatures"][0]
    assert sig["intact"] and sig["valid"] and sig["trusted"]


def _sign_one(client, customer_id=None):
    up = client.post("/api/upload", files={"file": ("t.pdf", PDF, "application/pdf")})
    doc_id = up.json()["doc_id"]
    return client.post(
        "/api/sign",
        json={
            "doc_id": doc_id,
            "rect": {"page": 0, "x1": 350, "y1": 50, "x2": 560, "y2": 130},
            "cert_id": "test",
            "agent": {"ip": "127.0.0.1", "admin_password": "NhapHang123", "pin": "1"},
            "reason": "", "location": "", "signer_name": "",
            "filename": "hopdong.pdf", "customer_id": customer_id,
        },
    )


def test_customer_account_and_documents(client):
    _login(client)
    # Tao khach hang + tai khoan
    r = client.post("/api/customers", json={
        "name": "Khach Hang A", "tax_code": "123",
        "account_username": "kha", "account_password": "matkhau123",
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json()["account_usernames"] == ["kha"]

    # Ky 1 ho so chua gan
    assert _sign_one(client).status_code == 200
    docs = client.get("/api/documents", params={"unassigned": "true"}).json()
    assert docs["total"] == 1
    docpk = docs["items"][0]["id"]

    # Gan ho so cho khach hang (phan loai bang tay)
    a = client.post(f"/api/documents/{docpk}/assign", json={"customer_id": cid})
    assert a.status_code == 200
    assert a.json()["customer_name"] == "Khach Hang A"

    # Khach hang dang nhap -> chi thay ho so cua minh
    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "kha", "password": "matkhau123"}).status_code == 200
    mine = client.get("/api/my/documents").json()
    assert len(mine) == 1 and mine[0]["id"] == docpk
    assert client.get(f"/api/documents/{docpk}/download").status_code == 200
    # Khach hang khong duoc dung route admin (chong chiem quyen)
    assert client.get("/api/customers").status_code == 403
    assert client.post("/api/upload", files={"file": ("t.pdf", PDF, "application/pdf")}).status_code == 403
    assert client.get("/api/users").status_code == 403
    assert client.post("/api/users/1/password", json={"new_password": "x"}).status_code == 403

    # Khach hang tu doi mat khau
    r = client.post("/api/me/password", json={"old_password": "matkhau123", "new_password": "moi12345@@"})
    assert r.status_code == 200
    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "kha", "password": "moi12345@@"}).status_code == 200


def test_ihoadon_customer_portal_sync_and_isolation(client, monkeypatch):
    _login(client)
    a = client.post("/api/customers", json={
        "name": "Khach Hoa Don", "tax_code": "010-123-4567",
        "account_username": "invoice_a", "account_password": "matkhau123",
    }).json()
    client.post("/api/customers", json={
        "name": "Khach Khac", "tax_code": "9999999999",
        "account_username": "invoice_b", "account_password": "matkhau123",
    })

    xml_buf = io.BytesIO()
    with zipfile.ZipFile(xml_buf, "w") as zf:
        zf.writestr("hoa-don.xml", "<HDon><MST>0101234567</MST></HDon>")

    class FakeIhoadon:
        def __init__(self, _settings): pass
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def issued_page(self, page=1, limit=100):
            assert page == 1 and limit == 100
            return {"meta": {"total": 1}, "invoices": [{
                "id": "ihd-1", "invoice_number": "00000123", "invoice_series": "C26TIN",
                "invoice_date": "2026-07-20T00:00:00", "buyer_tax_code": "0101234567",
                "customer_name": "Khach Hoa Don", "total_payment": 1100000,
                "status": "DA_XUAT", "adjustment_type": "1", "updated_at": "2026-07-20T10:00:00",
            }]}
        def invoice_pdf(self, _iid): return "HD-123.pdf", PDF
        def invoice_xml_zip(self, _iid): return "HD-123.zip", xml_buf.getvalue()

    from app import ihoadon_sync
    monkeypatch.setattr(ihoadon_sync, "Client", FakeIhoadon)
    r = client.post("/api/ihoadon/customer-sync")
    assert r.status_code == 200, r.text
    status = client.get("/api/ihoadon/customer-sync/status").json()
    assert status["total"] == 1 and status["unmatched"] == 0

    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "invoice_a", "password": "matkhau123"}).status_code == 200
    invoices = client.get("/api/my/invoices").json()
    assert len(invoices) == 1 and invoices[0]["customer_id"] == a["id"]
    iid = invoices[0]["id"]
    assert client.get(f"/api/my/invoices/{iid}/pdf").content.startswith(b"%PDF")
    assert client.get(f"/api/my/invoices/{iid}/xml").content.startswith(b"<HDon")
    packed = client.get("/api/my/download.zip")
    assert packed.status_code == 200
    with zipfile.ZipFile(io.BytesIO(packed.content)) as zf:
        assert any(x.endswith(".pdf") for x in zf.namelist())
        assert any(x.endswith(".xml") for x in zf.namelist())

    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "invoice_b", "password": "matkhau123"}).status_code == 200
    assert client.get("/api/my/invoices").json() == []
    assert client.get(f"/api/my/invoices/{iid}/pdf").status_code == 403


def test_customer_login_link(client):
    _login(client)
    customer = client.post("/api/customers", json={
        "name": "Khach Link", "tax_code": "0123456789",
        "account_username": "khach_link", "account_password": "matkhau123",
    }).json()
    made = client.post(f"/api/customers/{customer['id']}/login-link?days=7")
    assert made.status_code == 200, made.text
    path = made.json()["url"].split("/api", 1)[1]
    client.post("/api/logout")
    opened = client.get("/api" + path, follow_redirects=False)
    assert opened.status_code == 302
    assert opened.headers["location"] == "/ho-so-cua-toi"
    assert client.get("/api/me").status_code == 200


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_upload_zip(client):
    _login(client)
    data = _make_zip({
        "a.pdf": PDF,
        "sub/b.pdf": PDF,  # trong thu muc con -> chi lay ten file
        "ghi-chu.txt": b"khong phai pdf",
    })
    r = client.post(
        "/api/upload-zip", files={"file": ("bo.zip", data, "application/zip")}
    )
    assert r.status_code == 200, r.text
    files = r.json()["files"]
    assert len(files) == 2
    assert {f["filename"] for f in files} == {"a.pdf", "b.pdf"}
    assert all(f["size"] == len(PDF) for f in files)


def test_upload_zip_empty(client):
    _login(client)
    data = _make_zip({"readme.txt": b"khong co pdf nao"})
    r = client.post(
        "/api/upload-zip", files={"file": ("rong.zip", data, "application/zip")}
    )
    assert r.status_code == 400


def test_forged_admin_token_rejected(client):
    # Gia mao JWT bang secret MAC DINH cong khai -> phai bi tu choi (401),
    # vi server tu sinh secret ngau nhien.
    from jose import jwt
    forged = jwt.encode({"sub": "hacker", "uid": 999, "role": "admin", "cid": None},
                        "change-me-to-a-long-random-string", algorithm="HS256")
    client.cookies.set("ksp_session", forged)
    assert client.get("/api/customers").status_code == 401


# ---------------------------------------------------------------------------
# Gop cong ty (merge) + alias ten
# ---------------------------------------------------------------------------
def test_customer_merge(client):
    from app.db import (
        InvIssue,
        InvSale,
        get_session,
    )

    _login(client)
    # A tao truoc, B tao sau (A se la dich mac dinh theo created_at)
    ra = client.post("/api/customers", json={"name": "Cong Ty A", "tax_code": "111"})
    rb = client.post("/api/customers", json={
        "name": "Cong Ty B", "tax_code": "222",
        "account_username": "ktyb", "account_password": "matkhau123",
    })
    assert ra.status_code == 200 and rb.status_code == 200
    aid, bid = ra.json()["id"], rb.json()["id"]

    # Gan cho B: 1 ho so (qua sign) + 1 don hang
    a = _sign_one(client, customer_id=bid)
    assert a.status_code == 200
    order = client.post("/api/orders", json={"name": "DH cua B", "customer_id": bid})
    assert order.status_code == 200

    # Tao truc tiep 1 InvSale + 1 InvIssue gan cho B (khong qua HTTP vi khong co
    # route tao tay don gian cho InvSale)
    gen = get_session()
    db = next(gen)
    try:
        sale = InvSale(so_hd="1", ky_hieu="C25TAA", mst_mua="222", ten_mua="Cong Ty B",
                        customer_id=bid, ngay="2026-01-01")
        db.add(sale)
        issue = InvIssue(ngay="2026-01-01", customer_id=bid)
        db.add(issue)
        db.commit()
    finally:
        gen.close()

    # Gop B (nguon) vao A (dich)
    m = client.post("/api/customers/merge", json={"source_id": bid, "target_id": aid})
    assert m.status_code == 200, m.text
    body = m.json()
    assert body["moved"] == {"users": 1, "orders": 1, "documents": 1, "sales": 1, "issues": 1}
    assert body["target"]["id"] == aid
    assert "cong ty b" in body["target"]["aliases"]

    # B khong con
    assert client.get(f"/api/customers/{bid}").status_code == 404

    # Ca 5 loai da chuyen sang A
    docs = client.get("/api/documents", params={"customer_id": aid}).json()
    assert docs["total"] == 1
    orders = client.get("/api/orders", params={"customer_id": aid}).json()
    assert len(orders) == 1

    gen = get_session()
    db = next(gen)
    try:
        s = db.get(InvSale, sale.id)
        i = db.get(InvIssue, issue.id)
        assert s.customer_id == aid
        assert i.customer_id == aid
    finally:
        gen.close()

    # Tai khoan cua B van dang nhap duoc, gio thuoc ve A
    client.post("/api/logout")
    assert client.post(
        "/api/login", json={"username": "ktyb", "password": "matkhau123"}
    ).status_code == 200
    client.post("/api/logout")
    _login(client)

    # Parse hoa don voi ten B (viet hoa/thuong khac) -> tra ve A qua alias,
    # khong tao khach hang moi
    from app.db import Customer, get_session as _gs

    gen = _gs()
    db = next(gen)
    try:
        from app import accounts

        found = accounts.find_customer(db, "CONG TY b", "")
        assert found is not None and found.id == aid
        total_customers = db.query(Customer).count()
    finally:
        gen.close()
    assert total_customers == 1  # khong sinh khach hang moi tu B
