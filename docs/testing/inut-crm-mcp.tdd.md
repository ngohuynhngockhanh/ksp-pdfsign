# inut-crm MCP TDD Evidence

## User journeys

- Owner can discover and call `inut-crm` from Codex over Streamable HTTP.
- Owner can discover and call `inut-crm` from agy-compatible SSE transport.
- Read tools proxy typed KSP REST operations and return deterministic envelopes.
- Mutations require a prepare preview and a one-time confirmation token.
- Invalid tokens, non-loopback requests, replayed confirmations, and path traversal are rejected.

## Evidence

| Guarantee | Validation | Result |
|---|---|---|
| Response envelope is stable | `npm test` (`response.test.js`) | PASS |
| Bearer auth is constant-time and loopback-only | `npm test` (`auth.test.js`), `backend/.venv/bin/pytest -q tests/test_mcp_auth.py` | PASS |
| Confirmation payload is exact and single-use | `npm test` (`confirmations.test.js`) | PASS |
| Backend session/cookie retry and allowlisted routes work | `npm test` (`backend-client.test.js`) | PASS |
| Tax sync date aliases reach the backend as `tu`/`den` | `npm test` (`backend-client.test.js`) | PASS |
| Streamable HTTP handshake and tool call work | `npm test` (`server.test.js`) | PASS |
| Both MCP transports are live on the machine | `npm run smoke` / `node scripts/smoke-inut-crm-mcp.mjs` | PASS; 62 tools |
| Gateway service starts automatically | `systemctl --user status inut-crm-mcp.service` | PASS; active |
| Codex discovers and calls `inut_crm_health` | `codex exec ...` with `INUT_CRM_MCP_TOKEN` | PASS |
| agy registration is present and SSE protocol works | `agy mcp list`, SDK SSE smoke | PASS |
| Dependency audit is clean | `npm audit --audit-level=high` | PASS; 0 vulnerabilities |

## RED/GREEN checkpoints

- RED: initial MCP tests failed because `mcp/src/*` did not exist.
- GREEN: gateway foundation tests passed (`12/12`), then expanded coverage passed (`13/13`).
- Backend local bearer test passed after adding loopback-only `authenticate_mcp_bearer`.

## Known gaps

- The complete existing KSP pytest selection (`test_mcp_auth.py`, bidding unit, and adversarial suites) exceeded the 120-second validation window in this environment; the MCP-specific suite and live smoke checks passed.
- Agy headless model invocation timed out/returned an unrelated required-argument error while other configured remote MCP servers were being initialized. Its `inut-crm` registration is enabled and the same SSE endpoint was called successfully by the official MCP client SDK.
- `pip-audit --local` reports 27 vulnerabilities in nine pre-existing backend packages, including `python-jose`, `python-multipart`, `starlette`, `cryptography`, and `pypdf`; dependency remediation is not included in this MCP-only change because it requires a separate compatibility pass across the existing application.
