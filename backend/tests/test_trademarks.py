"""Comprehensive & adversarial test suite for Trademark Management & Circular 263 Fee Estimator.

Covers:
1. WIPO HTML parsing (normal, rejected, edge cases, malformed HTML, XSS payloads).
2. Law on IP Article 93 validity calculations (normal, leap year, boundary conditions, phases, countdown).
3. Circular 263/2016/TT-BTC & 63/2023/TT-BTC fee calculations (1, 2, 3+ Nice classes, late penalties, boundary capping).
4. Benchmark seed data idempotency and database operations.
5. Logo downloading and storage integration.
6. FastAPI REST endpoints via TestClient (auth requirements, list, detail, sync online & offline fallback, lookup, logo serving).
7. Adversarial, security (SQL injection, XSS) and stress resilience tests.
"""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import status
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import storage
from app.db import Base, IpTrademark
from app.trademark import (
    INUT_BENCHMARK_TRADEMARKS,
    add_months,
    add_years,
    calculate_renewal_fees,
    calculate_trademark_validity,
    download_and_store_logo,
    format_date_vn,
    parse_date,
    parse_wipo_html,
    search_wipo_trademarks,
    seed_inut_trademarks,
    sync_trademarks_from_wipo,
    trademark_to_dict,
)
from tests.test_api import _login

# ---------------------------------------------------------------------------
# Mock HTML Fixture
# ---------------------------------------------------------------------------

WIPO_MOCK_HTML_5_ROWS = """<!DOCTYPE html>
<html>
<head><title>WIPO Publish Vietnam Search Results</title></head>
<body>
<table class="ui-responsive table-stroke">
  <thead>
    <tr>
      <th>Chọn</th><th>Mẫu nhãn hiệu</th><th>Tên nhãn hiệu</th><th>Số đơn</th>
      <th>Ngày nộp</th><th>Ngày CB</th><th>Số bằng</th><th>Ngày cấp</th>
      <th>Chủ đơn</th><th>Nhóm SP/DV</th><th>Trạng thái</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><input type="checkbox" name="select" /></td>
      <td><img src="https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4201943953/thumbnail?noLogo=true&amp;disclaimer=Combined" alt="iNut logo" /></td>
      <td><a href="./detail/trademarks?id=VN4201943953">iNut</a></td>
      <td>VN-4-2019-43953</td>
      <td>04.11.2019</td>
      <td>27.01.2020</td>
      <td>4-0405854-000</td>
      <td>09.12.2021</td>
      <td>Công ty cổ phần đầu tư và phát triển công nghệ INUT</td>
      <td>9, 42</td>
      <td>Cấp bằng</td>
    </tr>
    <tr>
      <td><input type="checkbox" name="select" /></td>
      <td><img src="https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4201943954/thumbnail?noLogo=true&amp;disclaimer=Combined" alt="iNutPlatform logo" /></td>
      <td><a href="/wopublish-search/public/detail/trademarks?id=VN4201943954">iNutPlatform</a></td>
      <td>VN-4-2019-43954</td>
      <td>04.11.2019</td>
      <td>25.01.2022</td>
      <td>4-0405855-000</td>
      <td>09.12.2021</td>
      <td>Công ty cổ phần đầu tư và phát triển công nghệ INUT</td>
      <td>9, 42</td>
      <td>Cấp bằng</td>
    </tr>
    <tr>
      <td><input type="checkbox" name="select" /></td>
      <td><img src="https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4201943955/thumbnail?noLogo=true&amp;disclaimer=Combined" alt="iNutDoor logo" /></td>
      <td><a href="https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/detail/trademarks?id=VN4201943955">iNutDoor</a></td>
      <td>VN-4-2019-43955</td>
      <td>04.11.2019</td>
      <td>25.01.2022</td>
      <td>4-0405856-000</td>
      <td>09.12.2021</td>
      <td>Công ty cổ phần đầu tư và phát triển công nghệ INUT</td>
      <td>9, 42</td>
      <td>Cấp bằng</td>
    </tr>
    <tr>
      <td><input type="checkbox" name="select" /></td>
      <td><img src="https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4201948905/thumbnail?noLogo=true&amp;disclaimer=Combined" alt="iNutMuro logo" /></td>
      <td><a href="./detail/trademarks?id=VN4201948905">iNutMuro</a></td>
      <td>VN-4-2019-48905</td>
      <td>02.12.2019</td>
      <td>25.02.2020</td>
      <td>4-0440677-000</td>
      <td>06.10.2022</td>
      <td>Công ty cổ phần đầu tư và phát triển công nghệ INUT</td>
      <td>9, 42</td>
      <td>Cấp bằng</td>
    </tr>
    <tr>
      <td><input type="checkbox" name="select" /></td>
      <td><img src="https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4201948906/thumbnail?noLogo=true&amp;disclaimer=Combined" alt="iNutNebi logo" /></td>
      <td><a href="./detail/trademarks?id=VN4201948906">iNutNebi</a></td>
      <td>VN-4-2019-48906</td>
      <td>02.12.2019</td>
      <td>25.02.2020</td>
      <td></td>
      <td></td>
      <td>Công ty cổ phần đầu tư và phát triển công nghệ INUT</td>
      <td>9, 42</td>
      <td>Từ chối</td>
    </tr>
  </tbody>
</table>
</body>
</html>
"""


