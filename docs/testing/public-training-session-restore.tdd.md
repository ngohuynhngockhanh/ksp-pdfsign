# Public Training Session Restore — TDD Evidence

## User Journeys

- As a returning visitor, I want the assistant to recognize my existing session so I do not re-enter my phone number.
- As a visitor, I want to reopen a previous question and see its complete sourced answer.
- As a privacy-conscious visitor, I want the browser and restore endpoint to expose only the last four phone digits.

## Evidence

| Guarantee | Test or check | Result |
|---|---|---|
| A signed session can be restored with masked phone metadata only | `backend/tests/test_public_training.py::test_public_session_can_be_restored_without_revealing_phone` | PASS |
| Existing public-training security contracts remain green | `.venv/bin/pytest -q tests/test_public_training.py` | 6 passed |
| No regression across the backend suite | `PYTHONWARNINGS=ignore .venv/bin/pytest -q` | 191 passed |
| Mobile and desktop assistant trigger shows `Hỏi đáp iNut` | Playwright smoke check against local/production builds | PASS |
| History wrapper payload reopens the nested Markdown answer | Playwright route-interception check | PASS |
| Impeccable detector finds no target component violations | `node .../detect.mjs --json src/components/common/AssistantWidget.tsx` | `[]` |

## RED/GREEN Checkpoint

- RED: restore test received the training SPA HTML because the GET endpoint did not exist.
- GREEN: `af9c180` adds the HMAC-protected restore endpoint and the targeted test passes.
- UI follow-up: `6b252f3` restores the session in the widget, normalizes history answers, and keeps a last-four marker in session storage; `2274f83` handles an unavailable upstream restore response safely.

## Privacy Notes

- Full phone numbers remain encrypted in the training database and in the HttpOnly session cookie flow.
- Browser `sessionStorage` keeps only the last four digits as a same-session fallback.
- The restore endpoint never returns the full phone number.

## Known Deployment Gap

The backend commits are pushed to GitHub, but the training host at `77.87.50.212` is not reachable with the available SSH key. The website is deployed and includes a session-storage fallback; deploying the backend commit will enable cross-tab/session restore through the new endpoint.
