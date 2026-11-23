import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { BackendClient } from '../src/backend-client.js'
import { ConfirmationStore } from '../src/confirmations.js'
import { getToolDefinition, toolDefinitions } from '../src/catalog.js'
import { createHttpServer, createRuntime, invokeTool } from '../src/server.js'

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sendRawHttp({ port, method = 'GET', path: reqPath = '/health', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// --- TC-SEC-19: MCP Path Traversal & Allowlist Enforcement ---
test('TC-SEC-19: rejects filters.report/resource traversal and dot-segment IDs before fetch', async () => {
  const calls = []
  const client = new BackendClient({
    baseUrl: 'http://127.0.0.1:2032',
    bearerToken: 'backend-service-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return jsonResp(200, { ok: true })
    },
  })

  await assert.rejects(
    () => client.dispatch('inventory_stock', { filters: { report: '../../api/settings' } }),
    /unsupported_resource/,
  )
  await assert.rejects(
    () => client.dispatch('payroll', { filters: { resource: '../audit' } }),
    /unsupported_resource/,
  )
  await assert.rejects(
    () => client.dispatch('nas', { filters: { resource: '../../api/users' } }),
    /unsupported_resource/,
  )
  await assert.rejects(
    () => client.dispatch('spx', { filters: { resource: '../tax/credentials' } }),
    /unsupported_resource/,
  )
  await assert.rejects(
    () => client.dispatch('standards', { filters: { resource: '../../api/settings' } }),
    /unsupported_resource/,
  )
  await assert.rejects(
    () => client.dispatch('crm_customer_get', { id: '..' }),
    /invalid path identifier/,
  )
  await assert.rejects(
    () => client.dispatch('crm_customer_get', { id: '.' }),
    /invalid path identifier/,
  )
  await assert.rejects(
    () => client.dispatch('crm_customer_get', { id: '%2e%2e' }),
    /invalid path identifier/,
  )
  await assert.rejects(
    () => client.dispatch('crm_document_get', { id: '../settings' }),
    /invalid path identifier/,
  )
  await assert.rejects(
    () => client.request('/api/inv/../../api/settings'),
    /invalid_path/,
  )
  await assert.rejects(
    () => client.request('https://evil.example/api/settings'),
    /invalid_path/,
  )

  assert.equal(calls.length, 0, 'zero outbound backend requests may occur on traversal attempts')

  // Valid allowlisted stock report still succeeds cleanly
  await client.dispatch('inventory_stock', { filters: { report: 'availability' } })
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:2032\/api\/inv\/availability/)
  assert.ok(calls[0].options.signal, 'fetch request must include timeout AbortSignal')
})

// --- TC-SEC-20: Auth, DNS Rebinding Host/Origin, Operation Spoofing, Crash Resilience, Token Separation ---
test('TC-SEC-20: blocks operation spoofing via args.payload.operation in confirmation hash', async () => {
  const dispatchCalls = []
  const tmpAudit = path.join(os.tmpdir(), `mcp-sec20-audit-${Date.now()}.jsonl`)
  const clientAuthVal = 'client-mcp-token-value'
  const backendAuthVal = 'separate-backend-token-value'
  const runtime = createRuntime({
    token: clientAuthVal,
    backendToken: backendAuthVal,
    backendClient: {
      baseUrl: 'http://127.0.0.1:2032',
      dispatch: async (tool, args) => {
        dispatchCalls.push({ tool, args })
        return { ok: true }
      },
    },
    auditPath: tmpAudit,
  })
  const def = getToolDefinition('bidding_bookmarks')

  // Attacker prepares benign "update" while smuggling operation:"delete" inside payload
  const prepared = await invokeTool(def, {
    mode: 'prepare',
    operation: 'update',
    payload: { id: 1, operation: 'delete' },
  }, runtime)
  assert.equal(prepared.status, 'warning')
  const token = prepared.data.confirmation.confirmation_token
  assert.ok(token)

  // Attacker tries to execute "delete" using the token prepared for "update"
  const spoofed = await invokeTool(def, {
    mode: 'execute',
    confirm: true,
    confirmation_token: token,
    operation: 'delete',
    payload: { id: 1 },
  }, runtime)
  assert.equal(spoofed.status, 'error')
  assert.equal(spoofed.error.code, 'invalid_confirmation')
  assert.equal(dispatchCalls.length, 0)

  fs.rmSync(tmpAudit, { force: true })
})

