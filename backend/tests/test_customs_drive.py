from __future__ import annotations

from app.customs_drive import (
    classify_customs_document,
    extract_declaration_numbers,
    review_dossier,
)


def test_extract_declaration_numbers_only_accepts_12_digits():
    assert extract_declaration_numbers("2026/108286660050/CI-108286660050.pdf") == {"108286660050"}
    assert extract_declaration_numbers("invoice-2026-001.pdf") == set()


def test_classify_core_customs_documents_from_names_and_content():
    assert classify_customs_document("Commercial Invoice 01.pdf", "") == "ci"
    assert classify_customs_document("PACKING-LIST.xlsx", "") == "pl"
    assert classify_customs_document("CO form E.pdf", "CERTIFICATE OF ORIGIN") == "coo"
    assert classify_customs_document("bill.pdf", "BILL OF LADING") == "bill_of_lading"
    assert classify_customs_document("ToKhaiHQ7N.xlsx", "") == "customs_declaration"


def test_review_dossier_accepts_coo_or_origin_china_and_flags_missing_docs():
    complete = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "COMMERCIAL INVOICE ORIGIN: CHINA"},
        {"kind": "pl", "text": "PACKING LIST"},
    ])
    assert complete["status"] == "needs_review"
    assert complete["checklist"]["origin"]["state"] == "review"
    assert complete["checklist"]["ci"]["state"] == "ok"

    missing = review_dossier([{"kind": "customs_declaration", "text": ""}])
    assert missing["status"] == "missing_documents"
    assert {item["code"] for item in missing["findings"]} >= {"missing_ci", "missing_pl", "missing_origin"}


def test_review_dossier_flags_conflicting_origin_between_ci_and_pl():
    result = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "ORIGIN CHINA"},
        {"kind": "pl", "text": "MADE IN VIETNAM"},
    ])
    assert any(item["code"] == "origin_conflict" for item in result["findings"])
