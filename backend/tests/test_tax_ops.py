from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import tax_ops
from app.db import Base, InvPurchase, InvSale, InvSaleLine


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_report_keeps_8_and_10_separate_and_never_negative_40():
    db = _db()
    sale = InvSale(ngay="2026-04-10", status="reviewed", tong_truoc_thue=300, tong_thue=26, tong_tien=326)
    sale.lines = [
        InvSaleLine(stt=1, ten_raw="A", thanh_tien=100, thue_suat=8),
        InvSaleLine(stt=2, ten_raw="B", thanh_tien=200, thue_suat=10),
    ]
    db.add(sale)
    db.add(InvPurchase(ngay="2026-05-01", status="posted", tong_truoc_thue=500, tong_thue=50, tong_tien=550))
    db.commit()

    snap, warnings = tax_ops.build_report(db, "2026-Q2")
    assert snap["split_8_base"] == 100
    assert snap["split_8_tax"] == 8
    assert snap["split_10_base"] == 200
    assert snap["split_10_tax"] == 20
    assert snap["40"] == 0
    assert snap["41"] == 22
    assert not [w for w in warnings if w["level"] == "do"]


def test_tax_api_utc_timestamp_uses_vietnam_invoice_day():
    from app import tax

    assert tax._invoice_date("2026-08-15T17:00:00Z") == "2026-08-16"
    assert tax._invoice_date("2026-08-16T09:00:00+07:00") == "2026-08-16"


def test_tax_purchase_import_falls_back_to_line_total():
    from app import tax

    result = tax.detail_to_purchase({
        "shdon": "573",
        "tdlap": "2026-08-15T17:00:00Z",
        "nbmst": "068088006912",
        "nbten": "HỘ KINH DOANH SONG LONG",
        "hdhhdvu": [{"ten": "Webcam", "sluong": 10, "dgia": 823000, "thtien": 8230000}],
    })

    assert result["ngay"] == "2026-08-16"
    assert result["tong_truoc_thue"] == 8230000
    assert result["tong_thue"] == 0
    assert result["tong_tien"] == 8230000


def test_document_state_distinguishes_missing_source(tmp_path, monkeypatch):
    class Invoice:
        doc_id = ""
        doc_suffix = ".xml"

    assert tax_ops.document_state(Invoice()) == "missing"


def test_tax_captcha_challenge_key_is_encrypted_and_tracks_run(monkeypatch):
    from app import crypto, telegram, tax
    from app.config import Settings
    from app.db import AppSetting, User

    db = _db()
    db.add(User(username="admin", password_hash="x", role="admin"))
    db.commit()
    monkeypatch.setattr(tax, "get_captcha", lambda: {"key": "challenge-key", "svg": "<svg></svg>"})
    monkeypatch.setattr(telegram, "admin_chat_ids", lambda _db: ["987654321"])
    monkeypatch.setattr(telegram, "send_tax_captcha", lambda *args, **kwargs: 1)

    settings = Settings(
        telegram_enabled=True,
        telegram_bot_token="123456789:" + "a" * 30,
        telegram_bot_username="Webinut_bot",
    )
    result = tax_ops.request_tax_captcha(db, settings, 42)
    row = db.get(AppSetting, "tax_pending_ckey")

    assert result["sent"] == 1
    assert row is not None
    assert row.value != "challenge-key"
    assert crypto.decrypt(row.value) == "challenge-key"
    assert tax_ops.pending_tax_captcha(db)["run_id"] == 42


def test_stored_tax_credentials_decrypts_prefixed_password():
    from app import crypto
    from app.db import AppSetting

    db = _db()
    db.add_all([
        AppSetting(key="tax_mst", value="4401053694"),
        AppSetting(key="tax_password_enc", value="enc:" + crypto.encrypt("secret-password")),
    ])
    db.commit()

    assert tax_ops.stored_tax_credentials(db) == ("4401053694", "secret-password")


def test_tax_sync_preserves_explicit_period_when_session_is_expired(monkeypatch):
    from app import tax

    db = _db()
    monkeypatch.setattr(tax, "check_token", lambda _token: False)
    monkeypatch.setattr(tax_ops, "request_tax_captcha", lambda *args, **kwargs: {"sent": 1, "run_id": args[-1]})

    run = tax_ops.run_tax_sync(db, "2026-07-01", "2026-08-31")

    assert run.period_from == "2026-07-01"
    assert run.period_to == "2026-08-31"
    assert run.status == "needs_action"
    assert run.needs_action is True


def test_auto_tax_sync_accepts_explicit_date_range():
    from app.tax_auto_sync import resolve_sync_range

    assert resolve_sync_range(from_date="2026-08-01", to_date="2026-08-24") == (
        "2026-08-01",
        "2026-08-24",
    )


def test_auto_tax_sync_rejects_partial_or_reversed_date_range():
    from app.tax_auto_sync import resolve_sync_range

    import pytest

    with pytest.raises(ValueError, match="đủ from_date"):
        resolve_sync_range(from_date="2026-08-01")
    with pytest.raises(ValueError, match="không được sau"):
        resolve_sync_range(from_date="2026-08-24", to_date="2026-08-01")
