# E2E Test Infra: 2-Way QCVN & Technical Standards Lookup Solution

## Test Philosophy
- Opaque-box, requirement-driven, and white-box unit & integration testing.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing.
- Target: 100% test pass with sub-50ms query latency SLA.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| F1 | Direction 1: Model -> QCVN Lookup | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F2 | Direction 1: Rule-Based QCVN Inference | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F3 | Direction 2: MST -> Dossier/QCVN Lookup | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F4 | 3-Tier Search (Exact, FTS, Fuzzy) | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F5 | Auto-Complete & Suggestion API | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F6 | Multi-Param Filter & Pagination | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ | ✓ |
| F7 | Realistic Benchmark Dataset | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ | ✓ |
| F8 | Sub-50ms Response SLA | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test Runner: `pytest` using backend virtualenv (`backend/.venv/bin/pytest`)
- Test Files:
  - `backend/tests/test_standards.py` (Existing baseline tests: 5 tests)
  - `backend/tests/test_tqc_cnhq.py` (Existing TQC connector & job tests: 20 tests)
  - `backend/tests/test_standards_2way.py` (Comprehensive 2-way lookup test suite: 25+ tests covering Tiers 1-4)
- Invocation: `pytest backend/tests/test_standards.py backend/tests/test_standards_2way.py -v`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Telecom Import: Lookup 4G/VoLTE IoT Gateway (iNut-GW4G-Pro / HS 8517.62.59) -> Mandatory QCVN 117:2023, QCVN 54, QCVN 18, QCVN 101, QCVN 132 | F1, F2, F4, F6 | High |
| 2 | Smart Screen Import: Lookup Smart Display (CPH2699 / RK3588) -> QCVN 54 (Wi-Fi), QCVN 65 (5GHz), QCVN 18 (EMC), QCVN 132 (Safety) | F1, F2, F4, F7 | Medium |
| 3 | Enterprise Compliance Audit: Lookup MST `4401053694` (INUT) -> 3 active dossiers, 5 active QCVNs, 0 expired | F3, F6, F7 | Medium |
| 4 | Enterprise Multi-Dossier Check: Lookup MST `0100109106` (Viettel) -> Multiple 4G/5G dossiers, active vs expired breakdown | F3, F6, F7 | High |
| 5 | Fuzzy Query with Typos: Search `iNut GW4G Pro` without dash and `cong ty phat trien cong nghe inut` without accents -> Exact matches retrieved with score >= 0.85 | F4, F5, F8 | High |

## Coverage Thresholds
- Tier 1 (Feature Coverage): ≥5 tests per feature (Happy path isolation).
- Tier 2 (Boundary & Corner): ≥5 tests per feature (Empty query, non-existent MST, invalid HS code, extreme pagination, special characters).
- Tier 3 (Cross-Feature): Pairwise combinations (Fuzzy search + Pagination + Ministry filter; MST lookup + status filter + auto-complete).
- Tier 4 (Real-World Workloads): Realistic telecom, IT, smart device, and enterprise tax ID scenarios.
