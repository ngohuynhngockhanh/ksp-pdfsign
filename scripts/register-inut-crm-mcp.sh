#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

# NOTE: Do NOT export INUT_CRM_MCP_TOKEN globally in ~/.bashrc.
# Scope token usage to Codex/MCP launchers only (e.g. via environment.d or explicit env).

if command -v codex >/dev/null 2>&1; then
  codex mcp remove inut-crm >/dev/null 2>&1 || true
  codex mcp add inut-crm --url http://127.0.0.1:2037/mcp --bearer-token-env-var INUT_CRM_MCP_TOKEN >/dev/null
fi

if command -v agy >/dev/null 2>&1; then
  AGY_SETTINGS="$HOME/.gemini/antigravity-cli/settings.json"
  # Register agy MCP server via settings.json (avoids passing bearer token on CLI argv)
  # and allowlist ONLY read-only MCP tools (never a wildcard rule).
  INUT_CRM_MCP_TOKEN="$token" node - "$AGY_SETTINGS" "$ROOT_DIR/mcp/src/catalog.js" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

;(async () => {
  const settingsPath = process.argv[2]
  const catalogPath = process.argv[3]
  const bearerToken = process.env.INUT_CRM_MCP_TOKEN || ''
  const { toolDefinitions } = await import(pathToFileURL(catalogPath).href)
  const readOnlyRules = toolDefinitions
    .filter((t) => t.access === 'read' && t.execution === 'read')
    .map((t) => `mcp(inut-crm/${t.name})`)

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 })
  const settings = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    : {}
  const permissions = settings.permissions && typeof settings.permissions === 'object'
    ? settings.permissions
    : {}
  const existingAllow = Array.isArray(permissions.allow) ? permissions.allow : []
  const filteredAllow = existingAllow.filter(
    (rule) => !(typeof rule === 'string' && rule.startsWith('mcp(inut-crm/') && rule.endsWith('/*)')),
  )
  for (const rule of readOnlyRules) {
    if (!filteredAllow.includes(rule)) filteredAllow.push(rule)
  }

  const mcpServers = settings.mcpServers && typeof settings.mcpServers === 'object'
    ? settings.mcpServers
    : {}
  const next = {
    ...settings,
    mcpServers: {
      ...mcpServers,
      'inut-crm': {
        type: 'http',
        url: 'http://127.0.0.1:2037/mcp',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      },
    },
    permissions: {
      ...permissions,
      allow: filteredAllow,
    },
  }
  const temporaryPath = `${settingsPath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, settingsPath)
})().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
NODE
fi

echo "Codex and agy registrations updated for inut-crm (read-only tool allowlist; no ~/.bashrc export; token not printed)."
