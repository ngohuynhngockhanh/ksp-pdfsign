# Project: 2-Way QCVN & Technical Standards Lookup Solution

## Architecture
The system implements a high-performance, 2-way technical standards and conformity certification lookup engine for Vietnamese regulations (QCVN / TCVN / CNHQ / CBHQ), integrating seamlessly with the KSP iNut backend.

### High-Level Architecture Diagram
```
                     ┌────────────────────────────────────────────────────────┐
                     │               Client / API Consumers                   │
                     └─────────────────────────┬──────────────────────────────┘
                                               │
                                 RESTful API Endpoints (/api/standards/...)
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               │                                                               │
  ┌────────────▼──────────────┐                                 ┌──────────────▼──────────────┐
  │ Direction 1 Lookup Engine │                                 │ Direction 2 Lookup Engine   │
  │ (Model/Keyword/HS -> QCVN)│                                 │ (MST/Company -> Dossier/QCVN)
  └────────────┬──────────────┘                                 └──────────────┬──────────────┘
               │                                                               │
               ├───────────────────────────────┬───────────────────────────────┤
               │                               │                               │
  ┌────────────▼──────────────┐  ┌─────────────▼───────────────┐ ┌─────────────▼──────────────┐
  │ Tier 1: Exact Match       │  │ Tier 2: FTS5 / Normalized   │ │ Tier 3: Fuzzy / Levenshtein│
  │ B-Tree Index / RAM Cache  │  │ Unicode61 Prefix Matching   │ │ Trigram / Distance Engine  │
  │ (< 5ms)                   │  │ (< 15ms)                    │ │ (< 35ms)                   │
  └────────────┬──────────────┘  └─────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │                               │
               └───────────────────────────────┼───────────────────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               │               Data Storage & Knowledge Services               │
               ├───────────────────────────────────────────────────────────────┤
               │ • `tqc_certificates` (enhanced with tax_code & compound index)│
               │ • `StandardsRegistryService` (Curated QCVN/TCVN Knowledge)    │
               │ • `RuleInferenceEngine` (Spec/HS-code -> Mandatory QCVNs)     │
               │ • `TqcLiveGateway` (api-cnhq.tqc.gov.vn exact verification)  │
               └───────────────────────────────────────────────────────────────┘
```

### Module Boundaries
- `backend/app/standards.py`: Core business logic, `StandardsRegistryService`, `RuleInferenceEngine`, `HsCodeConformityService`, `TwoWayLookupService`.
- `backend/app/standards_api.py`: FastAPI router with `/api/standards/lookup/model`, `/api/standards/lookup/tax-code`, `/api/standards/suggest`, `/api/standards/rules`.
- `backend/app/db.py`: ORM models (`TqcCertificate` with `tax_code`, `tax_code_norm`, and relevant indexes).
- `backend/app/tqc_cnhq.py`: Exact GCN lookup client, AES QR payload decryptor, background CSV sync jobs.
- `backend/tests/test_standards_2way.py`: Comprehensive automated test suite for 2-way lookups, fuzzy matching, auto-complete, and performance benchmarks.
- `docs/QCVN_TWO_WAY_LOOKUP_RESEARCH_REPORT.md`: Comprehensive Research & Production Architecture Report.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Direction 1: Model -> QCVN Lookup | Lookup by device model, product keyword, or HS code returning applicable mandatory/recommended QCVN, legal circular basis, testing parameters, and assigned labs | M2 | ORIGINAL_REQUEST R2 |
| F2 | Direction 1: Rule-Based QCVN Inference | Infer mandatory QCVN standards for novel/unseen models based on wireless technologies (4G, 5G, Wi-Fi 2.4/5G, BLE), battery, safety, and HS code | M2 | ORIGINAL_REQUEST R2 |
| F3 | Direction 2: MST -> Dossier & QCVN Lookup | Lookup by enterprise Tax ID (MST) or Company Name returning conformity dossiers (CNHQ/CBHQ), certified models, active QCVNs, and validity status | M2 | ORIGINAL_REQUEST R2 |
| F4 | 3-Tier Fast Search Engine | Sub-50ms hybrid search engine combining exact B-Tree lookup, unaccented normalized prefix search, and Levenshtein/trigram fuzzy matching | M2 | ORIGINAL_REQUEST R2 |
| F5 | Auto-Complete & Suggestion API | Quick suggestion endpoint (`/api/standards/suggest`) providing instant auto-complete across models, MSTs, company names, and QCVN codes | M2 | ORIGINAL_REQUEST R2 |
| F6 | Multi-Param Filter & Pagination | Support filtering by ministry, mandatory/voluntary status, validity status, and standard pagination (`limit`, `offset`, total count) | M2 | ORIGINAL_REQUEST R2 |
| F7 | Realistic Benchmark Dataset | Curated realistic dataset with 10 typical telecom/IoT/electronics device models and 6 enterprise MST profiles with real-world dossiers | M2 | ORIGINAL_REQUEST R3 |
| F8 | Automated Test Suite (100% Pass) | Comprehensive unit, integration, fuzzy, boundary, and benchmark tests verifying both lookup directions, error handling, and latency | M4 | ORIGINAL_REQUEST R3 |
| F9 | Research & Production Architecture Report | In-depth technical report covering current state evaluation, FTS vs Vector trade-offs, auto-sync strategies (NQI/NSW), and production roadmap | M3 | ORIGINAL_REQUEST R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Schema & Data Models Enhancement | Add `tax_code`, `tax_code_norm` to `TqcCertificate` in `backend/app/db.py`, create migration logic, populate seed data with benchmark models and enterprise MSTs | none | DONE |
| M2 | 2-Way Search Engine & RESTful API | Implement `TwoWayLookupService` in `standards.py` with 3-tier search, rule-based inference, and new REST endpoints in `standards_api.py` | M1 | DONE |
| M3 | Research & Production Architecture Report | Write comprehensive research and architecture report in `docs/QCVN_TWO_WAY_LOOKUP_RESEARCH_REPORT.md` satisfying all R1, R2, R4 requirements | M1, M2 | DONE |
| M4 | E2E Testing Suite & Verification Gate | Implement automated test suite `backend/tests/test_standards_2way.py`, run verification, challenge tests, and forensic audit (271/271 passed) | M2, M3 | DONE |