test('TC-SEC-20: enforces auth, rejects non-loopback Host/Origin, survives malformed & oversized JSON', async () => {
  const tmpAudit = path.join(os.tmpdir(), `mcp-sec20-http-${Date.now()}.jsonl`)
  const clientToken = 'client-token-0001'
  const backendToken = 'backend-token-9999'
  const backendAuthSeen = []

  const runtime = createRuntime({
    token: clientToken,
    backendClient: new BackendClient({
      baseUrl: 'http://127.0.0.1:2032',
      bearerToken: backendToken,
      fetchImpl: async (_url, options) => {
        backendAuthSeen.push(options.headers.authorization)
        const sampleRedactedVal = 'sample-value-should-redact'
        return jsonResp(200, { ok: true, api_key: sampleRedactedVal })
      },
    }),
    auditPath: tmpAudit,
  })

  const server = createHttpServer(runtime)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    // (a) Unauthenticated /mcp & /sse rejected with 401
    const unauthMcp = await sendRawHttp({ port, method: 'POST', path: '/mcp', body: '{}' })
    assert.equal(unauthMcp.status, 401)
    const unauthSse = await sendRawHttp({ port, method: 'GET', path: '/sse' })
    assert.equal(unauthSse.status, 401)

    // DNS rebinding Host & Origin checks -> 403 even with valid Bearer token
    const badHost = await sendRawHttp({
      port,
      method: 'GET',
      path: '/health',
      headers: { host: 'evil.com', authorization: `Bearer ${clientToken}` },
    })
    assert.equal(badHost.status, 403)
    const badOrigin = await sendRawHttp({
      port,
      method: 'GET',
      path: '/health',
      headers: { origin: 'https://evil.com', authorization: `Bearer ${clientToken}` },
    })
    assert.equal(badOrigin.status, 403)

    // (c) Malformed JSON -> 400 (no crash!)
    const badJson = await sendRawHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: {
        authorization: `Bearer ${clientToken}`,
        'content-type': 'application/json',
      },
      body: '{bad',
    })
    assert.equal(badJson.status, 400)

    // Oversized >1MB JSON -> 413 (no crash!)
    const bigBody = 'a'.repeat(1_050_000)
    const oversized = await sendRawHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: {
        authorization: `Bearer ${clientToken}`,
        'content-type': 'application/json',
      },
      body: bigBody,
    }).catch((err) => ({ status: err.code === 'ECONNRESET' ? 413 : 0 }))
    assert.ok([413, 0].includes(oversized.status))

    // Server stays alive after malformed & oversized requests
    const alive = await sendRawHttp({
      port,
      method: 'GET',
      path: '/health',
      headers: { authorization: `Bearer ${clientToken}` },
    })
    assert.equal(alive.status, 200)

    // (d) Decoupled backend token is sent to backend, NOT client token; secrets redacted in tool output
    const healthRes = await invokeTool(getToolDefinition('inut_crm_health'), {}, runtime)
    assert.equal(healthRes.status, 'success')
    assert.equal(backendAuthSeen[0], `Bearer ${backendToken}`)
    assert.notEqual(backendAuthSeen[0], `Bearer ${clientToken}`)
    assert.equal(healthRes.data.backend.api_key, '[REDACTED]')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tmpAudit, { force: true })
  }
})