# ===========================================================================
# 1. WIPO HTML Parsing Tests
# ===========================================================================


class TestWipoHtmlParsing:
    """Test parse_wipo_html parsing logic, edge cases and resilience."""

    def test_parse_wipo_html_5_benchmark_rows(self):
        """Mock HTML response with 5 rows (4 granted, 1 rejected) matches expected fields."""
        items = parse_wipo_html(WIPO_MOCK_HTML_5_ROWS)
        assert len(items) == 5

        # Row 0: iNut (Cấp bằng)
        inut = items[0]
        assert inut["mark_name"] == "iNut"
        assert inut["application_number"] == "VN-4-2019-43953"
        assert inut["application_id"] == "VN4201943953"
        assert inut["registration_number"] == "4-0405854-000"
        assert inut["filing_date"] == "04.11.2019"
        assert inut["publication_date"] == "27.01.2020"
        assert inut["grant_date"] == "09.12.2021"
        assert inut["status"] == "Cấp bằng"
        assert inut["nice_classes"] == "9, 42"
        assert inut["owner_name"] == "Công ty cổ phần đầu tư và phát triển công nghệ INUT"
        assert "VN4201943953" in inut["thumbnail_url"]
        assert inut["detail_url"].endswith("/detail/trademarks?id=VN4201943953")
        assert inut["validity"]["expiry_date"] == "04/11/2029"
        assert inut["fee_breakdown"]["total_amount"] == 1_000_000.0

        # Row 1: iNutPlatform (Cấp bằng)
        plat = items[1]
        assert plat["mark_name"] == "iNutPlatform"
        assert plat["application_number"] == "VN-4-2019-43954"
        assert plat["application_id"] == "VN4201943954"
        assert plat["registration_number"] == "4-0405855-000"
        assert plat["status"] == "Cấp bằng"

        # Row 2: iNutDoor (Cấp bằng)
        door = items[2]
        assert door["mark_name"] == "iNutDoor"
        assert door["application_number"] == "VN-4-2019-43955"
        assert door["application_id"] == "VN4201943955"
        assert door["registration_number"] == "4-0405856-000"
        assert door["status"] == "Cấp bằng"

        # Row 3: iNutMuro (Cấp bằng)
        muro = items[3]
        assert muro["mark_name"] == "iNutMuro"
        assert muro["application_number"] == "VN-4-2019-48905"
        assert muro["application_id"] == "VN4201948905"
        assert muro["registration_number"] == "4-0440677-000"
        assert muro["grant_date"] == "06.10.2022"
        assert muro["status"] == "Cấp bằng"

        # Row 4: iNutNebi (Từ chối)
        nebi = items[4]
        assert nebi["mark_name"] == "iNutNebi"
        assert nebi["application_number"] == "VN-4-2019-48906"
        assert nebi["application_id"] == "VN4201948906"
        assert nebi["registration_number"] == ""
        assert nebi["grant_date"] == ""
        assert nebi["status"] == "Từ chối"

    def test_parse_wipo_html_edge_cases(self):
        """HTML edge cases: empty strings, missing tables, short rows, missing thumbnails."""
        # Empty inputs
        assert parse_wipo_html("") == []
        assert parse_wipo_html("   \n\t  ") == []
        assert parse_wipo_html("<div>No tables here</div>") == []

        # Table with fewer than 8 columns should be safely skipped
        short_table = """
        <table><tbody>
          <tr><td>1</td><td>2</td><td>3</td><td>4</td></tr>
        </tbody></table>
        """
        assert parse_wipo_html(short_table) == []

        # Row with missing application number AND mark name should be skipped
        empty_row = """
        <table><tbody>
          <tr>
            <td></td><td></td><td></td><td></td>
            <td>04.11.2019</td><td>27.01.2020</td><td></td><td></td>
            <td>INUT</td><td>9</td><td>Cấp bằng</td>
          </tr>
        </tbody></table>
        """
        assert parse_wipo_html(empty_row) == []

        # Row without thumbnail img generates fallback thumbnail from application_id
        no_img_row = """
        <table><tbody>
          <tr>
            <td><input type="checkbox"/></td>
            <td></td>
            <td>MarkWithoutImg</td>
            <td>VN-4-2023-12345</td>
            <td>01.01.2023</td>
            <td>01.02.2023</td>
            <td>4-1234567-000</td>
            <td>01.01.2024</td>
            <td>Owner Corp</td>
            <td>35</td>
            <td>Cấp bằng</td>
          </tr>
        </tbody></table>
        """
        parsed = parse_wipo_html(no_img_row)
        assert len(parsed) == 1
        assert parsed[0]["application_id"] == "VN4202312345"
        assert "VN4202312345/thumbnail" in parsed[0]["thumbnail_url"]

    def test_parse_wipo_html_xss_and_malformed(self):
        """Adversarial HTML containing XSS payloads and broken tags parses safely without crashing."""
        malformed = """
        <table><tbody>
          <tr>
            <td><script>alert('xss')</script></td>
            <td><img src="javascript:alert(1)" /></td>
            <td><a href="./detail/trademarks?id=VN<script>1</script>">Malicious & Mark <img src=x onerror=alert(2)></a></td>
            <td>VN-4-2021-99999</td>
            <td>15.08.2021</td>
            <td>20.09.2021</td>
            <td>4-0000001-000</td>
            <td>10.10.2022</td>
            <td><svg/onload=alert('owner')>Owner Name</td>
            <td>9, 42</td>
            <td>Cấp bằng</td>
          </tr>
        </tbody></table>
        """
        results = parse_wipo_html(malformed)
        assert len(results) == 1
        assert "VN-4-2021-99999" == results[0]["application_number"]
        assert results[0]["fee_breakdown"]["total_amount"] == 1_000_000.0