## Interface Contracts
### Direction 1: Model -> QCVN Endpoint
- `GET /api/standards/lookup/model`
  - Query params: `query` (string, required), `hs_code` (optional), `ministry` (optional), `mandatory_only` (bool, default False), `fuzzy` (bool, default True), `limit` (int, default 20), `offset` (int, default 0)
  - Response:
    ```json
    {
      "query": "iNut-GW4G-Pro",
      "total_matches": 1,
      "exact_dossiers": [ ... ],
      "applicable_standards": [
        {
          "code": "QCVN 117:2023/BTTTT",
          "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất",
          "issuing_ministry": "BTTTT",
          "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
          "mandatory": true,
          "effective_date": "2024-07-01",
          "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"]
        }
      ],
      "inferred_rules": [ ... ],
      "execution_time_ms": 4.2
    }
    ```

### Direction 2: MST -> Dossier & QCVN Endpoint
- `GET /api/standards/lookup/tax-code`
  - Query params: `tax_code` (string, optional), `company_name` (string, optional), `status` (optional: 'active'|'expired'|'all'), `limit` (int, default 20), `offset` (int, default 0)
  - Response:
    ```json
    {
      "tax_code": "4401053694",
      "company_name": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
      "compliance_summary": {
        "total_dossiers": 3,
        "active_dossiers": 3,
        "expired_dossiers": 0,
        "unique_standards_count": 5
      },
      "dossiers": [ ... ],
      "active_qcvn_list": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
      "execution_time_ms": 3.8
    }
    ```

### Suggestion / Auto-Complete Endpoint
- `GET /api/standards/suggest`
  - Query params: `q` (string, required, min_length 2), `type` (optional: 'all'|'model'|'tax_code'|'company'|'qcvn'), `limit` (int, default 10)
  - Response:
    ```json
    {
      "query": "inut",
      "suggestions": [
        {"type": "company", "text": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT", "meta": "MST: 4401053694"},
        {"type": "model", "text": "iNut-GW4G-Pro", "meta": "Bộ truyền dữ liệu IoT 4G"},
        {"type": "tax_code", "text": "4401053694", "meta": "Công ty TNHH Phát Triển Công Nghệ INUT"}
      ],
      "execution_time_ms": 2.1
    }
    ```

## Code Layout
- `backend/app/db.py`: Database models and schemas.
- `backend/app/standards.py`: Business logic, services, knowledge base, and search algorithm.
- `backend/app/standards_api.py`: FastAPI endpoints and schemas.
- `backend/tests/test_standards_2way.py`: 2-way lookup test suite.
- `docs/QCVN_TWO_WAY_LOOKUP_RESEARCH_REPORT.md`: Research & Architecture documentation.
