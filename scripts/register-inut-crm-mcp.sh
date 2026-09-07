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

# environment.d is consumed by systemd sessions, but interactive Codex shells
# also need the token exported before they start the MCP client.
SHELL_ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/inut-crm/inut-crm.env.sh"
printf 'export INUT_CRM_MCP_TOKEN="$(<%q)"\n' "$TOKEN_FILE" > "$SHELL_ENV_FILE"
chmod 600 "$SHELL_ENV_FILE"
SHELL_RC="$HOME/.bashrc"
SOURCE_MARKER="# INUT CRM MCP token (managed by register-inut-crm-mcp.sh)"
if [[ -f "$SHELL_RC" ]] && ! grep -Fqx "$SOURCE_MARKER" "$SHELL_RC"; then
  {
    printf '\n%s\n' "$SOURCE_MARKER"
    printf 'if [[ -r %q ]]; then . %q; fi\n' "$SHELL_ENV_FILE" "$SHELL_ENV_FILE"
  } >> "$SHELL_RC"
fi

if command -v codex >/dev/null 2>&1; then
  codex mcp remove inut-crm >/dev/null 2>&1 || true
  codex mcp add inut-crm --url http://127.0.0.1:2037/mcp --bearer-token-env-var INUT_CRM_MCP_TOKEN >/dev/null
fi

if command -v agy >/dev/null 2>&1; then
  agy mcp add --type http --header "Authorization: Bearer $token" inut-crm http://127.0.0.1:2037/mcp >/dev/null
  AGY_SETTINGS="$HOME/.gemini/antigravity-cli/settings.json"
  node - "$AGY_SETTINGS" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const settingsPath = process.argv[2]
fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 })
const settings = fs.existsSync(settingsPath)
  ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  : {}
const permissions = settings.permissions && typeof settings.permissions === 'object'
  ? settings.permissions
  : {}
const allow = Array.isArray(permissions.allow) ? permissions.allow : []
const rule = 'mcp(inut-crm/*)'
const next = {
  ...settings,
  permissions: {
    ...permissions,
    allow: allow.includes(rule) ? allow : [...allow, rule],
  },
}
const temporaryPath = `${settingsPath}.tmp`
fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
fs.renameSync(temporaryPath, settingsPath)
NODE
fi

echo "Codex and agy registrations updated for inut-crm; token contents were not printed."