# ===========================================================================
# 2. Law on IP Article 93 Validity Calculations Tests
# ===========================================================================


class TestValidityCalculations:
    """Test Article 93 10-year validity, 6-month renewal window, 6-month grace period, leap years, countdown."""

    def test_validity_normal_date(self):
        """Normal date: 04.11.2019 -> expiry 04.11.2029, window 04.05.2029, grace 04.05.2030."""
        val = calculate_trademark_validity("04.11.2019", "09.12.2021")
        assert val["filing_date"] == "04/11/2019"
        assert val["grant_date"] == "09/12/2021"
        assert val["expiry_date"] == "04/11/2029"
        assert val["renewal_window_start"] == "04/05/2029"
        assert val["grace_period_end"] == "04/05/2030"

    def test_validity_leap_year_handling(self):
        """Leap year date handling: 29.02.2020 -> expiry 28.02.2030 (2030 non-leap), window 28.08.2029, grace 28.08.2030."""
        val = calculate_trademark_validity("29.02.2020")
        assert val["filing_date"] == "29/02/2020"
        assert val["expiry_date"] == "28/02/2030"
        assert val["renewal_window_start"] == "28/08/2029"
        assert val["grace_period_end"] == "28/08/2030"

    def test_phase_active(self):
        """When today is well before renewal window start, phase is 'active'."""
        today = date(2026, 9, 18)
        val = calculate_trademark_validity("04.11.2019", today=today)
        assert val["phase"] == "active"
        assert val["phase_label"] == "Đang có hiệu lực"
        assert val["is_renewable_now"] is False
        assert val["days_remaining"] == (date(2029, 11, 4) - today).days
        assert "Còn" in val["time_remaining_formatted"]
        assert "ngày" in val["time_remaining_formatted"]

    def test_phase_in_renewal_window_start_boundary(self):
        """Exactly on renewal_window_start (04.05.2029), phase transitions to 'in_renewal_window'."""
        today = date(2029, 5, 4)
        val = calculate_trademark_validity("04.11.2019", today=today)
        assert val["phase"] == "in_renewal_window"
        assert val["is_renewable_now"] is True
        assert val["days_remaining"] == (date(2029, 11, 4) - today).days

    def test_phase_in_renewal_window_expiry_day(self):
        """On exact expiry date (04.11.2029), days_remaining == 0, phase is 'in_renewal_window'."""
        today = date(2029, 11, 4)
        val = calculate_trademark_validity("04.11.2019", today=today)
        assert val["phase"] == "in_renewal_window"
        assert val["is_renewable_now"] is True
        assert val["days_remaining"] == 0
        assert val["time_remaining_formatted"] == "Hôm nay là ngày hết hạn hiệu lực"

    def test_phase_in_grace_period(self):
        """1 day after expiry up to 6 months: phase is 'in_grace_period'."""
        today = date(2029, 11, 5)
        val = calculate_trademark_validity("04.11.2019", today=today)
        assert val["phase"] == "in_grace_period"
        assert val["phase_label"] == "Quá hạn (Đang trong ân hạn 6 tháng)"
        assert val["is_renewable_now"] is True
        assert val["days_remaining"] == -1
        assert "Quá hạn 1 ngày (Còn trong ân hạn)" in val["time_remaining_formatted"]

        # Exactly at grace_period_end (04.05.2030)
        today_grace_end = date(2030, 5, 4)
        val_end = calculate_trademark_validity("04.11.2019", today=today_grace_end)
        assert val_end["phase"] == "in_grace_period"
        assert val_end["is_renewable_now"] is True

    def test_phase_expired(self):
        """1 day after grace period end: phase is 'expired'."""
        today = date(2030, 5, 5)
        val = calculate_trademark_validity("04.11.2019", today=today)
        assert val["phase"] == "expired"
        assert val["phase_label"] == "Đã hết hiệu lực"
        assert val["is_renewable_now"] is False
        assert val["days_remaining"] < 0
        assert "Đã hết hiệu lực" in val["time_remaining_formatted"]

    def test_date_parser_formats_and_invalid(self):
        """Test parse_date with multiple date formats and invalid strings."""
        assert parse_date("04.11.2019") == date(2019, 11, 4)
        assert parse_date("04/11/2019") == date(2019, 11, 4)
        assert parse_date("2019-11-04") == date(2019, 11, 4)
        assert parse_date("2019.11.04") == date(2019, 11, 4)

        # Edge cases & invalid strings
        assert parse_date("") is None
        assert parse_date("   ") is None
        assert parse_date("invalid-date") is None
        assert parse_date("31/02/2020") is None  # Feb 31 does not exist
        assert parse_date("2020-02-31") is None
        assert parse_date("99.99.9999") is None

        # When filing_date is invalid, calculate_trademark_validity returns safe fallback
        val = calculate_trademark_validity("not_a_valid_date")
        assert val["phase"] == "unknown"
        assert val["days_remaining"] == 0
        assert val["is_renewable_now"] is False
        assert val["time_remaining_formatted"] == "Chưa rõ ngày nộp đơn"

    def test_add_months_month_clamping_and_year_overflow(self):
        """Test add_months across year boundaries and month-end clamping (e.g. 31st to 30th/28th)."""
        # March 31 - 1 month -> Feb 28 (non leap)
        d = date(2021, 3, 31)
        res = add_months(d, -1)
        assert res == date(2021, 2, 28)

        # Jan 31 + 1 month -> Feb 29 (leap year 2024)
        d_leap = date(2024, 1, 31)
        res_leap = add_months(d_leap, 1)
        assert res_leap == date(2024, 2, 29)

        # December + 2 months -> February next year
        d_dec = date(2023, 12, 15)
        res_overflow = add_months(d_dec, 2)
        assert res_overflow == date(2024, 2, 15)

        # January - 2 months -> November previous year
        d_jan = date(2024, 1, 15)
        res_underflow = add_months(d_jan, -2)
        assert res_underflow == date(2023, 11, 15)


