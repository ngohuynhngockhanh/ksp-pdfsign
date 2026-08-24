import test from 'node:test'
import assert from 'node:assert/strict'

import { BackendClient } from '../src/backend-client.js'

function response(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('backend client logs in, preserves the cookie, and retries once after 401', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/api/login')) return response(200, { ok: true }, { 'set-cookie': 'ksp_session=fixture; Path=/; HttpOnly' })
    if (calls.length === 2) return response(401, { detail: 'expired' })
    return response(200, { items: [] })
  }
  const client = new BackendClient({ baseUrl: 'http://127.0.0.1:2032', username: 'admin', password: 'fixture', fetchImpl })
  const result = await client.dispatch('crm_customers_search', { query: 'inut', page: 1, page_size: 10 })
  assert.deepEqual(result, { items: [] })
  assert.equal(calls.filter((call) => call.url.endsWith('/api/login')).length, 2)
  assert.match(calls.at(-1).options.headers.cookie, /ksp_session=fixture/)
})

test('backend client rejects path traversal identifiers before any request', async () => {
  const client = new BackendClient({ fetchImpl: async () => response(200, {}) })
  await assert.rejects(() => client.dispatch('crm_customer_get', { id: '../users/1' }), /invalid path identifier/)
})

test('backend client maps mutation operations to explicit allowlisted routes', async () => {
  const calls = []
  const client = new BackendClient({
    username: 'admin',
    password: 'fixture',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/api/login')) return response(200, {}, { 'set-cookie': 'ksp_session=fixture' })
      return response(200, { ok: true })
    },
  })
  await client.dispatch('bidding_bookmarks', { operation: 'update', payload: { id: 9, note: 'hello' } })
  assert.equal(calls.at(-1).options.method, 'PUT')
  assert.equal(calls.at(-1).url, 'http://127.0.0.1:2032/api/bidding/bookmarks/9')
  await assert.rejects(() => client.dispatch('bidding_bookmarks', { operation: 'drop_database', payload: {} }), /unsupported_operation/)
})

test('customer search applies accent-neutral filtering over the admin customer list', async () => {
  const client = new BackendClient({
    username: 'admin',
    password: 'fixture',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/login')) return response(200, {}, { 'set-cookie': 'ksp_session=fixture' })
      return response(200, [
        { name: 'Công ty INUT', tax_code: '4401053694', contact: '' },
        { name: 'Nhà cung cấp khác', tax_code: '0100000000', contact: '' },
      ])
    },
  })
  const result = await client.dispatch('crm_customers_search', { query: 'inut' })
  assert.equal(result.length, 1)
  assert.equal(result[0].tax_code, '4401053694')
})
