import { Blob } from 'node:buffer'

const READ_ROUTES = {
  crm_customers_search: () => ['/api/customers'],
  crm_customer_get: ({ args }) => [`/api/customers/${id(args)}`],
  crm_users: () => ['/api/users'],
  crm_orders: () => ['/api/orders'],
  crm_documents_search: ({ args }) => ['/api/documents', { page: args.page, per_page: args.page_size, search: args.query, ...(args.filters || {}) }],
  crm_document_get: ({ args }) => [`/api/documents/${id(args)}`],
  crm_document_verify: ({ args }) => [`/api/documents/${id(args)}/verify`],
  crm_document_download: ({ args }) => [`/api/documents/${id(args)}/download`],
  commercial_templates: () => ['/api/quote/templates'],
  commercial_products: () => ['/api/products'],
  commercial_settings: () => ['/api/settings'],
  commercial_logo: () => ['/api/logo'],
  bidding_search: ({ args }) => ['/api/bidding/search', { ...(args.filters || {}), keyword: args.query, page: args.page, page_size: args.page_size }],
  bidding_tender_get: ({ args }) => [`/api/bidding/tenders/${segment(args.id || args.query)}`],
  bidding_tender_analyze: ({ args }) => [`/api/bidding/tenders/${segment(args.id || args.query)}/analyze-ai`],
  bidding_bookmarks: ({ args }) => ['/api/bidding/bookmarks', { status: args.filters?.status, field: args.filters?.field, search: args.query, limit: args.page_size, offset: args.filters?.offset }],
  bidding_watchlists: ({ args }) => ['/api/bidding/watchlist', { is_active: args.filters?.is_active }],
  bidding_contractors: ({ args }) => contractorRoute(args),
  bidding_won_packages: ({ args }) => ['/api/bidding/won-packages', { query: args.query, field: args.filters?.field }],
  bidding_attachments: ({ args }) => [`/api/bidding/tenders/${segment(args.id || args.query)}/attachments`],
  bidding_competitors: ({ args }) => [`/api/bidding/tenders/${segment(args.id || args.query)}/competitors`],
  inventory_warehouses: () => ['/api/inv/warehouses'],
  inventory_items: ({ args }) => ['/api/inv/items', { q: args.query, ...(args.filters || {}) }],
  inventory_stock: ({ args }) => [`/api/inv/${args.filters?.report || 'stock'}`, args.filters || {}],
  inventory_purchases: ({ args }) => ['/api/inv/purchase', args.filters || {}],
  inventory_sales: ({ args }) => ['/api/inv/sale', args.filters || {}],
  inventory_issues: ({ args }) => ['/api/inv/issues', args.filters || {}],
  inventory_production: ({ args }) => ['/api/inv/productions', args.filters || {}],
  inventory_recipes: () => ['/api/inv/recipes'],
  inventory_customs: ({ args }) => ['/api/inv/customs', args.filters || {}],
  tax_status: () => ['/api/tax/session'],
  tax_review: ({ args }) => ['/api/tax/review', args.filters || {}],
  tax_reports: ({ args }) => ['/api/tax/reports', args.filters || {}],
  ihoadon: ({ args }) => [args.filters?.resource === 'drafts' ? '/api/inv/ihoadon/drafts' : '/api/inv/ihoadon/dashboard', args.filters || {}],
  payroll: ({ args }) => [`/api/payroll/${args.filters?.resource || 'employees'}`, args.filters || {}],
  email_sync: () => ['/api/inv/email-sync/runs'],
  telegram: () => ['/api/telegram/status'],
  facebook_conversations: ({ args }) => ['/api/facebook/conversations', args.filters || {}],
  customs_drive: ({ args }) => [`/api/inv/customs-drive/${args.filters?.resource || 'sources'}`, args.filters || {}],
  nas: ({ args }) => [`/api/nas/${args.filters?.resource || 'status'}`, args.filters || {}],
  spx: ({ args }) => [`/api/spx/${args.filters?.resource || 'stats'}`, args.filters || {}],
  spx_print_by_label: ({ args }) => ['/api/spx/stats', args.filters || {}],
  pymid: ({ args }) => [`/api/pymid/${args.filters?.resource || 'catalog'}`, args.filters || {}],
  training: ({ args }) => [`/api/training/${args.filters?.resource || 'search'}`, { q: args.query, ...(args.filters || {}) }],
  ai: () => ['/api/ai/status'],
  standards: ({ args }) => [`/api/standards/${args.filters?.resource || 'statistics'}`, args.filters || {}],
  standards_tqc_status: () => ['/api/standards/tqc/status'],
  standards_tqc_search: ({ args }) => ['/api/standards/tqc/search', {
    q: args.query,
    ...(args.filters || {}),
    page: args.page,
    page_size: args.page_size,
  }],
  standards_tqc_get: ({ args }) => [`/api/standards/tqc/certificates/${segment(args.id || args.query)}`, {
    refresh: args.filters?.refresh,
  }],
  standards_tqc_import_job: ({ args }) => [
    args.filters?.latest ? '/api/standards/tqc/import/jobs/latest' : `/api/standards/tqc/import/jobs/${segment(args.id || args.query)}`,
  ],
  operations_dashboard: () => ['/api/operations/dashboard'],
  inut_crm_job_status: ({ args }) => [`/api/training/jobs/${segment(args.id || args.query)}`],
}

