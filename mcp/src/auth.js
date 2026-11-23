import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'

const SECRET_KEYS = /(?:^|[_-])(password|passwd|secret|token|pin|authorization|api[_-]?key|apikey|cookie|cookies|private[_-]?key|privatekey|credential|credentials|bearer|spx_sid|grant_token|refresh_token|client_secret)(?:$|[_-])/i
const SECRET_SUBSTRINGS = /password|passwd|secret|token|pin|authorization|api[_-]?key|cookie|private[_-]?key|credential|bearer/i
const SAFE_NON_SECRET_KEYS = /^(?:authenticated|has_password|has_refresh_token|has_client_secret|ai_api_key_set|nas_password_set|ihoadon_password_set|using_default_secrets|must_change_password|token_count|tokens|max_tokens|ai_max_tokens|tokenNote)$/i

export function readTokenFile(filePath) {
  if (!filePath) return ''
  return fs.readFileSync(filePath, 'utf8').trim()
}

export function createTokenAuthenticator({ token, tokenFile } = {}) {
  const configured = String(token || (tokenFile ? readTokenFile(tokenFile) : '')).trim()
  if (!configured) throw new Error('INUT_CRM_MCP_TOKEN_FILE or INUT_CRM_MCP_TOKEN is required')
  const expected = Buffer.from(configured, 'utf8')

  return {
    authenticate(header) {
      const value = String(header || '')
      const supplied = value.startsWith('Bearer ') ? Buffer.from(value.slice(7).trim(), 'utf8') : Buffer.alloc(0)
      const authenticated = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
      return { authenticated, actor: authenticated ? 'mcp-owner' : 'anonymous' }
    },
  }
}

export function isLoopbackAddress(address) {
  const value = String(address || '').replace(/^::ffff:/i, '')
  return value === 'localhost' || (net.isIP(value) === 4 && value.startsWith('127.')) || value === '::1'
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || (net.isIP(host) === 4 && host.startsWith('127.'))
}

export function isLoopbackHostHeader(hostHeader) {
  if (!hostHeader) return true
  const raw = String(hostHeader).trim()
  if (!raw || /[\s/\\@]/.test(raw)) return false
  try {
    const parsed = new URL(`http://${raw}`)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

export function isLoopbackOriginHeader(originHeader) {
  if (!originHeader) return true
  try {
    const parsed = new URL(String(originHeader).trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

export function redactErrorText(text) {
  return String(text || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [REDACTED]')
    .replace(/(password|passwd|secret|token|pin|api[_-]?key|cookie)\s*([:=])\s*([^\s,;"'&}]+)/gi, '$1$2[REDACTED]')
    .slice(0, 500)
}

function isSecretKey(key) {
  if (SAFE_NON_SECRET_KEYS.test(key)) return false
  return SECRET_KEYS.test(key) || SECRET_SUBSTRINGS.test(key)
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    isSecretKey(key) ? '[REDACTED]' : redactSecrets(nested),
  ]))
}
