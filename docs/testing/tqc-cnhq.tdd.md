# TQC CNHQ TDD evidence

Source plan: implementation plan agreed in the 2026-08-24 Codex session.

## User journeys

- An operator verifies an exact TQC certificate and stores its official model metadata.
- An operator searches already verified records by model, manufacturer, or applicant without overstating an index miss.
- An administrator imports bounded certificate/QR lists through web or MCP.
- Codex and Agy call typed read tools and use prepare/execute for imports.

## Evidence

| Guarantee | Test or command | Type | Result |
|---|---|---|---|
| Missing connector failed before implementation | `.venv/bin/python -m pytest -q tests/test_tqc_cnhq.py` | RED | 6 failed with `ModuleNotFoundError` |
| Exact lookup, Vietnam calendar dates, safe upstream errors, local search, API, 500-row progress, restart recovery and retry-race guards work | `.venv/bin/python -m pytest -q tests/test_tqc_cnhq.py tests/test_standards.py` | Unit/integration | 25 passed |
| MCP catalog, TQC job status/retry routing, auth, Streamable HTTP and legacy SSE compatibility work | `npm test` | Unit/integration | 18 passed |
| Frontend compiles and production bundle builds | `timeout 180s npm run build` | Build/type | PASS |
| Desktop and mobile cover model search, live lookup, preview/import, empty-search guidance, background CSV polling, reconnect and retry | `PLAYWRIGHT_PORT=4189 npm run test:e2e -- --project=desktop --project=mobile standards-tqc.spec.ts` | E2E | 14 passed |
| Connector and MCP line coverage exceed the project gate | `pytest --cov=app.tqc_cnhq`; `npm run test:coverage` | Coverage | 84% / 85.45% lines |
| Codex calls the installed TQC tool | ephemeral Codex call to `standards_tqc_status` | Live MCP | `official_exact_plus_local_index` |
| Agy calls the installed TQC tool over `/mcp` | Agy Streamable HTTP call to `standards_tqc_status` | Live MCP | `official_exact_plus_local_index` |
| Agy headless mode permits only this MCP server | `agy --print='/permissions'` | Local config | `mcp(inut-crm/*)` |
| Frontend and MCP production dependencies have no known audit findings | `npm audit --omit=dev` in both packages | Security | 0 vulnerabilities |

## Known gaps

- Official model-wide search remains disabled until TQC supplies a documented route and API key.
- The v1 index grows only from user-supplied certificate numbers, official QR payloads, CSV, or an authorized export.
- CSV imports persist payload, cursor and partial result in SQLite, report per-row progress, resume on backend startup, and expose latest/retry status endpoints.
- Full-repository coverage was not recalculated; targeted connector and MCP line coverage both exceed 80%.