const MUTATION_ROUTES = {
  crm_customer_write: {
    create: ['POST', '/api/customers'], update: ['PATCH', '/api/customers/{id}'], merge: ['POST', '/api/customers/merge'], delete: ['DELETE', '/api/customers/{id}'],
  },
  crm_customer_account: {
    create: ['POST', '/api/customers/{id}/account'], auto: ['POST', '/api/customers/{id}/account-auto'], login_link: ['POST', '/api/customers/{id}/login-link'], reset: ['POST', '/api/users/{id}/password'],
  },
  crm_document_write: {
    assign: ['POST', '/api/documents/{id}/assign'], rename: ['POST', '/api/documents/{id}/rename'], type: ['POST', '/api/documents/{id}/type'], order: ['POST', '/api/documents/{id}/order'], delete: ['DELETE', '/api/documents/{id}'],
  },
  crm_document_sign: { sign: ['POST', '/api/sign'] },
  crm_document_share: { create: ['POST', '/api/documents/{id}/share'] },
  crm_orders: { create: ['POST', '/api/orders'], delete: ['DELETE', '/api/orders/{id}'], assign: ['POST', '/api/documents/{id}/order'] },
  crm_users: { training_access: ['PATCH', '/api/users/{id}/training-access'], password: ['POST', '/api/users/{id}/password'] },
  commercial_generate: { quote: ['POST', '/api/quote/generate'], contract: ['POST', '/api/contract/generate'], bbbg: ['POST', '/api/bbbg/generate'], certificate: ['POST', '/api/factory-certificate/generate'] },
  commercial_settings: { update: ['POST', '/api/settings'] },
  commercial_logo: { update: ['POST', '/api/logo'], delete: ['DELETE', '/api/logo'] },
  bidding_bookmarks: { create: ['POST', '/api/bidding/bookmarks'], update: ['PUT', '/api/bidding/bookmarks/{id}'], delete: ['DELETE', '/api/bidding/bookmarks/{id}'] },
  bidding_watchlists: { create: ['POST', '/api/bidding/watchlist'], update: ['PUT', '/api/bidding/watchlist/{id}'], delete: ['DELETE', '/api/bidding/watchlist/{id}'] },
  bidding_watch_scan: { scan: ['POST', '/api/bidding/watchlist/{id}/scan'], scan_all: ['POST', '/api/bidding/scan-all'] },
  inventory_items: { create: ['POST', '/api/inv/items'], update: ['PATCH', '/api/inv/items/{id}'], merge: ['POST', '/api/inv/items/merge'] },
  inventory_purchases: { create: ['POST', '/api/inv/purchase'], update: ['PATCH', '/api/inv/purchase/{id}'], post: ['POST', '/api/inv/purchase/{id}/post'], void: ['POST', '/api/inv/purchase/{id}/void'], delete: ['DELETE', '/api/inv/purchase/{id}'], recalc: ['POST', '/api/inv/purchase/{id}/recalc-totals'] },
  inventory_sales: { create: ['POST', '/api/inv/sale'], update: ['PATCH', '/api/inv/sale/{id}'], generate: ['POST', '/api/inv/sale/{id}/generate'], delete: ['DELETE', '/api/inv/sale/{id}'] },
  inventory_issues: { create: ['POST', '/api/inv/issues'], update: ['PATCH', '/api/inv/issues/{id}'], post: ['POST', '/api/inv/issues/{id}/post'], void: ['POST', '/api/inv/issues/{id}/void'], delete: ['DELETE', '/api/inv/issues/{id}'] },
  inventory_production: { create: ['POST', '/api/inv/productions'], update: ['PATCH', '/api/inv/productions/{id}'], post: ['POST', '/api/inv/productions/{id}/post'], void: ['POST', '/api/inv/productions/{id}/void'], delete: ['DELETE', '/api/inv/productions/{id}'] },
  inventory_recipes: { create: ['POST', '/api/inv/recipes'], update: ['PATCH', '/api/inv/recipes/{id}'], delete: ['DELETE', '/api/inv/recipes/{id}'], describe: ['POST', '/api/inv/recipes/{id}/describe'] },
  inventory_customs: { create: ['POST', '/api/inv/customs'], update: ['PATCH', '/api/inv/customs/{id}'], post: ['POST', '/api/inv/customs/{id}/post'], void: ['POST', '/api/inv/customs/{id}/void'], delete: ['DELETE', '/api/inv/customs/{id}'] },
  inventory_import_export: { opening_import: ['POST', '/api/inv/opening/import'], purchase_import_url: ['POST', '/api/inv/purchase/import-url'], purchase_sync_nas: ['POST', '/api/inv/purchase/sync-nas'], sale_import_url: ['POST', '/api/inv/sale/import-url'] },
  tax_sync: { sync: ['POST', '/api/tax/sync'], auto_sync: ['POST', '/api/tax/auto-sync'], job: ['POST', '/api/jobs/tax-sync/run'] },
  tax_review: { upload: ['POST', '/api/tax/review/upload'], delete: ['DELETE', '/api/tax/review/{id}'] },
  tax_reports: { generate: ['POST', '/api/tax/reports/{id}/generate'], lock: ['POST', '/api/tax/reports/{id}/lock'] },
  ihoadon: { sync: ['POST', '/api/ihoadon/customer-sync'], draft_sync: ['POST', '/api/inv/ihoadon/drafts/{id}/sync-to-crm'], deliver: ['POST', '/api/inv/ihoadon/drafts/deliver'] },
  payroll: { create_employee: ['POST', '/api/payroll/employees'], create_period: ['POST', '/api/payroll/periods'], review: ['POST', '/api/payroll/periods/{id}/review'], lock: ['POST', '/api/payroll/periods/{id}/lock'], payment: ['POST', '/api/payroll/payments'], sync_drive: ['POST', '/api/payroll/sync-drive'] },
  email_sync: { update_settings: ['POST', '/api/inv/email-sync/settings'], test: ['POST', '/api/inv/email-sync/test'], run: ['POST', '/api/inv/email-sync/run'] },
  telegram: { connect: ['POST', '/api/telegram/connect'], disconnect: ['DELETE', '/api/telegram/connection'], send: ['POST', '/api/telegram/send'], notify: ['POST', '/api/telegram/send'] },
  customs_drive: { sync: ['POST', '/api/inv/customs-drive/sync/{id}'], assign: ['POST', '/api/inv/customs-drive/folders/{id}/assign'], review: ['POST', '/api/inv/customs-drive/folders/{id}/review'] },
  nas: { test: ['POST', '/api/nas/test'], sync_all: ['POST', '/api/nas/sync-all'] },
  spx: { settings: ['POST', '/api/spx/settings'], test: ['POST', '/api/spx/test-connection'], sync: ['POST', '/api/spx/sync-orders'], quick_print: ['POST', '/api/spx/quick-print'], print_by_label: ['POST', '/api/spx/quick-print'], print: ['POST', '/api/spx/orders/{id}/print-remote'], cancel: ['POST', '/api/spx/orders/{id}/cancel'] },
  spx_print_by_label: { print: ['POST', '/api/spx/quick-print'], quick_print: ['POST', '/api/spx/quick-print'], print_by_label: ['POST', '/api/spx/quick-print'], execute: ['POST', '/api/spx/quick-print'] },
  pymid: { create_staff: ['POST', '/api/pymid/staff'], create_order: ['POST', '/api/pymid/orders'], submit: ['POST', '/api/pymid/orders/{id}/submit'], approve: ['POST', '/api/pymid/orders/{id}/approve'] },
  training: { ask: ['POST', '/api/training/ask'], knowledge_create: ['POST', '/api/training/knowledge'], knowledge_update: ['PATCH', '/api/training/knowledge/{id}'], knowledge_delete: ['DELETE', '/api/training/knowledge/{id}'] },
  ai: { test: ['POST', '/api/ai/test'], narrative: ['POST', '/api/ai/quote-narrative'] },
  standards: { generate_pdf: ['POST', '/api/standards/generate-cr-declaration/pdf'], generate_docx: ['POST', '/api/standards/generate-cr-declaration/docx'], game_complete: ['POST', '/api/standards/game/complete'], game_note: ['POST', '/api/standards/game/note'], game_reset: ['POST', '/api/standards/game/reset'] },
  standards_tqc_import: { import: ['POST', '/api/standards/tqc/import'] },
  standards_tqc_import_retry: { retry: ['POST', '/api/standards/tqc/import/jobs/{id}/retry'] },
}

