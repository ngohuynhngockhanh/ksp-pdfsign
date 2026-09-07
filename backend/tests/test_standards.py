from app.standards import StandardsRegistryService, HsCodeConformityService, TestingLabRegistryService, ConformityDocumentGenerator


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
