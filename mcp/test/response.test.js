import test from 'node:test'
import assert from 'node:assert/strict'

import { errorEnvelope, successEnvelope, warningEnvelope } from '../src/response.js'

test('response helpers always return the MCP observation contract', () => {
  assert.deepEqual(successEnvelope('done', { id: 1 }), {
    status: 'success',
    summary: 'done',
    data: { id: 1 },
    next_actions: [],
    artifacts: [],
  })

  const warning = warningEnvelope('using cache', { source: 'cache' }, ['retry later'])
  assert.equal(warning.status, 'warning')
  assert.deepEqual(warning.next_actions, ['retry later'])

  const error = errorEnvelope('invalid_token', 'Invalid token', {
    retryable: false,
    rootCauseHint: 'token mismatch',
    safeRetry: 'refresh credentials',
    stopCondition: 'do not retry until token changes',
  })
  assert.equal(error.status, 'error')
  assert.equal(error.error.code, 'invalid_token')
  assert.equal(error.error.retryable, false)
})