function id(args) {
  const value = args.id ?? args.payload?.id
  if (value === undefined || value === null || value === '') throw new Error('id is required for this operation')
  return segment(value)
}

function segment(value) {
  const text = String(value || '').trim()
  if (!text || text.includes('/') || text.includes('\\')) throw new Error('invalid path identifier')
  return encodeURIComponent(text)
}

function contractorRoute(args) {
  if (args.filters?.resource === 'profile' || args.id) return [`/api/bidding/contractors/${segment(args.id || args.query)}`]
  return ['/api/bidding/contractors/search', { query: args.query || '' }]
}

function buildMutationRequest(toolName, args) {
  const routes = MUTATION_ROUTES[toolName]
  if (!routes) throw new Error(`unsupported_mutation_tool:${toolName}`)
  const operation = String(args.operation || '').trim()
  const mapping = routes[operation]
  if (!mapping) throw new Error(`unsupported_operation:${toolName}:${operation}`)
  const [method, template] = mapping
  const path = template.replace(/{id}/g, () => id(args))
  return { method, path, body: method === 'DELETE' ? undefined : normalizePayload(toolName, args.payload || {}) }
}

function normalizePayload(toolName, source) {
  const payload = { ...source }
  if (toolName !== 'tax_sync') return payload

  // The MCP API uses readable date names while KSP's tax endpoints retain
  // their legacy Vietnamese request keys.
  const aliases = [
    ['tu', ['from_date', 'from', 'start_date']],
    ['den', ['to_date', 'to', 'end_date']],
  ]
  for (const [backendKey, keys] of aliases) {
    if (payload[backendKey] === undefined) {
      const alias = keys.find((key) => payload[key] !== undefined)
      if (alias) payload[backendKey] = payload[alias]
    }
    for (const key of keys) delete payload[key]
  }
  return payload
}

