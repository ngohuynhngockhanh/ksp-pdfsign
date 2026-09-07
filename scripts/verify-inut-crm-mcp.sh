#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${INUT_CRM_MCP_TOKEN_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/inut-crm/inut-crm.token}"
MCP_URL="${INUT_CRM_MCP_HEALTH_URL:-http://127.0.0.1:2037/health}"
if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "MCP token file is missing: $TOKEN_FILE" >&2
  exit 1
fi

token="$(<"$TOKEN_FILE")"
health=""
for attempt in $(seq 1 30); do
  if health="$(curl --fail --silent --show-error --max-time 2 --header "Authorization: Bearer $token" "$MCP_URL")"; then
    break
  fi
  health=""
  sleep 0.2
done
if [[ -z "$health" ]]; then
  echo "MCP health endpoint did not become ready: $MCP_URL" >&2
  exit 1
fi
node_count="$(node -e 'const value=JSON.parse(process.argv[1]); if (!value.ok || value.service !== "inut-crm") process.exit(1); console.log(value.tools_count)' "$health")"
if (( node_count < 50 )); then
  echo "Unexpected tool count: $node_count" >&2
  exit 1
fi
echo "inut-crm MCP healthy; tools=$node_count"
