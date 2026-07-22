from datetime import date

from app import tax_policy


def test_current_reduction_checkpoint():
    assert tax_policy.standard_rate(date(2026, 7, 23)) == 8
    assert tax_policy.standard_rate(date(2026, 7, 23), eligible_for_reduction=False) == 10
    assert tax_policy.standard_rate(date(2027, 1, 1)) == 10


def test_historical_reduction_checkpoints():
    assert tax_policy.standard_rate(date(2024, 3, 1)) == 8
    assert tax_policy.standard_rate(date(2025, 6, 30)) == 8
    assert tax_policy.standard_rate(date(2023, 3, 1)) == 10


def test_software_is_separate_from_zero_rate():
    snap = tax_policy.policy_snapshot(date(2026, 7, 23))
    assert snap["software_category"] == "KCT"
    assert any("không chịu thuế" in note for note in snap["notes"])
