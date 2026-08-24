import test from 'node:test'
import assert from 'node:assert/strict'

import { createTokenAuthenticator, isLoopbackAddress, redactSecrets } from '../src/auth.js'

test('token authenticator accepts the configured bearer token only', () => {
  const expected = ['unit', 'fixture', 'value'].join('-')
  const auth = createTokenAuthenticator({ token: expected })
  assert.equal(auth.authenticate(`Bearer ${expected}`).authenticated, true)
  assert.equal(auth.authenticate('Bearer wrong').authenticated, false)
  assert.equal(auth.authenticate('').authenticated, false)
})

test('loopback validation rejects forwarded or public addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('192.168.1.10'), false)
  assert.equal(isLoopbackAddress('77.88.1.1'), false)
})

test('redaction removes credentials recursively without mutating input', () => {
  const input = {
    password: 'secret',
    nested: { pin: '1234', token: 'bearer' },
    safe: 'ok',
  }
  const output = redactSecrets(input)
  assert.deepEqual(output, {
    password: '[REDACTED]',
    nested: { pin: '[REDACTED]', token: '[REDACTED]' },
    safe: 'ok',
  })
  assert.equal(input.password, 'secret')
})
