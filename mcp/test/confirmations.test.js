import test from 'node:test'
import assert from 'node:assert/strict'

import { ConfirmationStore, canonicalPayloadHash } from '../src/confirmations.js'

test('confirmation store requires the exact payload and consumes tokens once', () => {
  const clock = { now: () => 1_000 }
  const store = new ConfirmationStore({ clock, ttlMs: 5_000 })
  const payload = { operation: 'delete_customer', id: 42, note: 'keep' }
  const prepared = store.prepare('crm_customer_write', payload, { highRisk: true })

  assert.equal(prepared.expires_at, new Date(6_000).toISOString())
  assert.equal(store.consume(prepared.confirmation_token, 'crm_customer_write', payload), true)
  assert.equal(store.consume(prepared.confirmation_token, 'crm_customer_write', payload), false)
})

test('confirmation store rejects payload changes and expiry', () => {
  let now = 10_000
  const store = new ConfirmationStore({ clock: { now: () => now }, ttlMs: 100 })
  const payload = { operation: 'send_telegram', message: 'hello' }
  const prepared = store.prepare('telegram', payload, { highRisk: true })

  assert.equal(store.consume(prepared.confirmation_token, 'telegram', { ...payload, message: 'tampered' }), false)
  now = 10_101
  assert.equal(store.consume(prepared.confirmation_token, 'telegram', payload), false)
  assert.equal(canonicalPayloadHash(payload), canonicalPayloadHash({ message: 'hello', operation: 'send_telegram' }))
})
