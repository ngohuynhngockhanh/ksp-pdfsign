import { z } from 'zod'

const readInput = z.object({
  query: z.string().max(300).optional(),
  id: z.union([z.string().max(120), z.number().int().nonnegative()]).optional(),
  page: z.number().int().min(1).max(10000).optional(),
  page_size: z.number().int().min(1).max(100).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
}).strict()

const mutationInput = z.object({
  mode: z.enum(['prepare', 'execute']),
  confirm: z.boolean().default(false),
  confirmation_token: z.string().max(128).optional(),
  operation: z.string().max(80),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict()

const tqcStatusInput = z.object({}).strict()
const tqcSearchInput = z.object({
  query: z.string().max(300).optional(),
  page: z.number().int().min(1).max(10000).optional(),
  page_size: z.number().int().min(1).max(100).optional(),
  filters: z.object({
    model: z.string().max(255).optional(),
    manufacturer: z.string().max(500).optional(),
    applicant: z.string().max(500).optional(),
    certificate_no: z.string().max(120).optional(),
    status: z.enum(['active', 'expired', 'cancelled', 'unknown']).optional(),
    valid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict().optional(),
}).strict().refine((value) => Boolean(
  value.query || value.filters && Object.values(value.filters).some(Boolean),
), { message: 'query or at least one TQC filter is required' })
const tqcGetInput = z.object({
  id: z.string().min(6).max(120).regex(/^[A-Za-z0-9]+$/),
  filters: z.object({ refresh: z.boolean().optional() }).strict().optional(),
}).strict()
const tqcImportJobInput = z.object({
  id: z.union([z.string().regex(/^[0-9]+$/), z.number().int().positive()]).optional(),
  query: z.string().regex(/^[0-9]+$/).optional(),
  filters: z.object({ latest: z.boolean().optional() }).strict().optional(),
}).strict().refine((value) => Boolean(value.filters?.latest || value.id || value.query), {
  message: 'id/query or filters.latest is required',
})
const tqcImportRetryInput = z.object({
  mode: z.enum(['prepare', 'execute']),
  confirm: z.boolean().default(false),
  confirmation_token: z.string().max(128).optional(),
  operation: z.literal('retry'),
  payload: z.object({ id: z.union([z.string().regex(/^[0-9]+$/), z.number().int().positive()]) }).strict(),
}).strict()
const tqcImportInput = z.object({
  mode: z.enum(['prepare', 'execute']),
  confirm: z.boolean().default(false),
  confirmation_token: z.string().max(128).optional(),
  operation: z.literal('import'),
  payload: z.object({
    entries: z.array(z.object({
      certificate_no: z.string().max(120).optional(),
      qr_input: z.string().max(2000).optional(),
    }).strict().refine((value) => Boolean(value.certificate_no || value.qr_input), { message: 'certificate_no or qr_input is required' })).min(1).max(100),
    refresh_existing: z.boolean().optional(),
  }).strict(),
}).strict()

const schemaOverrides = {
  standards_tqc_status: tqcStatusInput,
  standards_tqc_search: tqcSearchInput,
  standards_tqc_get: tqcGetInput,
  standards_tqc_import: tqcImportInput,
  standards_tqc_import_job: tqcImportJobInput,
  standards_tqc_import_retry: tqcImportRetryInput,
}

const definitions = [
  ['inut_crm_health', 'Read MCP and backend health with dependency status.', 'read', 'read', 'system'],
  ['inut_crm_capabilities', 'List the versioned tool, resource, prompt, and route coverage catalog.', 'read', 'read', 'system'],
  ['inut_crm_whoami', 'Show the authenticated local MCP owner and backend session identity.', 'read', 'read', 'system'],
  ['inut_crm_audit_recent', 'Read recent redacted MCP audit events with bounded pagination.', 'read', 'read', 'system'],
  ['inut_crm_job_status', 'Read the status of a background KSP job by job identifier.', 'read', 'read', 'system'],

  ['crm_customers_search', 'Search CRM customers by company name, tax code, contact, or page.', 'read', 'read', 'crm'],
  ['crm_customer_get', 'Read one CRM customer, aliases, accounts, and document counts.', 'read', 'read', 'crm'],
  ['crm_customer_write', 'Prepare or execute bounded customer create, update, merge, or delete operations.', 'write', 'prepare_execute', 'crm'],
  ['crm_customer_account', 'Prepare or execute customer account creation, reset, or login-link operations.', 'high_risk', 'prepare_execute', 'crm'],
  ['crm_documents_search', 'Search the document vault with customer, type, signed, and paging filters.', 'read', 'read', 'documents'],
  ['crm_document_get', 'Read document metadata and signed-state details.', 'read', 'read', 'documents'],
  ['crm_document_write', 'Prepare or execute document assignment, rename, type, order, or delete operations.', 'write', 'prepare_execute', 'documents'],
  ['crm_document_download', 'Return a bounded artifact reference for a document or signed file.', 'read', 'read', 'documents'],
  ['crm_document_sign', 'Prepare or execute a PDF digital-signature operation with secret redaction.', 'high_risk', 'prepare_execute', 'signing'],
  ['crm_document_verify', 'Verify a PDF signature and return integrity, trust, revocation, and coverage results.', 'read', 'read', 'signing'],
  ['crm_document_share', 'Prepare or execute an expiring document share link operation.', 'write', 'prepare_execute', 'documents'],
  ['crm_orders', 'Read or mutate bounded CRM orders and document-order assignments.', 'write', 'prepare_execute', 'crm'],
  ['crm_users', 'Read users or prepare/execute scoped training-access and password operations.', 'high_risk', 'prepare_execute', 'crm'],

  ['commercial_templates', 'List available invoice, quote, contract, BBBG, and certificate templates.', 'read', 'read', 'commercial'],
  ['commercial_preview', 'Render a bounded preview for a supported commercial document type.', 'read', 'read', 'commercial'],
  ['commercial_generate', 'Prepare or execute generation of a supported commercial PDF/XLSX artifact.', 'write', 'prepare_execute', 'commercial'],
  ['commercial_invoice_parse', 'Parse invoice content from a bounded uploaded or stored artifact.', 'read', 'read', 'commercial'],
  ['commercial_products', 'Search the reusable product catalog and pricing metadata.', 'read', 'read', 'commercial'],
  ['commercial_settings', 'Read settings or prepare/execute a validated non-secret setting update.', 'high_risk', 'prepare_execute', 'commercial'],
  ['commercial_logo', 'Read or prepare/execute logo replacement and removal.', 'write', 'prepare_execute', 'commercial'],

  ['bidding_search', 'Search Mua Sam Cong tenders with bounded filters and pagination.', 'read', 'read', 'bidding'],
  ['bidding_tender_get', 'Read one tender detail and bookmark cross-reference.', 'read', 'read', 'bidding'],
  ['bidding_tender_analyze', 'Run AI or heuristic INUT fit analysis for a tender.', 'read', 'read', 'bidding'],
  ['bidding_bookmarks', 'Read or prepare/execute bookmark pipeline CRUD operations.', 'write', 'prepare_execute', 'bidding'],
  ['bidding_watchlists', 'Read or prepare/execute watchlist rule CRUD operations.', 'write', 'prepare_execute', 'bidding'],
  ['bidding_watch_scan', 'Prepare or execute a watchlist scan and Telegram alert dispatch.', 'high_risk', 'prepare_execute', 'bidding'],
  ['bidding_contractors', 'Search, profile, or CRM-scan contractor intelligence.', 'read', 'read', 'bidding'],
  ['bidding_won_packages', 'Read won-package intelligence and INUT strategic playbook data.', 'read', 'read', 'bidding'],
  ['bidding_attachments', 'List tender attachments or return bounded artifact references.', 'read', 'read', 'bidding'],
  ['bidding_competitors', 'Read competitor dossier metadata and bounded artifact references.', 'read', 'read', 'bidding'],

  ['inventory_warehouses', 'Read inventory warehouses and warehouse-level metadata.', 'read', 'read', 'inventory'],
  ['inventory_items', 'Read or prepare/execute item create, update, merge, and code suggestions.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_stock', 'Read stock, availability, card, flow, hanging value, and traceability reports.', 'read', 'read', 'inventory'],
  ['inventory_purchases', 'Read or prepare/execute purchase import, attach, post, void, recalc, and export operations.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_sales', 'Read or prepare/execute sale import, generate, rematch, BOM, post, void, and export operations.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_issues', 'Read or prepare/execute stock issue create, post, void, update, and delete operations.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_production', 'Read or prepare/execute production readiness, create, post, void, and export operations.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_recipes', 'Read or prepare/execute recipe and BOM description operations.', 'write', 'prepare_execute', 'inventory'],
  ['inventory_customs', 'Read or prepare/execute customs declaration, costs, attachment, post, and void operations.', 'high_risk', 'prepare_execute', 'inventory'],
  ['inventory_import_export', 'Prepare or execute bounded inventory opening/import/export jobs.', 'write', 'prepare_execute', 'inventory'],

  ['tax_status', 'Read tax credentials, session, CAPTCHA, policy, and auto-sync status without secrets.', 'read', 'read', 'tax'],
  ['tax_sync', 'Prepare or execute tax portal synchronization and scheduled tax jobs.', 'high_risk', 'prepare_execute', 'tax'],
  ['tax_review', 'Read or prepare/execute tax-review upload, inspect, and delete operations.', 'write', 'prepare_execute', 'tax'],
  ['tax_reports', 'Read or prepare/execute tax report generation, lock, export, and comparison.', 'high_risk', 'prepare_execute', 'tax'],
  ['ihoadon', 'Read iHOADON dashboards/drafts or prepare/execute sync and delivery operations.', 'high_risk', 'prepare_execute', 'finance'],
  ['payroll', 'Read or prepare/execute payroll employee, period, import, review, lock, payment, and Drive operations.', 'high_risk', 'prepare_execute', 'payroll'],
  ['email_sync', 'Read email-sync settings/runs or prepare/execute test and sync operations.', 'write', 'prepare_execute', 'integrations'],

  ['telegram', 'Read Telegram status or prepare/execute connect, disconnect, and notification operations.', 'high_risk', 'prepare_execute', 'integrations'],
  ['facebook_conversations', 'Read Facebook conversation metadata and bounded message history.', 'read', 'read', 'integrations'],
  ['customs_drive', 'Read or prepare/execute Customs Drive source, folder, review, and sync operations.', 'high_risk', 'prepare_execute', 'integrations'],
  ['nas', 'Read NAS status/browse/disk or prepare/execute test and sync operations.', 'high_risk', 'prepare_execute', 'integrations'],
  ['spx', 'Read SPX stats/orders or prepare/execute order, label, print, sync, and cancel operations.', 'high_risk', 'prepare_execute', 'integrations'],
  ['spx_print_by_label', 'In nhanh tem vận đơn SPX theo mã (SPXVN... / VN...) chuẩn Tỉ lệ vàng 65% sang máy in nhiệt TP732H.', 'high_risk', 'prepare_execute', 'integrations'],
  ['pymid', 'Read or prepare/execute PYMID staff, catalog, and order operations.', 'write', 'prepare_execute', 'integrations'],
  ['training', 'Read or prepare/execute admin training search, ask, jobs, history, and knowledge operations.', 'write', 'prepare_execute', 'knowledge'],
  ['ai', 'Read AI status or prepare/execute bounded AI test and narrative operations.', 'write', 'prepare_execute', 'knowledge'],
  ['standards', 'Read standards/search/playbooks or prepare/execute declaration and game operations.', 'write', 'prepare_execute', 'knowledge'],
  ['standards_tqc_status', 'Read TQC CNHQ connector status, cache policy, and safe configuration flags.', 'read', 'read', 'knowledge'],
  ['standards_tqc_search', 'Search locally verified TQC CNHQ records by model, manufacturer, applicant, or certificate number.', 'read', 'read', 'knowledge'],
  ['standards_tqc_get', 'Verify one TQC CNHQ certificate live or read a fresh local cache with provenance.', 'read', 'read', 'knowledge'],
  ['standards_tqc_import', 'Prepare or execute bounded import of TQC certificate numbers and official QR payloads.', 'write', 'prepare_execute', 'knowledge'],
  ['standards_tqc_import_job', 'Read the latest or one durable TQC CSV import job with progress and recovery state.', 'read', 'read', 'knowledge'],
  ['standards_tqc_import_retry', 'Prepare or execute a retry for a failed durable TQC CSV import job.', 'write', 'prepare_execute', 'knowledge'],
  ['operations_dashboard', 'Read the operations dashboard and bounded scheduled-job summaries.', 'read', 'read', 'system'],
]

const common = { read: readInput, mutation: mutationInput }

export const toolDefinitions = definitions.map(([name, description, access, execution, category]) => ({
  name,
  description,
  access,
  execution,
  category,
  inputSchema: schemaOverrides[name] || (execution === 'read' ? common.read : common.mutation),
  handler: name,
  annotations: {
    readOnlyHint: access === 'read',
    destructiveHint: access === 'high_risk',
    openWorldHint: ['bidding', 'integrations', 'tax', 'finance'].includes(category),
  },
}))

export const toolNames = toolDefinitions.map((definition) => definition.name)

export function getToolDefinition(name) {
  return toolDefinitions.find((definition) => definition.name === name)
}

export const routeCoverage = {
  core: ['auth', 'customers', 'documents', 'orders', 'users', 'audit', 'settings'],
  signing: ['upload', 'certs', 'sign', 'verify', 'share'],
  bidding: ['search', 'tenders', 'bookmarks', 'watchlist', 'contractors', 'won-packages', 'playbook', 'attachments', 'competitors'],
  inventory: ['warehouses', 'items', 'stock', 'purchase', 'sale', 'issues', 'productions', 'recipes', 'customs'],
  tax_finance: ['tax', 'tax-review', 'tax-reports', 'ihoadon', 'payroll', 'email-sync'],
  integrations: ['telegram', 'facebook', 'customs-drive', 'nas', 'spx', 'spx_print_by_label', 'pymid'],
  knowledge: ['training', 'ai', 'standards', 'standards-tqc', 'operations'],
}
