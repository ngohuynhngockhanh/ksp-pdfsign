# TQC CNHQ API research and operating contract

Updated: 2026-08-24

## Verified public surface

- Official lookup site: <https://data-cnhq.tqc.gov.vn/>
- Health endpoint: `GET https://api-cnhq.tqc.gov.vn/api/status`
- Exact lookup: `GET https://api-cnhq.tqc.gov.vn/api/search/{so_giay_chung_nhan}`
- The exact lookup route returns `success`, `data`, or `error=NOT_FOUND` without requiring an API key.
- Observed response fields include certificate number, issue/expiry dates, applicant, product, model (`ky_hieu`), manufacturer, factory, technical regulations, method, serial form, and source status.
- The API advertises `500` requests per 60 seconds. The connector deliberately stays below that at `450` requests per minute.
- TQC date-time values ending in `Z` represent Vietnamese calendar dates; the index converts them to `Asia/Ho_Chi_Minh` before applying `valid_on` and expiry logic.

The official TQC notice says the application was launched on 2025-06-02 and is intended for lookup by QR code or certificate number:

<https://tqc.gov.vn/thong-bao-trien-khai-ung-dung-tra-cuu-thong-tin-giay-cnhq-cua-trung-tam-do-luong-chat-luong-vien-thong/>

The public frontend bundle calls only `/api/status` and `/api/search/{number}`. Collection-style routes tested without an authorized key return HTTP 401, so this project does not guess, brute-force, or bypass those routes.

## QR handling

TQC's public frontend generates QR URLs as `https://data-cnhq.tqc.gov.vn/?q=<payload>`. The payload is CryptoJS passphrase AES output using the public frontend constant `tqc_K2p9x`, encoded with URL-safe base64. The backend decodes this only to reproduce the official client flow and then performs the normal exact lookup. It does not grant access to any additional data.

## Local model index

Because the public API does not expose model search, `inut-crm` stores normalized records only after a user supplies a certificate number, official QR URL/payload, CSV row, or an official TQC export. A miss in this local index is reported as `not_found_in_local_index`; it is never interpreted as proof that TQC has no certificate.

JSON imports are capped at 100 entries. CSV imports accept up to 500 rows and run as pollable background jobs; payload, cursor and partial result are persisted in SQLite so an interrupted job resumes on backend startup. The background connector waits for the next shared rate-limit window instead of failing remaining rows or holding the upload request open.

The web UI and MCP expose latest/job status plus a guarded retry for failed CSV imports; retry is rejected while an active worker is still cleaning up.

## Request to TQC

Before enabling official model search, obtain written confirmation of:

1. the documented collection/model-search path and query schema;
2. API key issuance, quota, and allowed automation;
3. export or synchronization format and update cadence;
4. permitted storage, display, and retention of certificate data.

Public contact listed by TQC: `tqc@tqc.gov.vn`, `024.39436608`.