# ===========================================================================
# 3. Circular 263/2016/TT-BTC Fee Calculations Tests
# ===========================================================================


class TestCircular263FeeCalculations:
    """Test statutory trademark renewal fee structure under Circular 263/2016/TT-BTC."""

    def test_fee_1_nice_class(self):
        """1 Nice class = 750.000 VNĐ:
        - Extension fee: 100k
        - Usage fee: 250k
        - Examination fee: 160k
        - Publication fee: 120k
        - Registration fee: 120k
        Total = 750.000 VNĐ.
        """
        fee = calculate_renewal_fees("9")
        assert fee["num_classes"] == 1
        assert fee["classes"] == ["9"]
        assert fee["total_amount"] == 750_000.0
        assert fee["total_formatted"] == "750,000 VNĐ"
        assert len(fee["items"]) == 5

        # Check item breakdown codes
        codes = {item["code"]: item["amount"] for item in fee["items"]}
        assert codes["EXTENSION_FEE"] == 100_000.0
        assert codes["USAGE_FEE"] == 250_000.0
        assert codes["EXAMINATION_FEE"] == 160_000.0
        assert codes["PUBLICATION_FEE"] == 120_000.0
        assert codes["REGISTRATION_FEE"] == 120_000.0

    def test_fee_2_nice_classes_matches_inut(self):
        """2 Nice classes (e.g. 9, 42) = exactly 1.000.000 VNĐ (matches all 4 granted INUT marks):
        - Extension fee: 200k (100k x 2)
        - Usage fee: 400k (250k + 150k)
        - Examination fee: 160k
        - Publication fee: 120k
        - Registration fee: 120k
        Total = 1.000.000 VNĐ.
        """
        fee = calculate_renewal_fees("9, 42")
        assert fee["num_classes"] == 2
        assert fee["classes"] == ["9", "42"]
        assert fee["total_amount"] == 1_000_000.0
        assert fee["total_formatted"] == "1,000,000 VNĐ"

        codes = {item["code"]: item["amount"] for item in fee["items"]}
        assert codes["EXTENSION_FEE"] == 200_000.0
        assert codes["USAGE_FEE"] == 400_000.0
        assert codes["EXAMINATION_FEE"] == 160_000.0
        assert codes["PUBLICATION_FEE"] == 120_000.0
        assert codes["REGISTRATION_FEE"] == 120_000.0

    def test_fee_3_nice_classes(self):
        """3 Nice classes (e.g. 9, 35, 42) = 1.250.000 VNĐ:
        - Extension fee: 300k
        - Usage fee: 550k (250k + 150k*2)
        - Examination, Publication, Registration: 400k
        Total = 1.250.000 VNĐ.
        """
        fee = calculate_renewal_fees("9, 35, 42")
        assert fee["num_classes"] == 3
        assert fee["total_amount"] == 1_250_000.0
        assert fee["total_formatted"] == "1,250,000 VNĐ"

    def test_fee_late_renewal_penalty(self):
        """Late renewal in 6-month grace period: 10% penalty per month late on extension fee."""
        # 2 classes: extension fee = 200.000d. 10% = 20.000d / month.
        fee_1mo = calculate_renewal_fees("9, 42", is_late=True, late_months=1)
        assert fee_1mo["total_amount"] == 1_020_000.0
        late_item_1 = [it for it in fee_1mo["items"] if it["code"] == "LATE_PENALTY_FEE"][0]
        assert late_item_1["amount"] == 20_000.0

        fee_3mo = calculate_renewal_fees("9, 42", is_late=True, late_months=3)
        assert fee_3mo["total_amount"] == 1_060_000.0

        fee_6mo = calculate_renewal_fees("9, 42", is_late=True, late_months=6)
        assert fee_6mo["total_amount"] == 1_120_000.0

        # Late months capped at 6 even if 10 or 100 months given
        fee_capped = calculate_renewal_fees("9, 42", is_late=True, late_months=10)
        assert fee_capped["total_amount"] == 1_120_000.0

        # If is_late is False, no penalty item even if late_months > 0
        fee_not_late = calculate_renewal_fees("9, 42", is_late=False, late_months=3)
        assert fee_not_late["total_amount"] == 1_000_000.0
        assert not any(it["code"] == "LATE_PENALTY_FEE" for it in fee_not_late["items"])

    def test_fee_edge_cases_and_delimiters(self):
        """Handle delimiters (semicolons, extra commas, whitespace) and empty strings gracefully."""
        # Empty string defaults to 1 class
        assert calculate_renewal_fees("")["total_amount"] == 750_000.0
        assert calculate_renewal_fees("   ")["total_amount"] == 750_000.0

        # Semicolons and spaces
        res_semi = calculate_renewal_fees(" 9 ; 42 ")
        assert res_semi["num_classes"] == 2
        assert res_semi["total_amount"] == 1_000_000.0

        # Trailing/leading/multiple commas
        res_commas = calculate_renewal_fees(",,9,,,42,,")
        assert res_commas["num_classes"] == 2
        assert res_commas["total_amount"] == 1_000_000.0


