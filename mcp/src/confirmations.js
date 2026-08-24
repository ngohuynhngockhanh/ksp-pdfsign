import crypto from 'node:crypto'

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalPayloadHash(payload) {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex')
}

export class ConfirmationStore {
  #items = new Map()

  constructor({ clock = Date, ttlMs = 5 * 60 * 1000, randomBytes = crypto.randomBytes } = {}) {
    this.clock = clock
    this.ttlMs = ttlMs
    this.randomBytes = randomBytes
  }

  prepare(toolName, payload, { highRisk = false } = {}) {
    const now = this.clock.now()
    const token = this.randomBytes(32).toString('hex')
    const expiresAt = now + this.ttlMs
    this.#items.set(token, {
      toolName,
      payloadHash: canonicalPayloadHash(payload),
      expiresAt,
      highRisk,
    })
    return {
      confirmation_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      high_risk: highRisk,
    }
  }

  consume(token, toolName, payload) {
    const record = this.#items.get(String(token || ''))
    if (!record) return false
    this.#items.delete(token)
    if (record.expiresAt < this.clock.now()) return false
    if (record.toolName !== toolName) return false
    return record.payloadHash === canonicalPayloadHash(payload)
  }

  purgeExpired() {
    const now = this.clock.now()
    for (const [token, record] of this.#items) {
      if (record.expiresAt < now) this.#items.delete(token)
    }
  }
}
