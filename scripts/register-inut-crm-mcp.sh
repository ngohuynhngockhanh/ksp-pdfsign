#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${INUT_CRM_MCP_TOKEN_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/inut-crm/inut-crm.token}"
if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "MCP token file is missing: $TOKEN_FILE" >&2
  exit 1
fi
token="$(<"$TOKEN_FILE")"
if [[ -z "$token" ]]; then
  echo "MCP token file is empty." >&2
  exit 1
fi

ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"
mkdir -p "$ENV_DIR"
umask 077
printf 'INUT_CRM_MCP_TOKEN=%s\n' "$token" > "$ENV_DIR/inut-crm.conf"
chmod 600 "$ENV_DIR/inut-crm.conf"

if command -v codex >/dev/null 2>&1; then
  codex mcp remove inut-crm >/dev/null 2>&1 || true
  codex mcp add inut-crm --url http://127.0.0.1:2037/mcp --bearer-token-env-var INUT_CRM_MCP_TOKEN >/dev/null
fi

if command -v agy >/dev/null 2>&1; then
  agy mcp add --type http --header "Authorization: Bearer $token" inut-crm http://127.0.0.1:2037/sse >/dev/null
fi

echo "Codex and agy registrations updated for inut-crm; token contents were not printed."
