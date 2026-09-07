"""Unit & Integration Tests for Milestone M1 & M2:
2-Way Search Engine, Rule Inference, and RESTful API Endpoints.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.standards import (
    BENCHMARK_CERTIFICATES,
    BENCHMARK_ENTERPRISES,
    RuleInferenceEngine,
    StandardsRegistryService,
    TwoWayLookupService,
    fast_fuzzy_score,
    levenshtein_similarity,
    trigram_similarity,
)


# ─── 1. SIMILARITY ALGORITHMS TESTS ──────────────────────────────────────────

def test_levenshtein_and_trigram_similarity():
    # Exact match
    assert levenshtein_similarity("iNut-GW4G-Pro", "inut-gw4g-pro") == 1.0
    assert trigram_similarity("iNut-GW4G-Pro", "inut-gw4g-pro") == 1.0

    # High similarity with typo
    lev_score = levenshtein_similarity("CPH2699", "CPH2690")
    assert lev_score >= 0.80

    tri_score = trigram_similarity("VinFast VF8-TCU", "VinFast VF8 TCU")
    assert tri_score >= 0.65

    # Empty inputs
    assert levenshtein_similarity("", "") == 1.0
    assert levenshtein_similarity("abc", "") == 0.0
    assert trigram_similarity("", "") == 1.0


def test_fast_fuzzy_score():
    # Exact and unaccented substring
    assert fast_fuzzy_score("inut", "CÔNG TY TNHH CÔNG NGHỆ INUT") >= 0.85
    assert fast_fuzzy_score("rut240", "Teltonika RUT240") >= 0.85

    # Typo tolerance
    score = fast_fuzzy_score("decox50", "Deco X50")
    assert score >= 0.80


# ─── 2. RULE INFERENCE ENGINE TESTS ──────────────────────────────────────────

def test_rule_inference_4g_lte():
    results = RuleInferenceEngine.infer(query="iNut Gateway 4G LTE Industrial", hs_code="8517.62.59")
    assert len(results) > 0
    top = results[0]
    assert top["rule_id"] == "rule_4g_lte"
    assert "QCVN 117:2023/BTTTT" in top["mandatory_standards"]
    assert "QCVN 18:2022/BTTTT" in top["mandatory_standards"]
    assert "QCVN 132:2022/BTTTT" in top["mandatory_standards"]
    assert top["confidence"] >= 0.95


def test_rule_inference_5g_nr():
    results = RuleInferenceEngine.infer(query="5G NR Mobile CPE Router", hs_code="8517.12.00")
    assert len(results) > 0
    top = next(r for r in results if r["rule_id"] == "rule_5g_nr")
    assert "QCVN 127:2021/BTTTT" in top["mandatory_standards"]
    assert top["ministry"] == "BTTTT"


def test_rule_inference_wifi_and_bluetooth():
    results = RuleInferenceEngine.infer(query="Module ESP32-WROOM-32D Wi-Fi BLE", hs_code="8517.62.51")
    top = next(r for r in results if r["rule_id"] == "rule_wifi_2g_ble")
    assert "QCVN 54:2020/BTTTT" in top["mandatory_standards"]
    assert "QCVN 18:2022/BTTTT" in top["mandatory_standards"]


def test_rule_inference_gps_telematics():
    results = RuleInferenceEngine.infer(query="VinFast VF8-TCU Telematics Giám sát hành trình", hs_code="8526.91.00")
    top = next(r for r in results if r["rule_id"] == "rule_gps_telematics")
    assert "QCVN 31:2014/BGTVT" in top["mandatory_standards"]
    assert top["ministry"] == "BGTVT"


def test_rule_inference_environment_datalogger():
    results = RuleInferenceEngine.infer(query="Datalogger quan trắc nước thải tự động liên tục TT10", hs_code="9026.10.10")
    top = next(r for r in results if r["rule_id"] == "rule_environment_monitoring")
    assert "TT 10/2021/TT-BTNMT" in top["mandatory_standards"]
    assert top["ministry"] == "BTNMT"


def test_rule_inference_electricity_metering():
    results = RuleInferenceEngine.infer(query="Công tơ điện tử 3 pha nhiều biểu giá EMIC ME-42", hs_code="9028.30.10")
    top = next(r for r in results if r["rule_id"] == "rule_electricity_metering")
    assert "ĐLVN 24:2014" in top["mandatory_standards"]
    assert "ĐLVN 39:2019" in top["mandatory_standards"]
    assert "QCVN 19:2019/BKHCN" in top["mandatory_standards"]


def test_rule_inference_ev_charger():
    results = RuleInferenceEngine.infer(query="Trạm sạc xe điện DC Fast Charger 60kW VFE", hs_code="8504.40.90")
    top = next(r for r in results if r["rule_id"] == "rule_ev_charger")
    assert "TCVN 13078:2020" in top["mandatory_standards"]


def test_get_all_inference_rules():
    rules = RuleInferenceEngine.get_all_rules()
    assert len(rules) >= 10
    rule_ids = {r["id"] for r in rules}
    assert "rule_4g_lte" in rule_ids
    assert "rule_5g_nr" in rule_ids
    assert "rule_wifi_2g_ble" in rule_ids
    assert "rule_gps_telematics" in rule_ids
    assert "rule_electricity_metering" in rule_ids


# ─── 3. TWO-WAY LOOKUP SERVICE TESTS ─────────────────────────────────────────

def test_lookup_by_model_benchmarks():
    # 1. iNut-GW4G-Pro
    res = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", hs_code="8517.62.59")
    assert res["total_matches"] >= 1
    assert any(d["model"] == "iNut-GW4G-Pro" for d in res["exact_dossiers"])
    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 117:2023/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes
    assert res["customs_procedure"] is not None
    assert res["execution_time_ms"] >= 0

    # 2. CPH2699 (OPPO Reno12 5G)
    res_oppo = TwoWayLookupService.lookup_by_model(query="CPH2699")
    assert any(d["model"] == "CPH2699" for d in res_oppo["exact_dossiers"])
    oppo_stds = [s["code"] for s in res_oppo["applicable_standards"]]
    assert "QCVN 127:2021/BTTTT" in oppo_stds

    # 3. Cisco C9200
    res_cisco = TwoWayLookupService.lookup_by_model(query="C9200-24T-E")
    assert res_cisco["total_matches"] >= 1
    cisco_stds = [s["code"] for s in res_cisco["applicable_standards"]]
    assert "QCVN 118:2018/BTTTT" in cisco_stds

    # 4. VinFast VF8-TCU
    res_vf = TwoWayLookupService.lookup_by_model(query="VF8-TCU-GEN2")
    assert res_vf["total_matches"] >= 1
    vf_stds = [s["code"] for s in res_vf["applicable_standards"]]
    assert "QCVN 31:2014/BGTVT" in vf_stds

    # 5. EMIC ME-42
    res_emic = TwoWayLookupService.lookup_by_model(query="ME-42")
    assert res_emic["total_matches"] >= 1
    emic_stds = [s["code"] for s in res_emic["applicable_standards"]]
    assert "ĐLVN 24:2014" in emic_stds


def test_lookup_by_model_unaccented_fuzzy():
    # Fuzzy unaccented search
    res = TwoWayLookupService.lookup_by_model(query="inut gw4g pro", fuzzy=True)
    assert res["total_matches"] >= 1
    assert res["exact_dossiers"][0]["model"] == "iNut-GW4G-Pro"


def test_lookup_by_model_filters():
    # Ministry filter
    res_btttt = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", ministry="BTTTT")
    for s in res_btttt["applicable_standards"]:
        assert s["ministry"] == "BTTTT"

    # Mandatory only filter
    res_mand = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", mandatory_only=True)
    for s in res_mand["applicable_standards"]:
        assert s["mandatory"] is True


def test_lookup_by_tax_code_all_6_enterprises():
    # 1. INUT (4401053694)
    res_inut = TwoWayLookupService.lookup_by_tax_code(tax_code="4401053694")
    assert res_inut["enterprise_profile"]["short_name"] == "INUT TECHNOLOGY"
    assert res_inut["compliance_summary"]["total_dossiers"] >= 3
    assert res_inut["compliance_summary"]["active_dossiers"] >= 2
    assert res_inut["compliance_summary"]["expired_dossiers"] >= 1
    assert len(res_inut["active_qcvn_list"]) >= 3

    # 2. Viettel (0100109106)
    res_vt = TwoWayLookupService.lookup_by_tax_code(tax_code="0100109106")
    assert "VIỄN THÔNG" in res_vt["company_name"]
    assert "VIETTEL" in res_vt["enterprise_profile"]["short_name"]
    assert res_vt["compliance_summary"]["total_dossiers"] >= 3

    # 3. VinFast (0108926276)
    res_vf = TwoWayLookupService.lookup_by_tax_code(tax_code="0108926276")
    assert "VINFAST" in res_vf["company_name"]
    assert res_vf["compliance_summary"]["total_dossiers"] >= 2

    # 4. OPPO VN (0312636094)
    res_oppo = TwoWayLookupService.lookup_by_tax_code(tax_code="0312636094")
    assert res_oppo["compliance_summary"]["total_dossiers"] >= 1

    # 5. TP-Link VN (0315481745)
    res_tpl = TwoWayLookupService.lookup_by_tax_code(tax_code="0315481745")
    assert "TP-LINK" in res_tpl["company_name"]
    assert res_tpl["compliance_summary"]["total_dossiers"] >= 3

    # 6. EMIC (0100100908)
    res_emic = TwoWayLookupService.lookup_by_tax_code(tax_code="0100100908")
    assert "EMIC" in res_emic["company_name"]
    assert res_emic["compliance_summary"]["total_dossiers"] >= 2


def test_lookup_by_tax_code_status_filter():
    res_active = TwoWayLookupService.lookup_by_tax_code(tax_code="4401053694", status="active")
    for d in res_active["dossiers"]:
        assert d["derived_status"] == "active"

    res_expired = TwoWayLookupService.lookup_by_tax_code(tax_code="4401053694", status="expired")
    for d in res_expired["dossiers"]:
        assert d["derived_status"] == "expired"


def test_lookup_by_company_name_fuzzy():
    res = TwoWayLookupService.lookup_by_tax_code(company_name="inut technology")
    assert res["tax_code"] == "4401053694"
    assert res["compliance_summary"]["total_dossiers"] >= 1


def test_suggest_auto_complete():
    # 1. Model suggest
    sug_model = TwoWayLookupService.suggest(q="gw4g", type="model")
    assert len(sug_model["suggestions"]) >= 1
    assert any("iNut-GW4G-Pro" in s["text"] for s in sug_model["suggestions"])

    # 2. Tax code suggest
    sug_tax = TwoWayLookupService.suggest(q="440105", type="tax_code")
    assert any(s["text"] == "4401053694" for s in sug_tax["suggestions"])

    # 3. Company suggest
    sug_comp = TwoWayLookupService.suggest(q="vinfast", type="company")
    assert any("VINFAST" in s["text"] for s in sug_comp["suggestions"])

    # 4. QCVN suggest
    sug_qcvn = TwoWayLookupService.suggest(q="117", type="qcvn")
    assert any("QCVN 117" in s["text"] for s in sug_qcvn["suggestions"])

    # 5. HS Code suggest
    sug_hs = TwoWayLookupService.suggest(q="8517", type="hs_code")
    assert any("8517" in s["text"] for s in sug_hs["suggestions"])


# ─── 4. RESTFUL API ENDPOINTS INTEGRATION TESTS ──────────────────────────────

@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    from app.config import get_settings
    from app import db
    from app.auth import ensure_admin_seed
    from app.main import app

    get_settings.cache_clear()
    db.reset_engine_for_tests()
    db.init_db()
    session = next(db.get_session())
    ensure_admin_seed(session, get_settings())
    session.close()
    client = TestClient(app)
    assert client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"}).status_code == 200
    return client


def test_api_lookup_model_endpoint(auth_client):
    response = auth_client.get("/api/standards/lookup/model", params={"query": "iNut-GW4G-Pro", "hs_code": "8517.62.59"})
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "iNut-GW4G-Pro"
    assert data["total_matches"] >= 1
    assert "execution_time_ms" in data
    assert any("QCVN 117" in s["code"] for s in data["applicable_standards"])


def test_api_lookup_tax_code_endpoint(auth_client):
    response = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": "4401053694"})
    assert response.status_code == 200
    data = response.json()
    assert data["tax_code"] == "4401053694"
    assert data["compliance_summary"]["total_dossiers"] >= 3
    assert "execution_time_ms" in data


def test_api_lookup_enterprise_path_param_endpoint(auth_client):
    response = auth_client.get("/api/standards/lookup/enterprise/0108926276")
    assert response.status_code == 200
    data = response.json()
    assert data["tax_code"] == "0108926276"
    assert "VINFAST" in data["company_name"]


def test_api_suggest_endpoint(auth_client):
    response = auth_client.get("/api/standards/suggest", params={"q": "cph", "type": "model"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["suggestions"]) >= 1
    assert "execution_time_ms" in data


def test_api_rules_endpoint(auth_client):
    response = auth_client.get("/api/standards/rules")
    assert response.status_code == 200
    data = response.json()
    assert data["total_rules"] >= 10
    assert len(data["rules"]) == data["total_rules"]


def test_api_search_registry_updated_circulars(auth_client):
    # TT 02/2024/TT-BTTTT
    res_tt02 = auth_client.get("/api/standards/search", params={"q": "02/2024"})
    assert res_tt02.status_code == 200
    items = res_tt02.json()
    assert len(items) >= 1

    # QCVN 117:2023
    res_117 = auth_client.get("/api/standards/search", params={"q": "117:2023"})
    assert res_117.status_code == 200
    assert len(res_117.json()) >= 1
