from app.standards import (
    StandardsRegistryService,
    HsCodeConformityService,
    TestingLabRegistryService,
    ConformityDocumentGenerator,
    BkhcnRiskClassificationService,
)


def test_standards_registry_search():
    results = StandardsRegistryService.search("117")
    assert len(results) >= 1
    assert any("QCVN 117" in r["code"] for r in results)

    env_results = StandardsRegistryService.search(category="environment")
    assert len(env_results) >= 2


def test_hs_code_lookup():
    res = HsCodeConformityService.lookup_hs_code("8517.62.59")
    assert res is not None
    assert "QCVN 117:2020/BTTTT" in res["applicable_standards"]
    assert "Cục Viễn thông" in res["customs_inspection_agency"]


def test_testing_labs_list():
    labs = TestingLabRegistryService.list_all()
    assert len(labs) >= 5
    vnta = [l for l in labs if "VNTA" in l["code"]]
    assert len(vnta) == 1


def test_cr_pdf_generator():
    pdf_bytes, filename = ConformityDocumentGenerator.generate_cr_declaration_pdf()
    assert len(pdf_bytes) > 5000
    assert filename.endswith(".pdf")


def test_standards_summary_pdf():
    std = StandardsRegistryService.get_by_code("QCVN 117:2020/BTTTT")
    assert std is not None
    pdf_bytes, filename = ConformityDocumentGenerator.generate_standard_summary_pdf(std)
    assert len(pdf_bytes) > 5000
    assert filename.endswith(".pdf")

def test_bkhcn_risk_classification():
    stats = BkhcnRiskClassificationService.get_statistics()
    assert stats["total_items"] >= 270
    assert stats["high_risk_count"] >= 80
    assert stats["medium_risk_count"] >= 180
    assert stats["unique_hs_count"] >= 200

    # Exact high risk: 8517.62.59 (Gateway)
    r_high = BkhcnRiskClassificationService.classify("8517.62.59")
    assert r_high["status"] == "matched_exact"
    assert r_high["risk_level"] == "CAO"
    assert r_high["annex"] == 1

    # Exact medium risk: 6506.10.10 (Mũ bảo hiểm)
    r_med = BkhcnRiskClassificationService.classify("6506.10.10")
    assert r_med["status"] == "matched_exact"
    assert r_med["risk_level"] == "TRUNG_BINH"
    assert r_med["annex"] == 2

    # Low risk / out of catalog: 9026.10.90 (Cảm biến radar)
    r_low = BkhcnRiskClassificationService.classify("9026.10.90")
    assert r_low["status"] == "low_risk"
    assert r_low["risk_level"] == "THAP"

    # HS lookup enrichment
    hs_res = HsCodeConformityService.lookup_hs_code("8517.62.59")
    assert hs_res is not None
    assert "risk_classification" in hs_res
    assert hs_res["risk_classification"]["risk_level"] == "CAO"
