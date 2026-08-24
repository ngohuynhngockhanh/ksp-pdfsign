import { Blob } from 'node:buffer'

const READ_ROUTES = {
  crm_customers_search: ({ query = {}, args }) => ['/api/customers', { ...query, search: args.query || undefined, page: args.page, per_page: args.page_size }],
  crm_customer_get: ({ args }) => [`/api/customers/${id(args)}`],
  crm_users: () => ['/api/users'],
  crm_orders: () => ['/api/orders'],
  crm_documents_search: ({ args }) => ['/api/documents', { page: args.page, per_page: args.page_size, search: args.query, ...(args.filters || {}) }],
  crm_document_get: ({ args }) => [`/api/documents/${id(args)}`],
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
  inventory_items: ({ args }) => ['/api/inv/items', { search: args.query, ...(args.filters || {}) }],
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
  pymid: ({ args }) => [`/api/pymid/${args.filters?.resource || 'catalog'}`, args.filters || {}],
  training: ({ args }) => [`/api/training/${args.filters?.resource || 'search'}`, args.filters || {}],
  ai: () => ['/api/ai/status'],
  standards: ({ args }) => [`/api/standards/${args.filters?.resource || 'statistics'}`, args.filters || {}],
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
  crm_document_share: { create: ['POST', '/api/documents/{id}/share'] },
  crm_orders: { create: ['POST', '/api/orders'], delete: ['DELETE', '/api/orders/{id}'], assign: ['POST', '/api/documents/{id}/order'] },
  commercial_generate: { quote: ['POST', '/api/quote/generate'], contract: ['POST', '/api/contract/generate'], bbbg: ['POST', '/api/bbbg/generate'], certificate: ['POST', '/api/factory-certificate/generate'] },
  commercial_settings: { update: ['POST', '/api/settings'] },
  commercial_logo: { update: ['POST', '/api/logo'], delete: ['DELETE', '/api/logo'] },
  bidding_bookmarks: { create: ['POST', '/api/bidding/bookmarks'], update: ['PUT', '/api/bidding/bookmarks/{id}'], delete: ['DELETE', '/api/bidding/bookmarks/{id}'] },
  bidding_watchlists: { create: ['POST', '/api/bidding/watchlist'], update: ['PUT', '/api/bidding/watchlist/{id}'], delete: ['DELETE', '/api/bidding/watchlist/{id}'] },
  bidding_watch_scan: { scan: ['POST', '/api/bidding/watchlist/{id}/scan'], scan_all: ['POST', '/api/bidding/scan-all'] },
  inventory_items: { create: ['POST', '/api/inv/items'], update: ['PATCH', '/api/inv/items/{id}'], merge: ['POST', '/api/inv/items/merge'] },
  inventory_purchases: { create: ['POST', '/api/inv/purchase'], update: ['PATCH', '/api/inv/purchase/{id}'], post: ['POST', '/api/inv/purchase/{id}/post'], void: ['POST', '/api/inv/purchase/{id}/void'], delete: ['DELETE', '/api/inv/purchase/{id}'], recalc: ['POST', '/api/inv/purchase/{id}/recalc-totals'] },
  inventory_sales: { update: ['PATCH', '/api/inv/sale/{id}'], generate: ['POST', '/api/inv/sale/{id}/generate'], delete: ['DELETE', '/api/inv/sale/{id}'] },
  inventory_issues: { create: ['POST', '/api/inv/issues'], update: ['PATCH', '/api/inv/issues/{id}'], post: ['POST', '/api/inv/issues/{id}/post'], void: ['POST', '/api/inv/issues/{id}/void'], delete: ['DELETE', '/api/inv/issues/{id}'] },
  inventory_production: { create: ['POST', '/api/inv/productions'], update: ['PATCH', '/api/inv/productions/{id}'], post: ['POST', '/api/inv/productions/{id}/post'], void: ['POST', '/api/inv/productions/{id}/void'], delete: ['DELETE', '/api/inv/productions/{id}'] },
  inventory_recipes: { create: ['POST', '/api/inv/recipes'], update: ['PATCH', '/api/inv/recipes/{id}'], delete: ['DELETE', '/api/inv/recipes/{id}'], describe: ['POST', '/api/inv/recipes/{id}/describe'] },
  inventory_customs: { create: ['POST', '/api/inv/customs'], update: ['PATCH', '/api/inv/customs/{id}'], post: ['POST', '/api/inv/customs/{id}/post'], void: ['POST', '/api/inv/customs/{id}/void'], delete: ['DELETE', '/api/inv/customs/{id}'] },
  tax_sync: { sync: ['POST', '/api/tax/sync'], auto_sync: ['POST', '/api/tax/auto-sync'], job: ['POST', '/api/jobs/tax-sync/run'] },
  tax_review: { upload: ['POST', '/api/tax/review/upload'], delete: ['DELETE', '/api/tax/review/{id}'] },
  tax_reports: { generate: ['POST', '/api/tax/reports/{id}/generate'], lock: ['POST', '/api/tax/reports/{id}/lock'] },
  ihoadon: { sync: ['POST', '/api/ihoadon/customer-sync'], draft_sync: ['POST', '/api/inv/ihoadon/drafts/{id}/sync-to-crm'], deliver: ['POST', '/api/inv/ihoadon/drafts/deliver'] },
  payroll: { create_employee: ['POST', '/api/payroll/employees'], create_period: ['POST', '/api/payroll/periods'], review: ['POST', '/api/payroll/periods/{id}/review'], lock: ['POST', '/api/payroll/periods/{id}/lock'], payment: ['POST', '/api/payroll/payments'], sync_drive: ['POST', '/api/payroll/sync-drive'] },
  email_sync: { update_settings: ['POST', '/api/inv/email-sync/settings'], test: ['POST', '/api/inv/email-sync/test'], run: ['POST', '/api/inv/email-sync/run'] },
  telegram: { connect: ['POST', '/api/telegram/connect'], disconnect: ['DELETE', '/api/telegram/connection'] },
  customs_drive: { sync: ['POST', '/api/inv/customs-drive/sync/{id}'], assign: ['POST', '/api/inv/customs-drive/folders/{id}/assign'], review: ['POST', '/api/inv/customs-drive/folders/{id}/review'] },
  nas: { test: ['POST', '/api/nas/test'], sync_all: ['POST', '/api/nas/sync-all'] },
  spx: { settings: ['POST', '/api/spx/settings'], test: ['POST', '/api/spx/test-connection'], sync: ['POST', '/api/spx/sync-orders'], print: ['POST', '/api/spx/orders/{id}/print-remote'], cancel: ['POST', '/api/spx/orders/{id}/cancel'] },
  pymid: { create_staff: ['POST', '/api/pymid/staff'], create_order: ['POST', '/api/pymid/orders'], submit: ['POST', '/api/pymid/orders/{id}/submit'], approve: ['POST', '/api/pymid/orders/{id}/approve'] },
  training: { ask: ['POST', '/api/training/ask'], knowledge_create: ['POST', '/api/training/knowledge'], knowledge_update: ['PATCH', '/api/training/knowledge/{id}'], knowledge_delete: ['DELETE', '/api/training/knowledge/{id}'] },
  ai: { test: ['POST', '/api/ai/test'], narrative: ['POST', '/api/ai/quote-narrative'] },
  standards: { generate_pdf: ['POST', '/api/standards/generate-cr-declaration/pdf'], generate_docx: ['POST', '/api/standards/generate-cr-declaration/docx'], game_complete: ['POST', '/api/standards/game/complete'], game_note: ['POST', '/api/standards/game/note'], game_reset: ['POST', '/api/standards/game/reset'] },
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
  const route = routes?.[args.operation]
  if (!route) throw new Error(`unsupported_operation:${toolName}:${args.operation}`)
  let path = route[1]
  const payload = { ...(args.payload || {}) }
  const targetId = payload.id ?? args.id
  if (path.includes('{id}')) path = path.replace('{id}', segment(targetId))
  delete payload.id
  return { method: route[0], path, body: route[0] === 'DELETE' ? undefined : payload }
}

export class BackendClient {
  constructor({ baseUrl, username, password, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || 'http://127.0.0.1:2032').replace(/\/$/, '')
    this.username = username || ''
    this.password = password || ''
    this.fetchImpl = fetchImpl
    this.cookie = ''
  }

  async login() {
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
    const url = new URL(path, `${this.baseUrl}/`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const headers = { accept: raw ? '*/*' : 'application/json' }
    if (this.cookie) headers.cookie = this.cookie
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
    const resolver = READ_ROUTES[toolName]
    if (resolver) {
      const resolved = resolver({ args })
      const [path, query = {}] = resolved
      return this.request(path, { query })
    }
    const mutation = buildMutationRequest(toolName, args)
    return this.request(mutation.path, { method: mutation.method, body: mutation.body })
  }
}
