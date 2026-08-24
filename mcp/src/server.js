import fs from 'node:fs'
import http from 'node:http'
import process from 'node:process'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

import { createTokenAuthenticator, isLoopbackAddress, redactSecrets, readTokenFile } from './auth.js'
import { BackendClient } from './backend-client.js'
import { ConfirmationStore } from './confirmations.js'
import { getToolDefinition, routeCoverage, toolDefinitions } from './catalog.js'
import { errorEnvelope, successEnvelope, warningEnvelope, withMeta } from './response.js'

const MAX_BODY_BYTES = 1_000_000
const SSE_ENDPOINT = '/messages'

function jsonResult(value) {
  const text = JSON.stringify(value, null, 2)
  return {
    content: [{ type: 'text', text }],
    structuredContent: value,
    isError: value.status === 'error',
  }
}

function requestId(req) {
  const candidate = String(req.headers['x-request-id'] || '').trim()
  return /^[A-Za-z0-9._-]{1,80}$/.test(candidate) ? candidate : cryptoRandomId()
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function safeError(error) {
  const status = Number(error?.status || 0)
  const retryable = status === 408 || status === 429 || status >= 500
  return errorEnvelope('backend_request_failed', 'Backend request failed', {
    retryable,
    rootCauseHint: status ? `backend returned HTTP ${status}` : 'gateway or backend dependency failed',
    safeRetry: retryable ? 'retry the same read operation once after a short delay' : 'fix the request or credentials before retrying',
    stopCondition: retryable ? 'stop after two retries or when the dependency remains unavailable' : 'stop until the input or credentials are corrected',
    data: { detail: String(error?.detail || error?.message || 'unknown error').slice(0, 500) },
  })
}

export function createRuntime(options = {}) {
  const token = options.token || (options.tokenFile ? readTokenFile(options.tokenFile) : process.env.INUT_CRM_MCP_TOKEN)
  const authenticator = options.authenticator || createTokenAuthenticator({ token })
  const backendClient = options.backendClient || new BackendClient({
    baseUrl: options.backendUrl || process.env.KSP_BACKEND_URL || 'http://127.0.0.1:2032',
    username: options.backendUsername || process.env.MCP_BACKEND_USERNAME || process.env.APP_ADMIN_USERNAME,
    password: options.backendPassword || process.env.MCP_BACKEND_PASSWORD || process.env.APP_ADMIN_PASSWORD,
  })
  const confirmationStore = options.confirmationStore || new ConfirmationStore()
  const auditPath = options.auditPath || process.env.INUT_CRM_MCP_AUDIT_PATH || './backend/data/mcp-audit.jsonl'

  function audit(event) {
    const record = {
      ts: new Date().toISOString(),
      ...redactSecrets(event),
    }
    try {
      fs.mkdirSync(new URL('.', `file://${auditPath}`).pathname, { recursive: true })
    } catch {
      // The parent directory is normally created by the backend service.
    }
    try {
      fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      try { fs.chmodSync(auditPath, 0o600) } catch { /* best effort */ }
    } catch (error) {
      console.error(JSON.stringify({ event: 'mcp_audit_write_failed', error: String(error.message || error) }))
    }
  }

  return { authenticator, backendClient, confirmationStore, audit, auditPath }
}

export async function invokeTool(definition, args, runtime, meta = {}) {
  const started = Date.now()
  const baseMeta = { request_id: meta.requestId || cryptoRandomId(), tool: definition.name, duration_ms: 0 }
  try {
    let result
    if (definition.execution === 'read') {
      if (definition.name === 'inut_crm_health') {
        const backend = await runtime.backendClient.request('/api/health')
        result = successEnvelope('MCP gateway and KSP backend are healthy', { backend, transport: 'http' })
      } else if (definition.name === 'inut_crm_capabilities') {
        result = successEnvelope('Capability catalog loaded', { tools: toolDefinitions.map(({ name, description, access, execution, category }) => ({ name, description, access, execution, category })), route_coverage: routeCoverage })
      } else if (definition.name === 'inut_crm_whoami') {
        result = successEnvelope('Authenticated local MCP owner', { actor: 'mcp-owner', backend_url: runtime.backendClient.baseUrl })
      } else if (definition.name === 'inut_crm_audit_recent') {
        const lines = fs.existsSync(runtime.auditPath) ? fs.readFileSync(runtime.auditPath, 'utf8').trim().split('\n').slice(-100) : []
        result = successEnvelope('Recent redacted MCP audit events loaded', { items: lines.filter(Boolean).map((line) => JSON.parse(line)) })
      } else {
        result = successEnvelope('Backend read completed', await runtime.backendClient.dispatch(definition.name, args))
      }
    } else {
      const payload = { operation: args.operation, ...(args.payload || {}) }
      if (args.mode === 'prepare') {
        const confirmation = runtime.confirmationStore.prepare(definition.name, payload, { highRisk: definition.access === 'high_risk' })
        result = warningEnvelope('Mutation prepared; no data or external side effect has occurred', {
          tool: definition.name,
          operation: args.operation,
          preview: redactSecrets(args.payload || {}),
          confirmation,
        }, ['Review the preview and call this tool again with mode=execute, confirm=true, and the confirmation_token'])
      } else {
        if (args.confirm !== true || !args.confirmation_token) {
          result = errorEnvelope('confirmation_required', 'Mutation requires an explicit confirmation token', {
            retryable: false,
            rootCauseHint: 'mode=execute was called without confirm=true and confirmation_token',
            safeRetry: 'call mode=prepare first, then execute the exact same payload',
            stopCondition: 'do not retry execute without a valid token',
          })
        } else if (!runtime.confirmationStore.consume(args.confirmation_token, definition.name, payload)) {
          result = errorEnvelope('invalid_confirmation', 'Confirmation token is invalid, expired, replayed, or bound to another payload', {
            retryable: false,
            rootCauseHint: 'confirmation hash or TTL validation failed',
            safeRetry: 'start a new prepare operation',
            stopCondition: 'stop using the rejected token',
          })
        } else {
          result = successEnvelope('Mutation executed', await runtime.backendClient.dispatch(definition.name, {
            ...args,
            payload: args.payload || {},
          }))
        }
      }
    }
    const envelope = withMeta(result, { ...baseMeta, duration_ms: Date.now() - started })
    runtime.audit({ request_id: baseMeta.request_id, actor: 'mcp-owner', tool: definition.name, outcome: envelope.status, args: args.mode === 'execute' ? { operation: args.operation } : redactSecrets(args) })
    return envelope
  } catch (error) {
    const envelope = withMeta(safeError(error), { ...baseMeta, duration_ms: Date.now() - started })
    runtime.audit({ request_id: baseMeta.request_id, actor: 'mcp-owner', tool: definition.name, outcome: 'error', error: error.message })
    return envelope
  }
}

export function createMcpServer(runtime, requestContext = {}) {
  const mcp = new McpServer({ name: 'inut-crm', version: process.env.INUT_CRM_MCP_VERSION || '1.0.0' }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'INUT CRM MCP: read before writing; every mutation uses prepare then execute with a one-time confirmation token. High-risk operations are audited and secrets are never returned.',
  })

  for (const definition of toolDefinitions) {
    mcp.registerTool(definition.name, {
      title: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
    }, async (args) => jsonResult(await invokeTool(definition, args, runtime, requestContext)))
  }

  mcp.registerResource('capabilities', 'inut://capabilities', { title: 'INUT CRM MCP capabilities', mimeType: 'application/json' }, async () => ({
    contents: [{ uri: 'inut://capabilities', mimeType: 'application/json', text: JSON.stringify({ tools: toolDefinitions.map(({ name, access, execution, category }) => ({ name, access, execution, category })), routeCoverage }, null, 2) }],
  }))
  mcp.registerResource('audit-recent', 'inut://audit/recent', { title: 'Recent redacted MCP audit', mimeType: 'application/json' }, async () => ({
    contents: [{ uri: 'inut://audit/recent', mimeType: 'application/json', text: JSON.stringify((await invokeTool(getToolDefinition('inut_crm_audit_recent'), {}, runtime)).data, null, 2) }],
  }))
  mcp.registerPrompt('crm-review', 'Review a CRM customer or tender using read-only tools first.', { subject: { description: 'Customer name, tax code, or TBMT', required: true } }, ({ subject }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Review ${subject} with INUT CRM read-only tools. Do not mutate records without prepare/execute confirmation.` } }],
  }))
  return mcp
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve(undefined)
      try { resolve(JSON.parse(data)) } catch { reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 })) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(encoded)
}

function authorize(req, runtime) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return { ok: false, status: 403, message: 'loopback_only' }
  const result = runtime.authenticator.authenticate(req.headers.authorization)
  return result.authenticated ? { ok: true, actor: result.actor } : { ok: false, status: 401, message: 'invalid_api_key' }
}

export function createHttpServer(runtime = createRuntime()) {
  const sseTransports = new Map()
  const server = http.createServer(async (req, res) => {
    const auth = authorize(req, runtime)
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.message })
    const id = requestId(req)

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, service: 'inut-crm', version: process.env.INUT_CRM_MCP_VERSION || '1.0.0', tools_count: toolDefinitions.length, backend_url: runtime.backendClient.baseUrl })
    }
    if (req.method === 'GET' && req.url === '/tools') {
      return sendJson(res, 200, { ok: true, count: toolDefinitions.length, tools: toolDefinitions.map(({ inputSchema, ...definition }) => definition) })
    }
    if (req.method === 'GET' && req.url === '/sse') {
      const mcp = createMcpServer(runtime, { requestId: id })
      const transport = new SSEServerTransport(SSE_ENDPOINT, res)
      sseTransports.set(transport.sessionId, { transport, mcp })
      req.on('close', () => { sseTransports.delete(transport.sessionId); transport.close().catch(() => {}); mcp.close().catch(() => {}) })
      return mcp.connect(transport)
    }
    if (req.method === 'POST' && req.url?.startsWith('/messages')) {
      const sessionId = new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId')
      const session = sseTransports.get(sessionId)
      if (!session) return sendJson(res, 404, { error: 'sse_session_not_found' })
      const body = await parseJsonBody(req)
      return session.transport.handlePostMessage(req, res, body)
    }
    if (req.url === '/mcp' && req.method === 'POST') {
      const body = await parseJsonBody(req)
      req.headers.accept = 'application/json, text/event-stream'
      const mcp = createMcpServer(runtime, { requestId: id })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      try {
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body)
      } catch (error) {
        if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'MCP request failed' }, id: body?.id ?? null })
      } finally {
        res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}) })
      }
      return
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' })
  })
  return server
}

export async function startServer(options = {}) {
  const runtime = options.runtime || createRuntime(options)
  const server = createHttpServer(runtime)
  const host = options.host || process.env.INUT_CRM_MCP_HOST || '127.0.0.1'
  const port = Number(options.port || process.env.INUT_CRM_MCP_PORT || 2037)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return { server, runtime, host, port }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(({ host, port }) => console.error(`inut-crm MCP listening on http://${host}:${port}`)).catch((error) => {
    console.error(`inut-crm MCP failed to start: ${error.message}`)
    process.exitCode = 1
  })
}