# ===========================================================================
# 4. Seed Benchmark & DB Operations Tests
# ===========================================================================


class TestSeedBenchmarkData:
    """Test seed_inut_trademarks idempotency and record fidelity."""

    @pytest.fixture
    def memory_db_session(self):
        """In-memory clean SQLite session."""
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        Session = sessionmaker(bind=engine)
        session = Session()
        yield session
        session.close()

    def test_seed_inut_trademarks_idempotent(self, memory_db_session):
        """seed_inut_trademarks populates 5 items; second call returns 0 without duplicates."""
        # First call: populates 5 records
        first_count = seed_inut_trademarks(memory_db_session)
        assert first_count == 5

        records = memory_db_session.scalars(select(IpTrademark)).all()
        assert len(records) == 5

        # Verify benchmark attributes
        apps = {r.application_number: r for r in records}
        assert "VN-4-2019-43953" in apps
        assert "VN-4-2019-43954" in apps
        assert "VN-4-2019-43955" in apps
        assert "VN-4-2019-48905" in apps
        assert "VN-4-2019-48906" in apps

        # 4 granted, 1 rejected
        granted = [r for r in records if r.status == "Cấp bằng"]
        rejected = [r for r in records if r.status == "Từ chối"]
        assert len(granted) == 4
        assert len(rejected) == 1
        assert rejected[0].mark_name == "iNutNebi"
        assert rejected[0].registration_number == ""

        # Check calculated fields stored during seed
        for r in records:
            assert r.expiry_date != ""
            assert r.renewal_window_start != ""

        # Second call: must be idempotent and return 0
        second_count = seed_inut_trademarks(memory_db_session)
        assert second_count == 0

        # Total count still exactly 5
        records_after = memory_db_session.scalars(select(IpTrademark)).all()
        assert len(records_after) == 5

    def test_trademark_to_dict(self, memory_db_session):
        """trademark_to_dict converts IpTrademark entity into rich response schema."""
        seed_inut_trademarks(memory_db_session)
        tm = memory_db_session.scalars(
            select(IpTrademark).where(IpTrademark.application_number == "VN-4-2019-43953")
        ).one()

        d = trademark_to_dict(tm)
        assert d["application_number"] == "VN-4-2019-43953"
        assert d["mark_name"] == "iNut"
        assert "validity" in d
        assert "fee_breakdown" in d
        assert d["validity"]["expiry_date"] == "04/11/2029"
        assert d["fee_breakdown"]["total_amount"] == 1_000_000.0