export class BackendClient {
  constructor({ baseUrl, username, password, bearerToken, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || 'http://127.0.0.1:2032').replace(/\/$/, '')
    this.username = username || ''
    this.password = password || ''
    this.bearerToken = bearerToken || ''
    this.fetchImpl = fetchImpl
    this.cookie = ''
  }

  async login() {
    if (this.bearerToken) return { ok: true, auth: 'mcp-bearer' }
    if (!this.username || !this.password) throw new Error('backend credentials are not configured')
    const response = await this.fetchImpl(`${this.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    })
    if (!response.ok) throw new Error(`backend_login_failed:${response.status}`)
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    this.cookie = cookies.map((value) => value.split(';', 1)[0]).join('; ')
    return response.json()
  }

  async request(path, { method = 'GET', query = {}, body, raw = false, retry = true } = {}) {
    if (!this.cookie) await this.login()
    const url = new URL(path, `${this.baseUrl}/`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const headers = { accept: raw ? '*/*' : 'application/json' }
    if (this.cookie) headers.cookie = this.cookie
    if (this.bearerToken) headers.authorization = `Bearer ${this.bearerToken}`
    let requestBody = body
    if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers['content-type'] = 'application/json'
      requestBody = JSON.stringify(body)
    }
    const response = await this.fetchImpl(url, { method, headers, body: requestBody })
    if (response.status === 401 && retry) {
      await this.login()
      return this.request(path, { method, query, body, raw, retry: false })
    }
    if (!response.ok) {
      const detail = await response.text()
      const error = new Error(`backend_request_failed:${response.status}`)
      error.status = response.status
      error.detail = detail.slice(0, 1000)
      throw error
    }
    if (raw) return { body: await response.arrayBuffer(), contentType: response.headers.get('content-type') || 'application/octet-stream' }
    const text = await response.text()
    return text ? JSON.parse(text) : { ok: true }
  }

  async dispatch(toolName, args) {
    const special = this.#specialRequest(toolName, args)
    if (special) return this.request(special.path, { method: special.method, query: special.query, body: special.body })
    const resolver = READ_ROUTES[toolName]
    if (resolver && !args?.operation) {
      const resolved = resolver({ args })
      const [path, query = {}] = resolved
      const result = await this.request(path, { query })
      if (toolName === 'crm_customers_search' && args?.query && Array.isArray(result)) {
        const needle = String(args.query).trim().toLocaleLowerCase()
        return result.filter((customer) => [customer.name, customer.tax_code, customer.contact, customer.email]
          .filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(needle)))
      }
      return result
    }
    const mutation = buildMutationRequest(toolName, args)
    return this.request(mutation.path, { method: mutation.method, body: mutation.body })
  }

  #specialRequest(toolName, args) {
    const filters = args?.filters || {}
    if (toolName === 'bidding_tender_analyze') {
      return { method: 'POST', path: `/api/bidding/tenders/${segment(args.id || args.query)}/analyze-ai`, body: { custom_context: filters.custom_context || '' } }
    }
    if (toolName === 'commercial_preview') {
      const resource = filters.resource || 'quote'
      const paths = { quote: '/api/quote/preview', contract: '/api/contract/preview', bbbg: '/api/bbbg/preview', certificate: '/api/factory-certificate/preview' }
      if (!paths[resource]) throw new Error(`unsupported_preview:${resource}`)
      return { method: 'POST', path: paths[resource], body: filters.payload || {} }
    }
    if (toolName === 'commercial_invoice_parse') {
      return { method: 'POST', path: '/api/invoice/parse', body: filters.payload || {} }
    }
    if (toolName === 'tax_sync' && args?.operation === 'auto_sync') {
      const payload = args.payload || {}
      const query = {}
      const fromDate = payload.from_date ?? payload.from ?? payload.start_date ?? payload.tu
      const toDate = payload.to_date ?? payload.to ?? payload.end_date ?? payload.den
      if (fromDate !== undefined) query.from_date = fromDate
      if (toDate !== undefined) query.to_date = toDate
      if (payload.days_back !== undefined) query.days_back = payload.days_back
      if (payload.do_import !== undefined) query.do_import = payload.do_import
      if (payload.send_telegram !== undefined) query.send_telegram = payload.send_telegram
      return { method: 'POST', path: '/api/tax/auto-sync', query }
    }
    if (toolName === 'tax_status' && filters.resource) {
      const resources = { credentials: '/api/tax/credentials', session: '/api/tax/session', policy: '/api/tax/policy', auto_sync: '/api/tax/auto-sync/status' }
      if (!resources[filters.resource]) throw new Error(`unsupported_tax_status:${filters.resource}`)
      return { method: 'GET', path: resources[filters.resource] }
    }
    return null
  }
}
