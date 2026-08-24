import fs from 'node:fs'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const tokenFile = process.env.INUT_CRM_MCP_TOKEN_FILE || `${process.env.HOME}/.config/inut-crm/inut-crm.token`
const token = fs.readFileSync(tokenFile, 'utf8').trim()

async function run(label, transport) {
  const client = new Client({ name: `inut-crm-smoke-${label}`, version: '1.0.0' })
  await client.connect(transport)
  const tools = await client.listTools()
  if (tools.tools.length < 50) throw new Error(`${label}: unexpected tool count ${tools.tools.length}`)
  const result = await client.callTool({ name: 'inut_crm_health', arguments: {} })
  if (result.structuredContent?.status !== 'success') throw new Error(`${label}: health tool failed`)
  await client.close()
  console.log(`${label}: healthy; tools=${tools.tools.length}`)
}

await run('streamable-http', new StreamableHTTPClientTransport(new URL('http://127.0.0.1:2037/mcp'), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
}))

await run('sse', new SSEClientTransport(new URL('http://127.0.0.1:2037/sse'), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
}))