# ===========================================================================
# 5. Logo Downloader Tests
# ===========================================================================


class TestLogoDownloader:
    """Test download_and_store_logo with success, error, and timeout scenarios."""

    def test_download_and_store_logo_success(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        from app.config import get_settings
        get_settings.cache_clear()

        fake_image_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 200

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = fake_image_bytes

        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp

        doc_id = download_and_store_logo("VN4201943953", "https://example.com/logo.jpg", client=mock_client)
        assert doc_id is not None
        assert storage.exists(doc_id, suffix=".jpg")
        assert storage.read_doc(doc_id, suffix=".jpg") == fake_image_bytes

    def test_download_and_store_logo_network_failure(self):
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.ConnectTimeout("Connection timed out")

        doc_id = download_and_store_logo("VN4201943953", "https://example.com/logo.jpg", client=mock_client)
        assert doc_id is None

    def test_download_and_store_logo_empty_url(self):
        assert download_and_store_logo("VN4201943953", "") is None


# ===========================================================================
# 6. FastAPI REST API Endpoint Tests
# ===========================================================================


class TestTrademarkApiEndpoints:
    """Test all endpoints in trademark_api: GET /, GET /{id}, POST /sync, POST /lookup-online, GET /{id}/logo."""

    def test_api_requires_auth(self, client):
        """Unauthenticated requests return 401 Unauthorized for protected endpoints."""
        assert client.get("/api/trademarks").status_code == status.HTTP_401_UNAUTHORIZED
        assert client.get("/api/trademarks/1").status_code == status.HTTP_401_UNAUTHORIZED
        assert client.post("/api/trademarks/sync", json={}).status_code == status.HTTP_401_UNAUTHORIZED
        assert client.post("/api/trademarks/lookup-online", json={"query": "iNut"}).status_code == status.HTTP_401_UNAUTHORIZED

    def test_api_get_trademarks_list(self, client):
        """GET /api/trademarks returns 200 and auto-seeds 5 items with validity & fee breakdown."""
        _login(client)
        resp = client.get("/api/trademarks")
        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 5

        # Check fields of each item
        app_numbers = [item["application_number"] for item in data]
        assert "VN-4-2019-43953" in app_numbers
        assert "VN-4-2019-48906" in app_numbers

        for item in data:
            assert "id" in item
            assert "mark_name" in item
            assert "validity" in item
            assert "fee_breakdown" in item
            assert item["fee_breakdown"]["total_amount"] == 1_000_000.0

    def test_api_get_trademark_detail(self, client):
        """GET /api/trademarks/{id} returns 200 for existing ID, 404 for invalid ID, 422 for non-int."""
        _login(client)

        # Trigger initial seed by listing
        client.get("/api/trademarks")

        # Existing record
        resp = client.get("/api/trademarks/1")
        assert resp.status_code == status.HTTP_200_OK
        body = resp.json()
        assert body["id"] == 1
        assert body["mark_name"] != ""
        assert "validity" in body
        assert "fee_breakdown" in body

        # Non-existent ID returns 404
        resp_404 = client.get("/api/trademarks/999999")
        assert resp_404.status_code == status.HTTP_404_NOT_FOUND
        assert "Không tìm thấy nhãn hiệu" in resp_404.json()["detail"]

        # Non-integer ID returns 422
        resp_422 = client.get("/api/trademarks/not-an-int")
        assert resp_422.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_api_post_sync_online_mock(self, client):
        """POST /api/trademarks/sync successfully synchronizes items when WIPO returns data."""
        _login(client)

        mock_items = [
            {
                "application_number": "VN-4-2019-43953",
                "application_id": "VN4201943953",
                "mark_name": "iNut",
                "registration_number": "4-0405854-000",
                "filing_date": "04.11.2019",
                "publication_date": "27.01.2020",
                "grant_date": "09.12.2021",
                "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
                "nice_classes": "9, 42",
                "status": "Cấp bằng",
                "thumbnail_url": "https://wipopublish.ipvietnam.gov.vn/thumbnail.jpg",
                "detail_url": "https://wipopublish.ipvietnam.gov.vn/detail",
                "validity": calculate_trademark_validity("04.11.2019", "09.12.2021"),
                "fee_breakdown": calculate_renewal_fees("9, 42"),
            }
        ]

        with patch("app.trademark.search_wipo_trademarks", return_value=mock_items):
            resp = client.post(
                "/api/trademarks/sync",
                json={"query": "APNA:(INUT)", "download_logos": False},
            )
            assert resp.status_code == status.HTTP_200_OK
            data = resp.json()
            assert data["ok"] is True
            assert data["synced_count"] == 1
            assert "items" in data

    def test_api_post_sync_offline_fallback(self, client):
        """POST /api/trademarks/sync falls back gracefully to internal database when WIPO returns empty."""
        _login(client)

        with patch("app.trademark.search_wipo_trademarks", return_value=[]):
            resp = client.post("/api/trademarks/sync", json={})
            assert resp.status_code == status.HTTP_200_OK
            data = resp.json()
            assert data["ok"] is True
            assert "Không kết nối được Cổng Cục SHTT" in data["message"]
            assert data["total_in_db"] >= 5

    def test_api_post_sync_exception_handling(self, client):
        """POST /api/trademarks/sync returns 500 when uncaught internal error occurs."""
        _login(client)

        with patch("app.trademark.sync_trademarks_from_wipo", side_effect=RuntimeError("Database lock")):
            resp = client.post("/api/trademarks/sync", json={})
            assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
            assert "Database lock" in resp.json()["detail"]

    def test_api_post_lookup_online(self, client):
        """POST /api/trademarks/lookup-online validates query and returns live results."""
        _login(client)

        mock_search_results = [
            {
                "mark_name": "TestMark",
                "application_number": "VN-4-2022-00001",
                "application_id": "VN4202200001",
                "status": "Cấp bằng",
            }
        ]

        with patch("app.trademark.search_wipo_trademarks", return_value=mock_search_results):
            # Valid query
            resp = client.post("/api/trademarks/lookup-online", json={"query": "INUT"})
            assert resp.status_code == status.HTTP_200_OK
            body = resp.json()
            assert body["ok"] is True
            assert body["total"] == 1
            assert body["items"][0]["mark_name"] == "TestMark"

        # Validation error: empty query string
        resp_empty = client.post("/api/trademarks/lookup-online", json={"query": ""})
        assert resp_empty.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Validation error: missing query field
        resp_missing = client.post("/api/trademarks/lookup-online", json={})
        assert resp_missing.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Network error simulation -> 502 Bad Gateway
        with patch("app.trademark.search_wipo_trademarks", side_effect=httpx.ConnectError("WIPO down")):
            resp_err = client.post("/api/trademarks/lookup-online", json={"query": "INUT"})
            assert resp_err.status_code == status.HTTP_502_BAD_GATEWAY
            assert "Không thể tra cứu trực tuyến" in resp_err.json()["detail"]

    def test_api_get_trademark_logo_redirect_and_file(self, client, tmp_path, monkeypatch):
        """GET /api/trademarks/{id}/logo serves file if local, or redirects to remote_logo_url."""
        _login(client)
        # Ensure seed
        client.get("/api/trademarks")

        # Case 1: Logo has remote_logo_url but no local file -> 307 Temporary Redirect
        resp_redirect = client.get("/api/trademarks/1/logo", follow_redirects=False)
        assert resp_redirect.status_code in (status.HTTP_307_TEMPORARY_REDIRECT, status.HTTP_302_FOUND)
        assert "location" in resp_redirect.headers

        # Case 2: Logo has local file in storage -> 200 FileResponse image/jpeg
        fake_content = b"\xff\xd8\xff\xe0" + b"X" * 150
        doc_id = storage.save_upload(fake_content, suffix=".jpg")

        from app import db as dbmod
        gen = dbmod.get_session()
        s = next(gen)
        tm = s.get(IpTrademark, 1)
        tm.logo_doc_id = doc_id
        tm.logo_suffix = ".jpg"
        s.commit()
        gen.close()

        resp_file = client.get("/api/trademarks/1/logo")
        assert resp_file.status_code == status.HTTP_200_OK
        assert resp_file.headers["content-type"] == "image/jpeg"
        assert resp_file.content == fake_content

        # Case 3: Trademark does not exist -> 404
        resp_not_found = client.get("/api/trademarks/999999/logo")
        assert resp_not_found.status_code == status.HTTP_404_NOT_FOUND


# ===========================================================================
# 7. Adversarial, Stress & Resilience Tests (Teamwork Challenger)
# ===========================================================================


class TestAdversarialChallenger:
    """Adversarial stress-testing: SQL injection vectors, extreme bounds, malformed payloads."""

    def test_sql_injection_resilience_in_lookup(self, client):
        """SQL injection vectors in online lookup query must be safely handled."""
        _login(client)

        sql_payloads = [
            "' OR '1'='1",
            "1; DROP TABLE ip_trademarks; --",
            "' UNION SELECT * FROM users --",
            "admin'--",
            "' OR 1=1 #",
        ]

        with patch("app.trademark.search_wipo_trademarks", return_value=[]):
            for payload in sql_payloads:
                resp = client.post("/api/trademarks/lookup-online", json={"query": payload})
                assert resp.status_code == status.HTTP_200_OK
                assert resp.json()["ok"] is True

        # Verify ip_trademarks table is untouched and intact
        from app import db as dbmod
        gen = dbmod.get_session()
        s = next(gen)
        count = s.query(IpTrademark).count()
        gen.close()
        assert count >= 5

    def test_extreme_fee_class_counts(self):
        """Extreme class counts (e.g. 45 Nice classes, 0 classes) calculate mathematically without overflow."""
        # 45 Nice classes (all classes in Nice Classification):
        # extension: 100k * 45 = 4.500.000d
        # usage: 250k + (44 * 150k) = 250k + 6.600.000d = 6.850.000d
        # exam: 160k, pub: 120k, reg: 120k = 400.000d
        # total = 4.500.000 + 6.850.000 + 400.000 = 11.750.000 VNĐ.
        classes_45_str = ", ".join(str(i) for i in range(1, 46))
        fee_45 = calculate_renewal_fees(classes_45_str)
        assert fee_45["num_classes"] == 45
        assert fee_45["total_amount"] == 11_750_000.0
        assert fee_45["total_formatted"] == "11,750,000 VNĐ"

    def test_fee_negative_late_months_robustness(self):
        """Negative late_months should not reduce or subtract fee."""
        fee_neg = calculate_renewal_fees("9, 42", is_late=True, late_months=-5)
        # In implementation: late_fee is only added if late_months > 0
        assert fee_neg["total_amount"] == 1_000_000.0

    def test_sync_idempotence_under_repeated_runs(self, client):
        """Rapid consecutive sync calls update existing records without creating duplicate keys."""
        _login(client)

        with patch("app.trademark.search_wipo_trademarks", return_value=[]):
            for _ in range(3):
                r = client.post("/api/trademarks/sync", json={})
                assert r.status_code == status.HTTP_200_OK

        from app import db as dbmod
        gen = dbmod.get_session()
        s = next(gen)
        count = s.query(IpTrademark).count()
        gen.close()
        assert count == 5