test('ConfirmationStore purges expired entries and enforces maxItems cap', () => {
  let now = 1_000
  const store = new ConfirmationStore({ clock: { now: () => now }, ttlMs: 100, maxItems: 3 })
  store.prepare('t1', { operation: 'a', payload: { i: 1 } })
  store.prepare('t1', { operation: 'a', payload: { i: 2 } })
  store.prepare('t1', { operation: 'a', payload: { i: 3 } })
  store.prepare('t1', { operation: 'a', payload: { i: 4 } })
  assert.equal(store.size, 3)

  now = 2_000
  store.prepare('t1', { operation: 'a', payload: { i: 5 } })
  assert.equal(store.size, 1)
})

// --- TC-BIZ-11: MCP Tool Contract, Valid Prepare->Execute + Replay Reject, Both Transports ---
test('TC-BIZ-11: valid prepare->execute succeeds once, rejects replay, and serves StreamableHTTP + SSE', async () => {
  const tmpAudit = path.join(os.tmpdir(), `mcp-biz11-${Date.now()}.jsonl`)
  // Pre-seed one malformed JSONL line to verify audit tail skips corrupted lines safely
  fs.writeFileSync(tmpAudit, '{"corrupt\n')

  const executed = []
  const biz11ClientAuth = 'biz11-client-token'
  const runtime = createRuntime({
    token: biz11ClientAuth,
    backendClient: {
      baseUrl: 'http://127.0.0.1:2032',
      request: async () => ({ ok: true }),
      dispatch: async (tool, args) => {
        executed.push({ tool, args })
        return { ok: true, id: 7 }
      },
    },
    auditPath: tmpAudit,
  })

  const def = getToolDefinition('bidding_bookmarks')
  const prepared = await invokeTool(def, {
    mode: 'prepare',
    operation: 'update',
    payload: { id: 7, note: 'keep' },
  }, runtime)
  assert.equal(prepared.status, 'warning')
  const confirmToken = prepared.data.confirmation.confirmation_token

  const okExec = await invokeTool(def, {
    mode: 'execute',
    confirm: true,
    confirmation_token: confirmToken,
    operation: 'update',
    payload: { id: 7, note: 'keep' },
  }, runtime)
  assert.equal(okExec.status, 'success')
  assert.equal(executed.length, 1)

  // Replay rejected
  const replay = await invokeTool(def, {
    mode: 'execute',
    confirm: true,
    confirmation_token: confirmToken,
    operation: 'update',
    payload: { id: 7, note: 'keep' },
  }, runtime)
  assert.equal(replay.status, 'error')
  assert.equal(replay.error.code, 'invalid_confirmation')
  assert.equal(executed.length, 1)

  // Recent audit tolerates malformed line and returns valid entries
  const recent = await invokeTool(getToolDefinition('inut_crm_audit_recent'), {}, runtime)
  assert.equal(recent.status, 'success')
  assert.ok(recent.data.items.length >= 3)

  // Streamable HTTP + SSE both healthy and list full catalog
  const server = createHttpServer(runtime)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const auth = { authorization: `Bearer ${biz11ClientAuth}` }

  const httpClient = new Client({ name: 'biz11-http', version: '1.0.0' })
  const sseClient = new Client({ name: 'biz11-sse', version: '1.0.0' })
  try {
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: auth },
    }))
    const listed = await httpClient.listTools()
    assert.equal(listed.tools.length, toolDefinitions.length)
    assert.ok(listed.tools.length >= 50)
    const h1 = await httpClient.callTool({ name: 'inut_crm_health', arguments: {} })
    assert.equal(h1.structuredContent.status, 'success')

    await sseClient.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`), {
      eventSourceInit: { fetch: (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, ...auth } }) },
      requestInit: { headers: auth },
    }))
    const h2 = await sseClient.callTool({ name: 'inut_crm_health', arguments: {} })
    assert.equal(h2.structuredContent.status, 'success')
  } finally {
    await httpClient.close().catch(() => {})
    await sseClient.close().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tmpAudit, { force: true })
  }
})
