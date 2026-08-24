#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/inut-crm"
TOKEN_FILE="$TOKEN_DIR/inut-crm.token"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing $ROOT_DIR/.env; copy .env.example and configure the backend first." >&2
  exit 1
fi
if ! rg -q '^APP_ADMIN_PASSWORD=.{10,}$' "$ROOT_DIR/.env"; then
  echo "APP_ADMIN_PASSWORD is missing or too short in .env." >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js >=22 is required." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" --version | sed -E 's/^v([0-9]+).*/\1/')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js >=22 is required; found $("$NODE_BIN" --version)." >&2
  exit 1
fi

mkdir -p "$TOKEN_DIR" "$SERVICE_DIR"
chmod 700 "$TOKEN_DIR"
if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  "$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

npm --prefix "$ROOT_DIR/mcp" ci --omit=dev
sed "s#%h/ksp-pdfsign#$ROOT_DIR#g; s#%h/.config#${XDG_CONFIG_HOME:-$HOME/.config}#g" \
  "$ROOT_DIR/deploy/inut-crm-mcp.service" > "$SERVICE_DIR/inut-crm-mcp.service"

systemctl --user daemon-reload
systemctl --user enable --now inut-crm-mcp.service

"$ROOT_DIR/scripts/register-inut-crm-mcp.sh"

echo "inut-crm MCP service installed and started on http://127.0.0.1:2037"
echo "Token file: $TOKEN_FILE (contents intentionally not printed)"
