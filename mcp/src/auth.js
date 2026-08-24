import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'

const SECRET_KEYS = /password|passwd|secret|token|pin|authorization|api[_-]?key|cookie/i

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
  return value === 'localhost' || net.isIP(value) === 4 && value.startsWith('127.') || value === '::1'
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    SECRET_KEYS.test(key) ? '[REDACTED]' : redactSecrets(nested),
  ]))
}
