import test from 'node:test'
import assert from 'node:assert/strict'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { createHttpServer, createRuntime } from '../src/server.js'

test('HTTP health endpoint requires loopback bearer auth', async () => {
  const runtime = createRuntime({ token: ['unit', 'fixture', 'value'].join('-'), backendClient: { baseUrl: 'http://backend' } })
  const server = createHttpServer(runtime)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    const invalid = await fetch(`http://127.0.0.1:${address.port}/health`)
    assert.equal(invalid.status, 401)
    const valid = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { authorization: 'Bearer unit-fixture-value' } })
    assert.equal(valid.status, 200)
    assert.equal((await valid.json()).service, 'inut-crm')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Streamable HTTP MCP handshake discovers and calls a typed read tool', async () => {
  const runtime = createRuntime({
    token: ['unit', 'fixture', 'value'].join('-'),
    backendClient: {
      baseUrl: 'http://backend',
      request: async () => ({ ok: true, status: 'healthy' }),
      dispatch: async () => ({ items: [] }),
    },
    auditPath: '/tmp/inut-crm-mcp-test-audit.jsonl',
  })
  const server = createHttpServer(runtime)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const client = new Client({ name: 'unit-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: 'Bearer unit-fixture-value' } },
  })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    assert.ok(tools.tools.some((tool) => tool.name === 'bidding_search'))
    const result = await client.callTool({ name: 'inut_crm_health', arguments: {} })
    assert.equal(result.structuredContent.status, 'success')
  } finally {
    await client.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
