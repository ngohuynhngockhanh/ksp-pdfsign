// Client goi backend. Cookie phien duoc gui tu dong (credentials: include).

export interface CertInfo {
  id: string;
  subject: string;
  issuer: string;
  serial: string;
  valid_from: string;
  valid_to: string;
}

export interface TaxFinding {
  level: "do" | "vang";
  title: string;
  detail: string;
  cells: string[];
}
export interface TaxPolicy {
  date: string;
  reduction_active: boolean;
  standard_eligible_rate: number;
  reduction_from: string;
  reduction_to: string;
  software_category: "KCT";
  notes: string[];
  legal_basis: string[];
}
export interface TaxReviewSummary {
  ban_ra_dt: number;
  ban_ra_thue: number;
  mua_vao_dt: number;
  mua_vao_thue: number;
  khau_tru_ky_truoc: number;
  ct_36: number | null;
  ct_40: number | null;
  ct_41: number | null;
  ct_43: number | null;
  so_hd_ban: number;
  so_hd_mua: number;
  do: number;
  vang: number;
}
export interface TaxReviewItem {
  id: number;
  ky: string;
  ten_file: string;
  note: string;
  n_do: number;
  n_vang: number;
  summary: TaxReviewSummary;
  uploaded_by: string;
  uploaded_at: string;
}

export interface TqcCertificate {
  certificate_no: string;
  issue_date: string;
  expiry_date: string;
  applicant_name: string;
  product_name: string;
  model: string;
  manufacturer: string;
  factory_name: string;
  factory_address: string;
  technical_regulations: string[];
  certification_method: string;
  serial_form_no: string;
  source_status: string;
  derived_status: "active" | "expired" | "cancelled" | "unknown";
  provenance: {
    verification_status: string;
    source_url: string;
    checked_at: string | null;
    cache_age_seconds?: number;
  };
}

export interface TqcSearchResponse {
  items: TqcCertificate[];
  total: number;
  page: number;
  page_size: number;
  search_scope: "local_index";
  index_last_updated_at: string | null;
  warning?: string;
  verification_status?: string;
}

export interface TqcImportResult {
  requested: number;
  processed: number;
  verified: number;
  cached: number;
  not_found: number;
  errors: Array<{ index: number; code: string; message: string }>;
  items: Array<Record<string, any>>;
}

export interface TqcImportJob {
  job_id: number;
  status: "running" | "success" | "failed";
  phase: string;
  progress: number;
  requested: number;
  result: TqcImportResult | null;
  error: string;
  started_at: string;
  finished_at: string | null;
}
export interface TaxGrid {
  name: string;
  rows: string[][];
  ncols: number;
  merges: number[][]; // [r1,c1,r2,c2] 0-indexed
}

export interface Rect {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Customer {
  id: number;
  name: string;
  tax_code: string;
  contact: string;
  address: string;
  email: string;
  logo_url: string;
  note: string;
  created_at: string;
  document_count: number;
  account_usernames: string[];
  aliases: string[];
}

export interface ContractDraft {
  id: number;
  customer_id: number;
  customer_name: string;
  title: string;
  version: number;
  status: "draft" | "finalized";
  document_id: number | null;
  finalized_at: string | null;
  payload: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DocRecord {
  id: number;
  doc_id: string;
  filename: string;
  signer_name: string;
  signed: boolean;
  note: string;
  customer_id: number | null;
  customer_name: string | null;
  created_at: string;
  download_url: string;
  nas_synced: boolean;
  doc_type: string;
  signed_upload_name: string;
  order_id: number | null;
  order_code: string;
}

export interface CustomerInvoice {
  id: number;
  invoice_number: string;
  invoice_series: string;
  invoice_date: string;
  buyer_tax_code: string;
  buyer_name: string;
  total_payment: number;
  status: string;
  adjustment_type: string;
  customer_id: number | null;
  customer_name: string | null;
  match_source: string;
  pdf_ready: boolean;
  xml_ready: boolean;
  sync_error: string;
  synced_at: string;
}

export interface OrderRec {
  id: number;
  code: string;
  name: string;
  customer_id: number | null;
  customer_name: string | null;
  note: string;
  created_at: string;
  document_count: number;
}

export const DOC_TYPES: Record<string, string> = {
  "": "Chưa phân loại",
  bbbg: "Biên bản bàn giao",
  bbnt: "Biên bản nghiệm thu",
  hop_dong: "Hợp đồng",
  bao_gia: "Báo giá",
  de_nghi_tt: "Đề nghị thanh toán",
  hoa_don: "Hóa đơn",
  khac: "Khác",
};

export interface SignatureReport {
  field_name: string;
  signer_name: string;
  signing_time: string | null;
  certificate_issuer: string;
  certificate_valid_from: string | null;
  certificate_valid_to: string | null;
  intact: boolean;
  valid: boolean;
  trusted: boolean;
  revocation_ok: boolean | null;
  has_timestamp: boolean;
  ltv: string | null;
  coverage: string;
  summary: string;
  problems: string[];
}

function _detailToMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Loi validate 422 cua FastAPI: [{loc, msg, type}, ...]
    return detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)))
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; violations?: { ma_hang?: string; ten?: string; ngay?: string; thieu?: number }[] };
    if (d.message) {
      const vs = Array.isArray(d.violations)
        ? d.violations
            .map((v) => `${v.ma_hang || v.ten || "?"} tại ${v.ngay ?? "?"} (thiếu ${v.thieu ?? "?"})`)
            .join("; ")
        : "";
      return vs ? `${d.message} — ${vs}` : d.message;
    }
    return JSON.stringify(d);
  }
  return null;
}

export interface NegStockViolation {
  item_id?: number;
  ma_hang?: string;
  ten?: string;
  warehouse_id?: number;
  ngay?: string;
  thieu?: number;
}

export interface PayrollEmployee {
  id: number; code: string; name: string; position: string;
  base_salary: number; insurance_salary: number; meal_allowance: number;
  phone_allowance: number; fuel_allowance: number; responsibility_allowance: number;
  dependents: number; active: boolean;
}

export interface PayrollLine {
  id: number; employee_id: number; employee: PayrollEmployee;
  standard_days: number; actual_days: number; overtime_pay: number; bonus: number;
  other_taxable: number; unpaid_deduction: number;
  computed: Record<string, number>; overrides: Record<string, number>; override_reason: string;
}

export interface PayrollPeriod {
  id: number; month: string; version: number; status: "draft" | "reviewed" | "locked";
  findings: { level: "do" | "vang"; message: string; employee_code?: string }[];
  lines: PayrollLine[];
}

export interface PayrollImportItem {
  id: number; month: string; filename: string; imported_at: string;
  findings: { level: "do" | "vang"; code: string; message: string; cells?: string[] }[];
}

export interface PayrollImportDetail extends PayrollImportItem {
  snapshot: { sheet: string; month: string; grid: string[][]; ncols: number };
}

export interface PayrollWorkbookChange {
  row: number; meal_allowance?: number; attendance_bonus?: number;
  overtime_weekday_hours?: number; overtime_weekend_hours?: number; reason: string;
}

export interface PayrollWorkbookDraft {
  id: number; import_id: number; status: "draft" | "reviewed" | "uploaded";
  changes: PayrollWorkbookChange[]; findings: PayrollImportItem["findings"];
  drive_filename: string; updated_at: string;
}

export interface PayrollNetTargetPlan {
  feasible: boolean; current_net: number; target_net: number; proposed_net: number; shortfall: number;
  current_pit: number; proposed_pit: number;
  current_employee_insurance: number; proposed_employee_insurance: number;
  proposed: { meal_allowance: number; overtime_weekday_hours: number;
    overtime_weekend_hours: number; attendance_bonus: number | null; performance_bonus: number };
  cashflows: { key: string; label: string; current: number; proposed: number; delta: number }[];
  dependencies: string[]; warnings: string[];
}

export interface PayrollPayment {
  id: number; employee_id: number; month: string; amount: number;
  status: "prepared" | "completed" | "cancelled"; paid_at: string;
  bank_name: string; transaction_ref: string; note: string;
  evidence_name: string; evidence_missing: boolean; cancel_reason: string;
}

export interface PayrollHrMonth {
  month: string; statement_id: number; source_import_id: number;
  gross_income: number; employee_insurance: number; employer_insurance: number; pit_withheld: number;
  net_payable: number; paid: number; outstanding: number;
  reconciliation_status: "pending_revision" | "missing_evidence" | "paid" | "partial" | "unpaid";
  payments: PayrollPayment[];
}

export interface PayrollHrEmployee {
  employee_id: number; code: string; name: string; position: string;
  net_payable: number; paid: number; outstanding: number; gross_income: number;
  tax: { withheld: number; annual_pit: number; annual_taxable_income: number;
    balance: number; self_deduction: number; dependent_deduction: number;
    education_deduction: number; basis: string };
  months: PayrollHrMonth[];
}

export interface PayrollHrSummary {
  year: number; employees: PayrollHrEmployee[];
  totals: { net_payable: number; paid: number; outstanding: number;
    pit_withheld: number; annual_pit: number };
}

export interface PayrollBonusScenario {
  key: string; label: string; gross_bonus: number; additional_pit: number;
  net_bonus: number; effective_tax_rate: number;
}

export interface PayrollForecast {
  year: number; actual_through: string; growth_rate: number;
  future_months: { month: string; gross_income: number; net_payable: number; pit_estimate: number }[];
  baseline: { gross_income: number; net_payable: number; annual_pit: number; pit_withheld: number };
  recommended: PayrollBonusScenario;
  scenarios: PayrollBonusScenario[];
  employees: { employee_id: number; name: string; reference_monthly_gross: number;
    next_band_headroom: number; recommended_bonus: number; additional_pit: number; net_bonus: number }[];
  assumptions: string[];
}

export interface TrainingEvidence {
  title: string;
  url: string;
  quote?: string;
  timestamp?: string;
}

/** Output intent sent with Training requests; the server may use this to pick a playbook. */
export type TrainingMode = "technical" | "sales";

export interface TrainingAnswer {
  answer: string;
  sourceBasis?: string;
  generalGuidance?: string;
  warnings?: string[];
  followUps?: string[];
  videoEvidence?: TrainingEvidence[];
  documentationEvidence?: TrainingEvidence[];
}

export interface TrainingSearchResult {
  sourceType: "video" | "help" | "website";
  sourceId: string;
  sourceTitle: string;
  videoTitle?: string;
  timestamp?: string;
  text: string;
  citationUrl: string;
  score: number;
}

export interface TrainingPublicLead {
  id: number;
  phone: string;
  phoneLast4: string;
  locale: string;
  status: string;
  note: string;
  createdAt: string;
  lastSeenAt: string;
  questionCount: number;
  lastQuestion: string;
}

export interface TrainingPublicQuery {
  jobId: string;
  question: string;
  status: string;
  stage: string;
  // Older jobs stored the full Hermes response as { answer: TrainingAnswer }.
  answer: TrainingAnswer | { answer: TrainingAnswer };
  createdAt: string;
  completedAt: string | null;
  durationMs: number;
}

// Loi am kho: mang theo danh sach vi pham de UI mo modal nhap ly do (duyet am kho).
// --- Bidding / Procurement Interfaces (Mua Sắm Công) ---
export interface BiddingTenderSummary {
  tbmt_code: string;
  tender_name: string;
  procuring_entity: string;
  investor?: string;
  field: string;
  bid_price: number;
  bid_deadline?: string | null;
  bid_opening_date?: string | null;
  province: string;
  bidding_method?: string;
  source_url?: string;
  is_bookmarked?: boolean;
  bookmark_id?: number | null;
  bookmark_status?: "watching" | "preparing" | "submitted" | "won" | "lost" | null;
  is_closed?: boolean;
}

export interface BiddingTenderDetail extends BiddingTenderSummary {
  bid_validity_period_days?: number | null;
  execution_period_days?: number | null;
  decision_number?: string;
  description?: string;
  ai_summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiddingSearchResult {
  items: BiddingTenderSummary[];
  total: number;
  page: number;
  page_size?: number;
  per_page?: number;
  total_pages: number;
  is_mock?: boolean;
}

export interface BiddingBookmarkItem {
  id: number;
  tbmt_code: string;
  tender_name: string;
  procuring_entity: string;
  investor: string;
  field: string;
  bid_price: number;
  bid_deadline: string | null;
  bid_opening_date?: string | null;
  province: string;
  bidding_method?: string;
  source_url: string;
  status: "watching" | "preparing" | "submitted" | "won" | "lost";
  note: string;
  ai_summary: string;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface BiddingBookmarkListOut {
  items: BiddingBookmarkItem[];
  total: number;
}

export interface BiddingBookmarkCreate {
  tbmt_code: string;
  tender_name: string;
  procuring_entity?: string;
  investor?: string;
  field?: string;
  bid_price?: number;
  bid_deadline?: string | null;
  bid_opening_date?: string | null;
  province?: string;
  bidding_method?: string;
  source_url?: string;
  status?: "watching" | "preparing" | "submitted" | "won" | "lost";
  note?: string;
  ai_summary?: string;
}

export interface BiddingBookmarkUpdate {
  status?: "watching" | "preparing" | "submitted" | "won" | "lost";
  note?: string;
  ai_summary?: string;
  tender_name?: string;
  bid_price?: number;
  bid_deadline?: string | null;
}

export interface BiddingWatchlistItem {
  id: number;
  name: string;
  keyword: string;
  province: string;
  field: string;
  min_price: number | null;
  max_price: number | null;
  method?: string;
  notify_telegram: boolean;
  is_active: boolean;
  last_checked_at: string | null;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface BiddingWatchlistListOut {
  items: BiddingWatchlistItem[];
  total: number;
}

export interface BiddingWatchlistCreate {
  name: string;
  keyword?: string;
  province?: string;
  field?: string;
  min_price?: number | null;
  max_price?: number | null;
  method?: string;
  notify_telegram?: boolean;
  is_active?: boolean;
}

export interface BiddingWatchlistUpdate {
  name?: string;
  keyword?: string;
  province?: string;
  field?: string;
  min_price?: number | null;
  max_price?: number | null;
  method?: string;
  notify_telegram?: boolean;
  is_active?: boolean;
}

export interface BiddingAIAnalysisData {
  executive_summary?: string;
  summary?: string;
  scope_of_work?: string[];
  capacity_requirements?: string[] | string;
  revenue_requirements?: string;
  financial_requirements?: {
    min_annual_revenue?: number;
    financial_resources?: number;
    bid_security_amount?: number;
    summary?: string;
  } | string;
  key_personnel_requirements?: string[];
  equipment_requirements?: string[];
  critical_timeline?: {
    bid_closing_at?: string;
    clarification_deadline?: string;
    execution_period_days?: number;
    timeline_notes?: string;
  } | string;
  inut_fit_analysis?: {
    score: number;
    match_level?: string;
    strengths: string[];
    challenges?: string[];
    risks?: string[];
    recommendation: string;
    strategic_action_plan?: string;
  };
  inut_compatibility_score?: number;
  strengths?: string[];
  risks?: string[];
  recommendations?: string;
}

export interface BiddingAIAnalysisResult {
  tbmt_code: string;
  analysis: BiddingAIAnalysisData;
  saved_to_bookmark?: boolean;
}

export interface BiddingScanResult {
  ok?: boolean;
  watchlists_scanned?: number;
  new_tenders_found?: number;
  matched_count?: number;
  alerts_sent?: number;
  new_alerts_sent?: number;
  alerts_failed?: number;
  details?: any[];
  count_new?: number;
  new_matches_count?: number;
  message?: string;
}

export interface BiddingWonPackage {
  tbmt_code: string;
  tender_name: string;
  procuring_entity: string;
  bid_price: number;
  won_price: number;
  discount_percent: number;
  award_date: string;
  decision_number: string;
  status: string;
}

export interface BiddingContractorItem {
  customer_id?: number | null;
  tax_code: string;
  name: string;
  short_name?: string;
  address?: string;
  email?: string;
  bidding_status: string;
  bidding_status_label: string;
  total_bids: number;
  total_won: number;
  total_lost: number;
  total_evaluating: number;
  win_rate_percent: number;
  total_won_value_vnd: number;
  total_won_value_formatted: string;
  average_discount_percent: number;
  top_procuring_entities: string[];
  highlight_won_packages: BiddingWonPackage[];
  ai_insight?: string;
}

export interface BiddingCrmScanResult {
  total_crm_customers: number;
  total_won_contractors: number;
  total_won_value_vnd: number;
  total_won_value_formatted: string;
  items: BiddingContractorItem[];
}

export class NegStockError extends Error {
  violations: NegStockViolation[];
  constructor(message: string, violations: NegStockViolation[]) {
    super(message);
    this.name = "NegStockError";
    this.violations = violations;
  }
}

async function req<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    let detail: unknown = null;
    try {
      const j = await res.json();
      detail = j.detail;
      msg = _detailToMessage(detail) ?? msg;
    } catch {
      /* ignore */
    }
    // Loi am kho tra ve object {message, violations} -> nem NegStockError rieng
    if (detail && typeof detail === "object" && Array.isArray((detail as { violations?: unknown }).violations)) {
      throw new NegStockError(msg, (detail as { violations: NegStockViolation[] }).violations);
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  bidding: {
    async search(params: {
      keyword?: string;
      province?: string;
      field?: string;
      min_price?: number | null;
      max_price?: number | null;
      method?: string;
      status?: string;
      page?: number;
      page_size?: number;
      per_page?: number;
    }) {
      const q = new URLSearchParams();
      if (params.keyword) q.set("keyword", params.keyword);
      if (params.province) q.set("province", params.province);
      if (params.field) q.set("field", params.field);
      if (params.min_price != null && !isNaN(params.min_price)) q.set("min_price", String(params.min_price));
      if (params.max_price != null && !isNaN(params.max_price)) q.set("max_price", String(params.max_price));
      if (params.method) q.set("method", params.method);
      if (params.status) q.set("status", params.status);
      if (params.page) q.set("page", String(params.page));
      const size = params.page_size || params.per_page;
      if (size) q.set("page_size", String(size));
      const qs = q.toString();
      return req<BiddingSearchResult>(`/api/bidding/search${qs ? `?${qs}` : ""}`);
    },

    async getTender(tbmtCode: string) {
      return req<BiddingTenderDetail>(`/api/bidding/tenders/${encodeURIComponent(tbmtCode)}`);
    },

    getHtmlPreviewUrl(tbmtCode: string) {
      return `/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/html-preview`;
    },

    async analyzeAI(tbmtCode: string, customContext?: string) {
      return req<BiddingAIAnalysisResult>(`/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/analyze-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_context: customContext || "" }),
      });
    },

    async listBookmarks(params?: { status?: string; field?: string; search?: string }) {
      const q = new URLSearchParams();
      if (params?.status) q.set("status", params.status);
      if (params?.field) q.set("field", params.field);
      if (params?.search) q.set("search", params.search);
      const qs = q.toString();
      const res = await req<BiddingBookmarkItem[] | BiddingBookmarkListOut | { items: BiddingBookmarkItem[]; total?: number }>(
        `/api/bidding/bookmarks${qs ? `?${qs}` : ""}`
      );
      const list = Array.isArray(res) ? res : (res?.items || []);
      return list as BiddingBookmarkItem[];
    },

    async createBookmark(data: BiddingBookmarkCreate) {
      return req<BiddingBookmarkItem>("/api/bidding/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },

    async updateBookmark(id: number, data: BiddingBookmarkUpdate) {
      return req<BiddingBookmarkItem>(`/api/bidding/bookmarks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },

    async deleteBookmark(id: number) {
      return req<{ ok: boolean }>(`/api/bidding/bookmarks/${id}`, {
        method: "DELETE",
      });
    },

    async listWatchlist() {
      const res = await req<BiddingWatchlistItem[] | BiddingWatchlistListOut | { items: BiddingWatchlistItem[]; total?: number }>(
        "/api/bidding/watchlist"
      );
      const list = Array.isArray(res) ? res : (res?.items || []);
      return list as BiddingWatchlistItem[];
    },

    async createWatchlist(data: BiddingWatchlistCreate) {
      return req<BiddingWatchlistItem>("/api/bidding/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },

    async updateWatchlist(id: number, data: BiddingWatchlistUpdate) {
      return req<BiddingWatchlistItem>(`/api/bidding/watchlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },

    async deleteWatchlist(id: number) {
      return req<{ ok: boolean }>(`/api/bidding/watchlist/${id}`, {
        method: "DELETE",
      });
    },

    async scanWatchlist(id: number) {
      return req<BiddingScanResult>(`/api/bidding/watchlist/${id}/scan`, {
        method: "POST",
      });
    },

    async scanAllWatchlists() {
      return req<BiddingScanResult>("/api/bidding/watchlist/scan-all", {
        method: "POST",
      });
    },

    async scanCrmContractors() {
      return req<BiddingCrmScanResult>("/api/bidding/contractors/crm-scan");
    },

    async searchContractors(query: string) {
      return req<BiddingContractorItem[]>(`/api/bidding/contractors/search?query=${encodeURIComponent(query)}`);
    },

    async getContractorProfile(taxCode: string) {
      return req<BiddingContractorItem>(`/api/bidding/contractors/${encodeURIComponent(taxCode)}`);
    },

    async getWonPackages(query = "", field = "") {
      const q = new URLSearchParams();
      if (query) q.set("query", query);
      if (field) q.set("field", field);
      const qs = q.toString();
      return req<{
        total_packages: number;
        total_won_value_vnd: number;
        total_won_value_formatted: string;
        average_discount_percent: number;
        packages: any[];
      }>(`/api/bidding/won-packages${qs ? `?${qs}` : ""}`);
    },

    async getPlaybook() {
      return req<{
        company_name: string;
        tax_code: string;
        strategic_sweet_spot_discount: string;
        standard_e_hsdt_kits: any[];
        subcontractor_partnership_action_plan: any[];
      }>("/api/bidding/playbook");
    },

    async getAttachments(tbmtCode: string) {
      return req<Array<{
        file_id: string;
        filename: string;
        title: string;
        file_type: string;
        file_size: string;
        badge: string;
        icon: string;
        description: string;
        download_url: string;
      }>>(`/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/attachments`);
    },

    getAttachmentDownloadUrl(tbmtCode: string, fileId: string) {
      return `/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/attachments/${encodeURIComponent(fileId)}/download`;
    },

    getFullDossierZipUrl(tbmtCode: string) {
      return `/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/download-all-zip`;
    },

    async getCompetitors(tbmtCode: string) {
      return req<Array<{
        ranking: number;
        status: string;
        status_label: string;
        contractor_name: string;
        tax_code: string;
        address: string;
        bid_price: number;
        bid_price_formatted: string;
        discount_percent: number;
        tech_score: number;
        eval_result: string;
        files: Array<{
          file_id: string;
          title: string;
          file_type: string;
          size: string;
        }>;
      }>>(`/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/competitors`);
    },

    getCompetitorFileDownloadUrl(tbmtCode: string, taxCode: string, fileId: string) {
      return `/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/competitors/${encodeURIComponent(taxCode)}/files/${encodeURIComponent(fileId)}/download`;
    },

    getAllCompetitorsZipUrl(tbmtCode: string) {
      return `/api/bidding/tenders/${encodeURIComponent(tbmtCode)}/competitors/download-all-zip`;
    },
  },

  standards: {
    async getStatistics() {
      return req<{
        total_standards: number;
        by_ministry: Record<string, number>;
        by_category: Record<string, number>;
        updated_at: string;
      }>("/api/standards/statistics");
    },

    async search(params: {
      q?: string;
      ministry?: string;
      category?: string;
      procedure_type?: string;
    } = {}) {
      const p = new URLSearchParams();
      if (params.q) p.set("q", params.q);
      if (params.ministry) p.set("ministry", params.ministry);
      if (params.category) p.set("category", params.category);
      if (params.procedure_type) p.set("procedure_type", params.procedure_type);
      const qs = p.toString();
      return req<Array<{
        code: string;
        name: string;
        ministry: string;
        ministry_label: string;
        category: string;
        category_label: string;
        circular: string;
        effective_date: string;
        status: string;
        procedure_type: string;
        procedure_label: string;
        target_equipment: string;
        applicable_hs_codes: string[];
        managing_agency: string;
        certification_method: string;
        testing_labs: string[];
        key_technical_requirements: string[];
        inut_product_match: string;
      }>>(`/api/standards/search${qs ? `?${qs}` : ""}`);
    },

    async getTqcStatus() {
      return req<{
        enabled: boolean;
        base_url: string;
        api_key_configured: boolean;
        rate_limit_per_minute: number;
        cache_ttl_seconds: number;
        search_mode: string;
      }>("/api/standards/tqc/status");
    },

    async searchTqc(params: {
      q?: string;
      model?: string;
      manufacturer?: string;
      applicant?: string;
      certificate_no?: string;
      status?: string;
      valid_on?: string;
      page?: number;
      page_size?: number;
    } = {}) {
      const p = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== "") p.set(key, String(value));
      });
      const qs = p.toString();
      return req<TqcSearchResponse>(`/api/standards/tqc/search${qs ? `?${qs}` : ""}`);
    },

    async getTqcCertificate(certificateNo: string, refresh = false) {
      const suffix = refresh ? "?refresh=true" : "";
      return req<{ certificate: TqcCertificate }>(`/api/standards/tqc/certificates/${encodeURIComponent(certificateNo)}${suffix}`);
    },

    async importTqc(entries: Array<{ certificate_no?: string; qr_input?: string }>, refresh_existing = false) {
      return req<TqcImportResult>("/api/standards/tqc/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, refresh_existing }),
      });
    },

    async importTqcCsv(file: File, refresh_existing = false) {
      const form = new FormData();
      form.append("file", file);
      return req<{
        job_id: number;
        status: "running";
        requested: number;
      }>(`/api/standards/tqc/import/csv?refresh_existing=${refresh_existing ? "true" : "false"}`, {
        method: "POST",
        body: form,
      });
    },

    async getTqcImportJob(jobId: number) {
      return req<TqcImportJob>(`/api/standards/tqc/import/jobs/${jobId}`);
    },

    async getLatestTqcImportJob() {
      return req<{ job: TqcImportJob | null }>("/api/standards/tqc/import/jobs/latest");
    },

    async retryTqcImportJob(jobId: number) {
      return req<TqcImportJob>(`/api/standards/tqc/import/jobs/${jobId}/retry`, { method: "POST" });
    },

    async lookupHsCode(hsCode: string) {
      return req<{
        hs_code: string;
        hs_description: string;
        applicable_standards: string[];
        customs_inspection_agency: string;
        inspection_type: string;
        required_procedure: string;
        customs_notes: string;
        exemption_cases: string;
      }>(`/api/standards/hs-lookup/${encodeURIComponent(hsCode)}`);
    },

    async getHsMappings() {
      return req<Array<{
        hs_code: string;
        hs_description: string;
        applicable_standards: string[];
        customs_inspection_agency: string;
        inspection_type: string;
        required_procedure: string;
        customs_notes: string;
        exemption_cases: string;
      }>>("/api/standards/hs-mappings");
    },

    async getTestingLabs() {
      return req<Array<{
        id: number;
        name: string;
        code: string;
        ministry: string;
        address: string;
        branch?: string;
        phone: string;
        email: string;
        scope: string[];
        average_testing_time_days: string;
        estimated_cost_vnd: string;
        badge: string;
      }>>("/api/standards/testing-labs");
    },

    async getPlaybooks() {
      return req<Array<{
        id: string;
        title: string;
        subtitle: string;
        category: string;
        badge: string;
        hs_codes: Array<{
          code: string;
          description: string;
          import_tax_mfn: string;
          import_tax_form_e: string;
          vat_rate: string;
          recommended: boolean;
        }>;
        required_standards: Array<{
          code: string;
          name: string;
          procedure: string;
          test_scope: string;
        }>;
        six_step_workflow?: Array<{
          step: number;
          title: string;
          description: string;
        }>;
        cost_estimate: {
          state_fees?: Array<{ name: string; cost: string; agency: string }>;
          lab_testing_fees?: Array<{ scope: string; cost: string; time: string }>;
          total_lab_cost_range?: string;
          forwarder_service_cost_range?: string;
        };
        practical_tips: string[];
      }>>("/api/standards/playbooks");
    },

    async getPlaybookDetail(playbookId: string) {
      return req<any>(`/api/standards/playbooks/${encodeURIComponent(playbookId)}`);
    },

    getStandardPdfUrl(code: string) {
      return `/api/standards/${encodeURIComponent(code)}/pdf`;
    },

    getCrDeclarationPdfUrl(payload: any) {
      return "/api/standards/generate-cr-declaration/pdf";
    },

    getCrDeclarationDocxUrl(payload: any) {
      return "/api/standards/generate-cr-declaration/docx";
    },

    async getGameState() {
      return req<{
        current_level: number;
        current_level_title: string;
        current_exp: number;
        max_exp: number;
        progress_percent: number;
        completed_quests_count: number;
        total_quests: number;
        ai_companion_cheer: string;
        quests: Array<{
          quest_id: number;
          title: string;
          subtitle: string;
          description: string;
          ai_companion_tip: string;
          secret_cheatsheet: string;
          exp_reward: number;
          level_title: string;
          status: "pending" | "in_progress" | "completed";
          completed_at?: string;
          personal_note?: string;
        }>;
      }>("/api/standards/game/state");
    },

    async completeGameQuest(questId: number, note: string = "") {
      return req<any>("/api/standards/game/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quest_id: questId, note }),
      });
    },

    async updateGameNote(questId: number, note: string) {
      return req<any>("/api/standards/game/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quest_id: questId, note }),
      });
    },

    async resetGame() {
      return req<any>("/api/standards/game/reset", {
        method: "POST",
      });
    },
  },
  async trainingSearch(query: string) {
    return req<{ results: TrainingSearchResult[] }>(`/api/training/search?q=${encodeURIComponent(query)}`);
  },
  async trainingAsk(question: string, sessionId = "", mode: TrainingMode = "technical") {
    return req<{ sessionId: string; answer: TrainingAnswer }>("/api/training/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, session_id: sessionId, mode }),
    });
  },
  async trainingJobStart(question: string, sessionId = "", mode: TrainingMode = "technical") {
    return req<{ jobId: string; status: string; stage: string }>("/api/training/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, session_id: sessionId, mode }),
    });
  },
  async trainingJobStatus(jobId: string) {
    return req<{
      status: "running" | "done" | "failed";
      stage: string;
      error?: string;
      result?: { sessionId: string; answer: TrainingAnswer };
    }>(`/api/training/jobs/${encodeURIComponent(jobId)}`);
  },
  async trainingStats() {
    return req<{
      totals: { questions: number; tokens: number; successful: number };
      users: { username: string; questions: number; tokens: number; durationMs: number }[];
      recent: { username: string; question: string; status: string; tokens: number; durationMs: number; createdAt: string }[];
      runtime: {
        limit: number;
        windowSeconds: number;
        windowCount: number;
        active: number;
        total: number;
        completed: number;
        failed: number;
        rejected: number;
        lastError: string;
      };
      facebook: {
        total: number;
        inbound: number;
        outbound: number;
        replied: number;
        rejected: number;
        failed: number;
        statuses: Record<string, number>;
        latency: { count: number; averageMs: number; p50Ms: number; p95Ms: number; maxMs: number };
        stages: Record<string, { count: number; averageMs: number; p50Ms: number; p95Ms: number; maxMs: number }>;
        recent: { direction: string; status: string; name: string; text: string; error: string; createdAt: string; queueLatencyMs: number; latencyMs: number; hermesLatencyMs: number; contextLatencyMs: number; sendLatencyMs: number }[];
      };
      tokenNote: string;
    }>("/api/training/stats");
  },
  async facebookConversations(limit = 100) {
    return req<{ items: {
      conversationId: string;
      pageId: string;
      psid: string;
      name: string;
      messageCount: number;
      failedCount: number;
      lastText: string;
      lastDirection: string;
      lastStatus: string;
      lastAt: string;
      lastLatencyMs: number;
    }[] }>(`/api/facebook/conversations?limit=${limit}`);
  },
  async facebookConversationHistory(pageId: string, psid: string) {
    return req<{
      pageId: string;
      psid: string;
      name: string;
      items: { id: number; direction: string; text: string; status: string; error: string; createdAt: string; queueLatencyMs: number; latencyMs: number; hermesLatencyMs: number; contextLatencyMs: number; sendLatencyMs: number }[];
    }>(`/api/facebook/conversations/${encodeURIComponent(pageId)}/${encodeURIComponent(psid)}`);
  },
  async trainingHistory() {
    return req<{ items: { jobId: string; question: string; status: string; answer: TrainingAnswer; createdAt: string; completedAt: string | null; durationMs: number }[] }>("/api/training/history");
  },
  async trainingKnowledge(userId?: number) {
    const query = userId ? `?user_id=${userId}` : "";
    return req<{ items: { id: number; userId: number; title: string; content: string; enabled: boolean; updatedAt: string }[] }>(`/api/training/knowledge${query}`);
  },
  async createTrainingKnowledge(userId: number, title: string, content: string) {
    return req<{ id: number }>("/api/training/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, title, content }) });
  },
  async deleteTrainingKnowledge(id: number) {
    return req<{ ok: boolean }>(`/api/training/knowledge/${id}`, { method: "DELETE" });
  },
  async trainingShare(question: string, answer: TrainingAnswer, days = 30) {
    return req<{ url: string; expires_at: string }>("/api/training/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, days }),
    });
  },
  async trainingPublicLeads() {
    return req<{ items: TrainingPublicLead[] }>("/api/training/public-leads");
  },
  async trainingPublicLead(id: number, reveal = false) {
    return req<TrainingPublicLead & { queries: TrainingPublicQuery[] }>(`/api/training/public-leads/${id}?reveal=${reveal ? "true" : "false"}`);
  },
  async updateTrainingPublicLead(id: number, payload: { status?: string; note?: string }) {
    return req<TrainingPublicLead>(`/api/training/public-leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  },
  async deleteTrainingPublicLead(id: number) {
    return req<{ ok: boolean }>(`/api/training/public-leads/${id}`, { method: "DELETE" });
  },
  async login(username: string, password: string) {
    return req<{ ok: boolean; username: string }>("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  },
  async logout() {
    return req("/api/logout", { method: "POST" });
  },
  async me() {
    return req<{
      username: string;
      role: string;
      portal_scope: string;
      customer_id: number | null;
      customer_name: string | null;
      agent_default_ip: string;
      default_location: string;
      using_default_secrets: boolean;
      must_change_password: boolean;
      training_access: boolean;
    }>("/api/me");
  },
  async upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ doc_id: string; filename: string }>("/api/upload", {
      method: "POST",
      body: fd,
    });
  },
  async uploadZip(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ files: { doc_id: string; filename: string; size: number }[] }>(
      "/api/upload-zip",
      { method: "POST", body: fd },
    );
  },
  docUrl(docId: string) {
    return `/api/doc/${docId}`;
  },
  async listCerts(ip: string, adminPassword: string) {
    return req<{ certs: CertInfo[] }>("/api/certs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, admin_password: adminPassword, pin: "" }),
    });
  },
  async sign(payload: {
    doc_id: string;
    rect: Rect;
    cert_id: string;
    agent: { ip: string; admin_password: string; pin: string };
    reason: string;
    location: string;
    signer_name: string;
    filename?: string;
    customer_id?: number | null;
    doc_type?: string;
    order_id?: number | null;
  }) {
    return req<{
      doc_id: string;
      signed: boolean;
      download_url: string;
      document_id: number | null;
    }>(
      "/api/sign",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },
  async verify(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{
      doc_id: string;
      signature_count: number;
      signatures: SignatureReport[];
    }>("/api/verify", { method: "POST", body: fd });
  },

  // --- Khach hang ---
  async listCustomers() {
    return req<Customer[]>("/api/customers");
  },
  async createCustomer(body: {
    name: string;
    tax_code?: string;
    contact?: string;
    note?: string;
    account_username?: string;
    account_password?: string;
  }) {
    return req<Customer>("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async updateCustomer(id: number, body: Partial<Customer>) {
    return req<Customer>(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async deleteCustomer(id: number) {
    return req(`/api/customers/${id}`, { method: "DELETE" });
  },
  async mergeCustomers(source_id: number, target_id: number) {
    return req<{ target: Customer; moved: Record<string, number> }>(
      "/api/customers/merge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id, target_id }),
      }
    );
  },
  async createAccount(id: number, username: string, password: string) {
    return req<{ ok: boolean; username: string }>(`/api/customers/${id}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  },
  async createAccountAuto(id: number) {
    return req<{ ok: boolean; username: string; password: string; login_url: string }>(
      `/api/customers/${id}/account-auto`, { method: "POST" },
    );
  },
  async createCustomerLoginLink(id: number, days = 7) {
    return req<{ url: string; expires_at: string; username: string }>(
      `/api/customers/${id}/login-link?days=${days}`, { method: "POST" },
    );
  },

  // --- Ho so ---
  async listDocuments(
    opts: {
      customerId?: number;
      unassigned?: boolean;
      orderId?: number;
      search?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const p = new URLSearchParams();
    if (opts.unassigned) p.set("unassigned", "true");
    if (opts.customerId != null) p.set("customer_id", String(opts.customerId));
    if (opts.orderId != null) p.set("order_id", String(opts.orderId));
    if (opts.search) p.set("search", opts.search);
    p.set("page", String(opts.page ?? 1));
    p.set("per_page", String(opts.perPage ?? 20));
    return req<{ items: DocRecord[]; total: number; page: number; per_page: number }>(
      `/api/documents?${p.toString()}`,
    );
  },
  async myDocuments() {
    return req<DocRecord[]>("/api/my/documents");
  },
  async myInvoices(opts: { from?: string; to?: string; q?: string } = {}) {
    const p = new URLSearchParams();
    if (opts.from) p.set("tu", opts.from);
    if (opts.to) p.set("den", opts.to);
    if (opts.q) p.set("q", opts.q);
    return req<CustomerInvoice[]>(`/api/my/invoices?${p.toString()}`);
  },
  myInvoiceFileUrl(id: number, kind: "pdf" | "xml") {
    return `/api/my/invoices/${id}/${kind}`;
  },
  myPortalZipUrl(from = "", to = "") {
    const p = new URLSearchParams();
    if (from) p.set("tu", from);
    if (to) p.set("den", to);
    return `/api/my/download.zip?${p.toString()}`;
  },
  async assignDocument(docPk: number, customerId: number | null) {
    return req<DocRecord>(`/api/documents/${docPk}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    });
  },
  async renameDocument(docPk: number, filename: string) {
    return req<DocRecord>(`/api/documents/${docPk}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
  },
  async deleteDocument(docPk: number) {
    return req(`/api/documents/${docPk}`, { method: "DELETE" });
  },
  async bulkAssign(ids: number[], customerId: number | null) {
    return req<{ ok: boolean; count: number }>("/api/documents/bulk-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, customer_id: customerId }),
    });
  },
  async bulkDelete(ids: number[]) {
    return req<{ ok: boolean; count: number }>("/api/documents/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  },
  async createShare(docPk: number, days: number, includeAccount: boolean) {
    return req<{
      token: string;
      url: string;
      filename: string;
      expires_at: string;
      account: { username: string; password: string } | null;
    }>(`/api/documents/${docPk}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days, include_account: includeAccount }),
    });
  },
  async verifyDocument(docPk: number) {
    return req<{
      doc_id: string;
      signature_count: number;
      signatures: SignatureReport[];
    }>(`/api/documents/${docPk}/verify`);
  },

  // --- Logo chu ky ---
  logoUrl() {
    return `/api/logo?t=${Date.now()}`;
  },
  async uploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ ok: boolean }>("/api/logo", { method: "POST", body: fd });
  },
  async resetLogo() {
    return req<{ ok: boolean }>("/api/logo", { method: "DELETE" });
  },

  // --- NAS ---
  async nasStatus() {
    return req<{
      enabled: boolean;
      host: string;
      share: string;
      total: number;
      synced: number;
      pending: number;
      last_error: string;
    }>("/api/nas/status");
  },
  async nasTest() {
    return req<{ ok: boolean; message: string }>("/api/nas/test", { method: "POST" });
  },
  async nasDisk() {
    return req<{
      ok: boolean;
      message?: string;
      total_gb?: number;
      used_gb?: number;
      free_gb?: number;
      percent_used?: number;
    }>("/api/nas/disk");
  },
  async getAppSettings() {
    return req<AppSettings>("/api/settings");
  },
  async saveAppSettings(body: Record<string, unknown>) {
    return req<{ ok: boolean }>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async telegramStatus() {
    return req<{
      enabled: boolean;
      bot_username: string;
      connected: boolean;
      username: string;
      display_name: string;
      connected_at: string | null;
    }>("/api/telegram/status");
  },
  async telegramConnect() {
    return req<{ ok: boolean; url: string; expires_at: string }>("/api/telegram/connect", {
      method: "POST",
    });
  },
  async telegramDisconnect() {
    return req<{ ok: boolean }>("/api/telegram/connection", { method: "DELETE" });
  },
  async aiTest(prompt = "") {
    return req<{ ok: boolean; message: string; reply: string }>("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  },
  async taxCaptcha() {
    return req<{ key: string; svg: string }>("/api/tax/captcha");
  },
  async taxSession() {
    return req<{ valid: boolean }>("/api/tax/session");
  },
  async taxGetCredentials() {
    return req<{ mst: string; has_password: boolean }>("/api/tax/credentials");
  },
  async taxPolicy(date = "") {
    return req<TaxPolicy>(`/api/tax/policy${date ? `?date_value=${encodeURIComponent(date)}` : ""}`);
  },
  async taxSaveCredentials(body: { mst: string; password: string }) {
    return req<{ ok: boolean }>("/api/tax/save-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async taxSync(body: {
    mst: string;
    password: string;
    ckey: string;
    cvalue: string;
    tu: string;
    den: string;
    do_import?: boolean;
  }) {
    return req<TaxSyncResult>("/api/tax/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async taxReviewUpload(file: File, ky: string, note: string) {
    const fd = new FormData();
    fd.append("file", file);
    const qs = new URLSearchParams({ ky, note }).toString();
    return req<{ id: number; findings: TaxFinding[]; summary: TaxReviewSummary }>(
      `/api/tax/review/upload?${qs}`,
      { method: "POST", body: fd },
    );
  },
  async taxReviewList(ky = "") {
    return req<TaxReviewItem[]>(`/api/tax/review?ky=${encodeURIComponent(ky)}`);
  },
  async taxReviewDetail(id: number) {
    return req<{
      id: number;
      ky: string;
      ten_file: string;
      note: string;
      findings: TaxFinding[];
      summary: TaxReviewSummary;
      grids: TaxGrid[];
    }>(`/api/tax/review/${id}`);
  },
  taxReviewFileUrl(id: number) {
    return `/api/tax/review/${id}/file`;
  },
  async taxReviewDelete(id: number) {
    return req<{ ok: boolean }>(`/api/tax/review/${id}`, { method: "DELETE" });
  },
  async operationsDashboard() {
    return req<OperationsDashboard>("/api/operations/dashboard");
  },
  async attachPurchasePdf(id: number, file: File) {
    const fd = new FormData(); fd.append("file", file);
    return req<{ ok: boolean; state: string }>(`/api/inv/purchase/${id}/attach-pdf`, { method: "POST", body: fd });
  },
  async taxSyncRuns() {
    return req<JobRun[]>("/api/jobs/tax-sync");
  },
  async runTaxSyncJob(range?: { tu: string; den: string }) {
    return req<JobRun>("/api/jobs/tax-sync/run", {
      method: "POST",
      ...(range ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(range),
      } : {}),
    });
  },
  async taxReports() {
    return req<TaxReport[]>("/api/tax/reports");
  },
  async generateTaxReport(ky: string) {
    return req<TaxReport>(`/api/tax/reports/${encodeURIComponent(ky)}/generate`, { method: "POST" });
  },
  async lockTaxReport(id: number) {
    return req<TaxReport>(`/api/tax/reports/${id}/lock`, { method: "POST" });
  },
  taxReportFileUrl(id: number) {
    return `/api/tax/reports/${id}/xlsx`;
  },
  async compareTaxReport(reportId: number, reviewId: number) {
    return req<{ differences: { indicator: string; crm: number; accountant: number; difference: number; match: boolean }[] }>(
      `/api/tax/reports/${reportId}/compare/${reviewId}`,
    );
  },
  async nasSyncAll() {
    return req<{ ok: boolean; synced: number; failed: number }>("/api/nas/sync-all", {
      method: "POST",
    });
  },
  async nasBrowse(path: string) {
    return req<{
      path: string;
      entries: { name: string; is_dir: boolean; size: number }[];
    }>(`/api/nas/browse?path=${encodeURIComponent(path)}`);
  },
  nasFileUrl(path: string, inline: boolean) {
    return `/api/nas/file?path=${encodeURIComponent(path)}${inline ? "&inline=true" : ""}`;
  },

  // --- Mat khau / users ---
  async changeMyPassword(oldPassword: string, newPassword: string) {
    return req<{ ok: boolean }>("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
  },
  async listUsers() {
    return req<
      { id: number; username: string; role: string; customer_name: string | null; training_access: boolean }[]
    >("/api/users");
  },
  async setTrainingAccess(uid: number, enabled: boolean) {
    return req<{ ok: boolean; training_access: boolean }>(`/api/users/${uid}/training-access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  },
  async adminResetPassword(uid: number, newPassword: string) {
    return req<{ ok: boolean; username: string }>(`/api/users/${uid}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  // --- Hóa đơn -> BBBG ---
  async parseInvoice(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{
      buyer: { name: string; mst: string; address: string; email?: string; phone?: string };
      items: {
        stt: number;
        ten: string;
        dvt: string;
        so_luong: string;
        don_gia?: string;
        thanh_tien?: string;
        thue_suat?: string;
      }[];
      ngay: { day: number; month: number; year: number } | null;
      ky_hieu: string;
      raw_text: string;
      source?: string;
      suggested_customer: { id: number; name: string } | null;
      products_learned?: number;
    }>("/api/invoice/parse", { method: "POST", body: fd });
  },
  async bbbgTemplates() {
    return req<{ templates: { key: string; label: string }[] }>("/api/bbbg/templates");
  },
  async bbbgGenerate(body: unknown) {
    return req<{ doc_id: string; filename: string; customer_id: number | null }>("/api/bbbg/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  // --- Báo giá / Đề nghị thanh toán ---
  async parseInvoiceDoc(docPk: number) {
    return req<{
      buyer: { name: string; mst: string; address: string; email?: string; phone?: string };
      items: {
        stt: number;
        ten: string;
        dvt: string;
        so_luong: string;
        don_gia?: string;
        thanh_tien?: string;
      }[];
      ngay: { day: number; month: number; year: number } | null;
      suggested_customer: { id: number; name: string } | null;
    }>(`/api/invoice/parse-doc/${docPk}`, { method: "POST" });
  },
  async quoteTemplates() {
    return req<{ templates: { key: string; label: string }[] }>("/api/quote/templates");
  },
  async pymidCatalog(documentDate?: string) {
    const query = documentDate ? `?document_date=${encodeURIComponent(documentDate)}` : "";
    return req<PymidCatalog>(`/api/pymid/catalog${query}`);
  },
  async pymidOrders() {
    return req<PymidOrder[]>("/api/pymid/orders");
  },
  async pymidStaff() {
    return req<PymidStaffAccount[]>("/api/pymid/staff");
  },
  async pymidCreateStaff(body: { username: string; display_name: string; password: string }) {
    return req<PymidStaffAccount>("/api/pymid/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async pymidCreateOrder(body: { level: number; document_date: string; customer_reference: string; note: string; items: { product_id: number; quantity: number }[] }) {
    return req<PymidOrder>("/api/pymid/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  },
  async pymidUpdateOrder(id: number, body: { level: number; document_date: string; customer_reference: string; note: string; items: { product_id: number; quantity: number }[] }) {
    return req<PymidOrder>(`/api/pymid/orders/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  },
  async pymidSubmitOrder(id: number) {
    return req<PymidOrder>(`/api/pymid/orders/${id}/submit`, { method: "POST" });
  },
  async pymidApproveOrder(id: number) {
    return req<PymidOrder>(`/api/pymid/orders/${id}/approve`, { method: "POST" });
  },
  pymidOrderXlsxUrl(id: number) {
    return `/api/pymid/orders/${id}/xlsx`;
  },
  pymidCatalogXlsxUrl(documentDate: string) {
    return `/api/pymid/catalog.xlsx?document_date=${encodeURIComponent(documentDate)}`;
  },
  // --- Đơn hàng (gom bộ hồ sơ) ---
  async listOrders(opts: { customerId?: number; search?: string } = {}) {
    const p = new URLSearchParams();
    if (opts.customerId != null) p.set("customer_id", String(opts.customerId));
    if (opts.search) p.set("search", opts.search);
    return req<OrderRec[]>(`/api/orders?${p.toString()}`);
  },
  async createOrder(body: { name: string; customer_id?: number | null; note?: string }) {
    return req<OrderRec>("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async deleteOrder(id: number) {
    return req(`/api/orders/${id}`, { method: "DELETE" });
  },
  async setDocumentOrder(docPk: number, orderId: number | null) {
    return req<DocRecord>(`/api/documents/${docPk}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId }),
    });
  },

  async listProducts(search = "") {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    return req<
      { id: number; ten: string; dvt: string; don_gia: number; thue_suat: number; use_count: number }[]
    >(`/api/products?${p.toString()}`);
  },
  async deleteProduct(id: number) {
    return req(`/api/products/${id}`, { method: "DELETE" });
  },
  async quotePreview(body: unknown): Promise<Blob> {
    const res = await fetch("/api/quote/preview", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `Lỗi ${res.status}`;
      try {
        msg = (await res.json()).detail || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.blob();
  },
  async quoteGenerate(body: unknown) {
    return req<{
      doc_id: string;
      filename: string;
      customer_id: number | null;
      doc_type: string;
      totals: {
        tong_truoc_thue: number;
        tong_thue: number;
        tong_thanh_toan: number;
        con_lai: number;
      };
    }>("/api/quote/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async aiStatus() {
    return req<{ enabled: boolean; model: string }>("/api/ai/status");
  },
  async aiQuoteNarrative(body: {
    items: { ten: string; dvt: string; so_luong: number; don_gia: number; thue_suat: number }[];
    khach: string;
    tong: number;
    note: string;
    loai: string;
  }) {
    return req<{ text: string }>("/api/ai/quote-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async contractDefaults() {
    return req<{
      ben_a: Record<string, string>;
      dieu_khoan: string;
      bank: { account_name: string; account_number: string; bank_name: string };
      baotoan: { name: string; mst: string; address: string; email: string };
    }>("/api/contract/defaults");
  },
  async contractDrafts(customerId?: number) {
    const q = customerId ? `?customer_id=${customerId}` : "";
    return req<ContractDraft[]>(`/api/contract/drafts${q}`);
  },
  async saveContractDraft(body: { customer_id: number; title: string; payload: unknown }, draftId?: number) {
    return req<ContractDraft>(draftId ? `/api/contract/drafts/${draftId}` : "/api/contract/drafts", {
      method: draftId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async deleteContractDraft(draftId: number) {
    return req<{ ok: boolean }>(`/api/contract/drafts/${draftId}`, { method: "DELETE" });
  },
  async contractPreview(body: unknown): Promise<Blob> {
    const res = await fetch("/api/contract/preview", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Lỗi ${res.status}`);
    }
    return res.blob();
  },
  async contractGenerate(body: unknown) {
    return req<{
      doc_id: string; document_id: number; filename: string; customer_id: number;
      is_draft: boolean; share_url: string; login_url: string; username: string;
      temporary_password: string; share_expires_at: string; login_expires_at: string;
      session_finalized: boolean; session_version: number | null;
    }>("/api/contract/generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  async aiContractDraft(body: { ben_b_name: string; dieu_khoan_hien_tai: string; yeu_cau: string }) {
    return req<{ text: string }>("/api/ai/contract-draft", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  async setDocType(docPk: number, docType: string) {
    return req<DocRecord>(`/api/documents/${docPk}/type`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_type: docType }),
    });
  },
  async uploadSigned(docPk: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<DocRecord>(`/api/documents/${docPk}/upload-signed`, {
      method: "POST",
      body: fd,
    });
  },
  signedFileUrl(docPk: number, inline: boolean) {
    return `/api/documents/${docPk}/signed-file${inline ? "?inline=true" : ""}`;
  },

  // --- Nhật ký thao tác ---
  async auditLog(
    opts: {
      search?: string;
      action?: string;
      tsFrom?: string;
      tsTo?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const p = new URLSearchParams();
    if (opts.search) p.set("search", opts.search);
    if (opts.action) p.set("action", opts.action);
    if (opts.tsFrom) p.set("ts_from", opts.tsFrom);
    if (opts.tsTo) p.set("ts_to", opts.tsTo);
    p.set("page", String(opts.page ?? 1));
    p.set("per_page", String(opts.perPage ?? 50));
    return req<{
      items: {
        id: number;
        ts: string;
        username: string;
        role: string;
        ip: string;
        action: string;
        action_label: string;
        target: string;
        detail: string;
      }[];
      total: number;
      page: number;
      per_page: number;
    }>(`/api/audit?${p.toString()}`);
  },

  // --- Ton kho ---
  async invWarehouses() {
    return req<InvWarehouse[]>("/api/inv/warehouses");
  },
  async invItems(q = "") {
    return req<InvItem[]>(`/api/inv/items?q=${encodeURIComponent(q)}`);
  },
  async invCreateItem(body: { ma_hang: string; ten: string; dvt?: string }) {
    return req<InvItem>("/api/inv/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invUpdateItem(
    id: number,
    body: { ten?: string; dvt?: string; note?: string; active?: boolean },
  ) {
    return req<InvItem>(`/api/inv/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invMergeItems(sourceId: number, targetId: number) {
    return req<InvItem>(`/api/inv/items/merge?source_id=${sourceId}&target_id=${targetId}`, {
      method: "POST",
    });
  },
  async invStock(opts: { warehouseId?: number; date?: string; allItems?: boolean } = {}) {
    const p = new URLSearchParams();
    if (opts.warehouseId) p.set("warehouse_id", String(opts.warehouseId));
    if (opts.date) p.set("date", opts.date);
    if (opts.allItems) p.set("all_items", "true");
    return req<StockReport>(`/api/inv/stock?${p.toString()}`);
  },
  async invAvailability(date: string, warehouseId?: number) {
    const p = new URLSearchParams({ date });
    if (warehouseId) p.set("warehouse_id", String(warehouseId));
    return req<StockReport>(`/api/inv/availability?${p.toString()}`);
  },
  async invStockCard(itemId: number, warehouseId: number) {
    return req<StockCardRow[]>(
      `/api/inv/items/${itemId}/card?warehouse_id=${warehouseId}`,
    );
  },
  async invItemFlow(itemId: number) {
    return req<ItemFlow>(`/api/inv/items/${itemId}/flow`);
  },
  async invOpeningImport(file: File, dryRun: boolean) {
    const fd = new FormData();
    fd.append("file", file);
    return req<OpeningImportResult>(
      `/api/inv/opening/import?dry_run=${dryRun}`,
      { method: "POST", body: fd },
    );
  },
  async invPurchaseUpload(files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return req<{ results: { filename: string; ok: boolean; purchase_id?: number; error?: string; dup_of?: number | null }[] }>(
      "/api/inv/purchase/upload",
      { method: "POST", body: fd },
    );
  },
  async invPurchaseImportUrl(url: string) {
    return req<{ results: { filename: string; ok: boolean; purchase_id?: number; error?: string; dup_of?: number | null }[] }>(
      "/api/inv/purchase/import-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      },
    );
  },
  async invPurchaseBangKe(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<BangKeResult>("/api/inv/purchase/bang-ke", { method: "POST", body: fd });
  },
  async invSuggestItemCode() {
    return req<{ code: string }>("/api/inv/items/suggest-code");
  },
  async invPurchases(statusF = "", filters: { tu?: string; den?: string; vat?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    if (filters.vat != null && filters.vat !== "") p.set("vat", filters.vat);
    return req<InvPurchase[]>(`/api/inv/purchase?${p.toString()}`);
  },
  async invPurchase(id: number) {
    return req<InvPurchase>(`/api/inv/purchase/${id}`);
  },
  async invPurchaseSyncNas() {
    return req<{ ok: boolean; synced: number; skipped: number; failed: number }>(
      "/api/inv/purchase/sync-nas",
      { method: "POST" },
    );
  },
  async invPurchaseSave(id: number, body: unknown) {
    return req<InvPurchase>(`/api/inv/purchase/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invPurchaseRecalcTotals(id: number) {
    return req<InvPurchase>(`/api/inv/purchase/${id}/recalc-totals`, { method: "POST" });
  },
  async invPurchaseCreate(body: unknown) {
    return req<InvPurchase>("/api/inv/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invPurchasePost(id: number) {
    return req<InvPurchase>(`/api/inv/purchase/${id}/post`, { method: "POST" });
  },
  async invPurchaseVoid(id: number) {
    return req<InvPurchase>(`/api/inv/purchase/${id}/void`, { method: "POST" });
  },
  async invPurchaseDelete(id: number) {
    return req(`/api/inv/purchase/${id}`, { method: "DELETE" });
  },
  async invPurchaseBulkDelete(ids: number[]) {
    return req<{ deleted: number; skipped: number }>("/api/inv/purchase/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  },
  async invPurchaseBulkPost(ids: number[]) {
    return req<{ results: { id: number; ok: boolean; ten?: string; error?: string }[]; ok: number; total: number }>(
      "/api/inv/purchase/bulk-post",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) },
    );
  },
  // --- Dong bo hoa don PDF/XML tu Zoho Mail (IMAP) ---
  async emailSyncSettings() {
    return req<EmailSyncSettings>("/api/inv/email-sync/settings");
  },
  async emailSyncSaveSettings(body: Partial<EmailSyncSettings> & { password?: string; client_secret?: string; refresh_token?: string; grant_token?: string }) {
    return req<EmailSyncSettings>("/api/inv/email-sync/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async emailSyncTest(body: {
    mode?: string;
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
    grant_token?: string;
    accounts_url?: string;
    mail_api_url?: string;
    server?: string;
    port?: number;
    username?: string;
    password?: string;
    mailbox?: string;
  }) {
    return req<EmailSyncTestResult>("/api/inv/email-sync/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async emailSyncRun(days = 30) {
    return req<EmailSyncJobRun>("/api/inv/email-sync/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
  },
  async emailSyncRuns() {
    return req<EmailSyncJobRun[]>("/api/inv/email-sync/runs");
  },
  // --- Hoa don BAN RA ---
  async invSaleUpload(files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return req<{ results: { filename: string; ok: boolean; sale_id?: number; error?: string; dup_of?: number | null; is_dieu_chinh?: boolean }[] }>(
      "/api/inv/sale/upload",
      { method: "POST", body: fd },
    );
  },
  async invSaleImportUrl(url: string) {
    return req<{ results: { filename: string; ok: boolean; sale_id?: number; error?: string; dup_of?: number | null }[] }>(
      "/api/inv/sale/import-url",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) },
    );
  },
  async invSaleSyncIhoadon() {
    return req<{ imported: number; skipped: number; errors: number; details: string[]; sync_status: string; from_date: string }>(
      "/api/inv/sale/sync-ihoadon", { method: "POST" },
    );
  },
  async invSales(statusF = "", filters: { tu?: string; den?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvSale[]>(`/api/inv/sale?${p.toString()}`);
  },
  async invSaleSummary(statusF = "", filters: { tu?: string; den?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvSaleSummary>(`/api/inv/sale/summary?${p.toString()}`);
  },
  // Xuat Excel bang ke iHoadon tu danh sach dong da soan (tai file ve may)
  async invSaleDraftExportXlsx(lines: SaleDraftLine[]) {
    const res = await fetch("/api/inv/sale-draft/export-xlsx", {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    if (!res.ok) {
      let msg = `Lỗi ${res.status}`;
      try {
        msg = _detailToMessage((await res.json()).detail) ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bang-ke-hoa-don.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  async ihoadonDashboard() {
    return req<IhoadonDashboard>("/api/inv/ihoadon/dashboard");
  },
  async ihoadonCustomerSync() {
    return req<{ ok: boolean }>("/api/ihoadon/customer-sync", { method: "POST" });
  },
  async ihoadonCustomerSyncStatus() {
    return req<{
      job: null | { id: number; status: string; stats: Record<string, number>; error: string; started_at: string; finished_at: string };
      total: number;
      unmatched: number;
    }>("/api/ihoadon/customer-sync/status");
  },
  async ihoadonUnmatched() {
    return req<CustomerInvoice[]>("/api/ihoadon/customer-invoices/unmatched");
  },
  async ihoadonAssignCustomer(invoiceId: number, customerId: number | null) {
    return req<CustomerInvoice>(`/api/ihoadon/customer-invoices/${invoiceId}/assign`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    });
  },
  async ihoadonDrafts() {
    return req<{ items: IhoadonDraft[]; total: number }>("/api/inv/ihoadon/drafts");
  },
  async ihoadonCreateDraft(body: IhoadonDraftCreate) {
    return req<{ id: string; other_id: string; status: string; template_code: string; invoice_series: string; web_url: string }>(
      "/api/inv/ihoadon/drafts",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
  },
  async ihoadonCreateDraftDelivery(body: IhoadonDraftDelivery) {
    return req<IhoadonDraftDeliveryResult>("/api/inv/ihoadon/drafts/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async ihoadonSyncDraftToCrm(invoiceId: string) {
    return req<IhoadonDraftSyncResult>(
      `/api/inv/ihoadon/drafts/${encodeURIComponent(invoiceId)}/sync-to-crm`,
      { method: "POST" },
    );
  },
  async invSaleDraftSuggestStart(mo_ta: string, context = "") {
    return req<{ job_id: string }>("/api/inv/sale-draft/suggest-lines/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mo_ta, context }),
    });
  },
  async invSaleDraftSuggestJob(jobId: string) {
    return req<{
      status: string;
      result?: { lines: SuggestedInvoiceLine[]; note: string };
      error?: string;
    }>(`/api/inv/sale-draft/suggest-lines-job/${jobId}`);
  },
  async invSale(id: number) {
    return req<InvSale>(`/api/inv/sale/${id}`);
  },
  async invSaleSave(id: number, body: unknown) {
    return req<InvSale>(`/api/inv/sale/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invSaleDelete(id: number) {
    return req(`/api/inv/sale/${id}`, { method: "DELETE" });
  },
  async invSaleBulkDelete(ids: number[]) {
    return req<{ deleted: number; skipped: number }>("/api/inv/sale/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  },
  async invSaleGenerate(id: number) {
    return req<{ issues: number[]; productions: number[]; warnings: string[] }>(
      `/api/inv/sale/${id}/generate`,
      { method: "POST" },
    );
  },
  async invSaleRematch(sid: number, lineId: number) {
    return req<{
      changed: boolean;
      item_id: number | null;
      ma_hang?: string;
      ten?: string;
      match_kind: string;
      warehouse_id?: number | null;
      suggestions?: { item_id: number; ma_hang: string; ten: string; score: number }[];
    }>(`/api/inv/sale/${sid}/rematch/${lineId}`, { method: "POST" });
  },
  async invSaleSuggestBom(
    sid: number,
    lineId: number,
    context = "",
    existing: { ten: string; so_luong: number; dvt?: string }[] = [],
  ) {
    return req<SuggestBomResult>(`/api/inv/sale/${sid}/suggest-bom/${lineId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, existing }),
    });
  },
  // AI cham (>60s) co the bi proxy cat 504 -> chay job nen + tham do ket qua
  async invSaleSuggestBomStart(
    sid: number,
    lineId: number,
    context = "",
    existing: { ten: string; so_luong: number; dvt?: string }[] = [],
  ) {
    return req<{ job_id: string }>(`/api/inv/sale/${sid}/suggest-bom/${lineId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, existing }),
    });
  },
  async invSaleSuggestBomJob(jobId: string) {
    return req<{ status: "running" | "done" | "error"; result?: SuggestBomResult; error?: string }>(
      `/api/inv/suggest-bom-job/${jobId}`,
    );
  },
  async invItemCost(itemId: number, ngay = "") {
    return req<{
      dvt: string; don_gia_bq: number; thue_suat_est: number; ton_hien_tai: number; kha_dung_tai_ngay: number;
      warehouse_id: number | null;
    }>(`/api/inv/items/${itemId}/cost?ngay=${encodeURIComponent(ngay)}`);
  },
  async invSaleAssemble(
    sid: number,
    lineId: number,
    body: {
      output_item_id?: number | null;
      output_ma_hang?: string;
      output_warehouse_id: number;
      components: { item_id: number; warehouse_id: number; so_luong: number; note?: string }[];
      save_recipe?: boolean;
      recipe_name?: string;
    },
  ) {
    return req<{ production_id: number; output_item_id: number; recipe_id: number | null; warnings: string[] }>(
      `/api/inv/sale/${sid}/assemble/${lineId}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
  },
  async invIssues(statusF = "", filters: { tu?: string; den?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvIssue[]>(`/api/inv/issues?${p.toString()}`);
  },
  async invIssueCreate(body: unknown) {
    return req<InvIssue>("/api/inv/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invIssueSave(id: number, body: unknown) {
    return req<InvIssue>(`/api/inv/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invIssuePost(id: number, overrideReason?: string) {
    return req<InvIssue>(`/api/inv/issues/${id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override_reason: overrideReason ?? null }),
    });
  },
  async invIssueVoid(id: number) {
    return req<InvIssue>(`/api/inv/issues/${id}/void`, { method: "POST" });
  },
  async invIssueDelete(id: number) {
    return req(`/api/inv/issues/${id}`, { method: "DELETE" });
  },
  async invProductions(statusF = "", filters: { tu?: string; den?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvProduction[]>(`/api/inv/productions?${p.toString()}`);
  },
  async invProductionCreate(body: unknown) {
    return req<InvProduction>("/api/inv/productions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invProductionSave(id: number, body: unknown) {
    return req<InvProduction>(`/api/inv/productions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invProductionPost(id: number, overrideReason?: string) {
    return req<InvProduction>(`/api/inv/productions/${id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override_reason: overrideReason ?? null }),
    });
  },
  async invProductionVoid(id: number) {
    return req<InvProduction>(`/api/inv/productions/${id}/void`, { method: "POST" });
  },
  async invProductionDelete(id: number) {
    return req(`/api/inv/productions/${id}`, { method: "DELETE" });
  },
  async invRecipes() {
    return req<InvRecipe[]>("/api/inv/recipes");
  },
  async invRecipeCreate(body: unknown) {
    return req<InvRecipe>("/api/inv/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invRecipeUpdate(id: number, body: unknown) {
    return req<InvRecipe>(`/api/inv/recipes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invRecipeDelete(id: number) {
    return req(`/api/inv/recipes/${id}`, { method: "DELETE" });
  },
  async invRecipeDescribe(id: number) {
    return req<InvRecipe>(`/api/inv/recipes/${id}/describe`, { method: "POST" });
  },
  async invProductionDescribe(id: number) {
    return req<InvProduction>(`/api/inv/productions/${id}/describe`, { method: "POST" });
  },
  async invDescribeBom(body: {
    output_ten: string;
    output_dvt?: string;
    output_qty?: number;
    lines: { ten: string; so_luong: number; dvt: string }[];
  }) {
    return req<{ description: string }>("/api/inv/describe-bom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invProductionCheckShortage(payload: ShortageCheckIn) {
    return req<ShortageCheckOut>("/api/inv/productions/check-shortage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async invProductionReadiness(id: number) {
    return req<ShortageCheckOut>(`/api/inv/productions/${id}/readiness`);
  },
  async invTraceability(params: {
    batch_no?: string;
    serial_no?: string;
    item_id?: number;
    production_id?: number;
    tu?: string;
    den?: string;
  } = {}) {
    const p = new URLSearchParams();
    if (params.batch_no) p.set("batch_no", params.batch_no);
    if (params.serial_no) p.set("serial_no", params.serial_no);
    if (params.item_id != null) p.set("item_id", String(params.item_id));
    if (params.production_id != null) p.set("production_id", String(params.production_id));
    if (params.tu) p.set("tu", params.tu);
    if (params.den) p.set("den", params.den);
    const qs = p.toString();
    return req<TraceabilityResponseOut>(`/api/inv/traceability${qs ? `?${qs}` : ""}`);
  },
  // --- To khai nhap khau (customs) ---
  async invCustomsList(filters: { statusF?: string; tu?: string; den?: string } = {}) {
    const p = new URLSearchParams();
    if (filters.statusF) p.set("status_f", filters.statusF);
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvCustomsDecl[]>(`/api/inv/customs?${p.toString()}`);
  },
  async invCustomsGet(id: number) {
    return req<InvCustomsDecl>(`/api/inv/customs/${id}`);
  },
  async invCustomsUpload(files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return req<{
      results: { filename: string; ok: boolean; customs_id?: number; so_to_khai?: string; error?: string }[];
    }>("/api/inv/customs/upload", { method: "POST", body: fd });
  },
  async invCustomsSave(id: number, body: unknown) {
    return req<InvCustomsDecl>(`/api/inv/customs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async invCustomsPost(id: number) {
    return req<InvCustomsDecl>(`/api/inv/customs/${id}/post`, { method: "POST" });
  },
  async invCustomsVoid(id: number) {
    return req<InvCustomsDecl>(`/api/inv/customs/${id}/void`, { method: "POST" });
  },
  async invCustomsDelete(id: number) {
    return req(`/api/inv/customs/${id}`, { method: "DELETE" });
  },
  async invCustomsAttach(id: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ decl: InvCustomsDecl; parse_info: CustomsParseInfo }>(
      `/api/inv/customs/${id}/attach`,
      { method: "POST", body: fd },
    );
  },
  async customsDriveSources() {
    return req<CustomsDriveSource[]>("/api/inv/customs-drive/sources");
  },
  async customsDriveSaveSource(body: { year: number; folder_id: string }) {
    return req<CustomsDriveSource>("/api/inv/customs-drive/sources", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  async customsDriveSync(year: number) {
    return req<{ job_id: number; status: string; stats: Record<string, number | string> }>(
      `/api/inv/customs-drive/sync/${year}`, { method: "POST" },
    );
  },
  async customsDriveFolders(year?: number) {
    return req<CustomsDriveFolder[]>(`/api/inv/customs-drive/folders${year ? `?year=${year}` : ""}`);
  },
  async customsDriveAssign(folderId: number, customsId: number) {
    return req<CustomsDriveFolder>(`/api/inv/customs-drive/folders/${folderId}/assign`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customs_id: customsId }),
    });
  },
  async customsDriveReview(folderId: number) {
    return req<CustomsDriveFolder>(`/api/inv/customs-drive/folders/${folderId}/review`, { method: "POST" });
  },
  async customsDriveSetDocumentKind(documentId: number, kind: string) {
    return req<CustomsDriveFolder>(`/api/inv/customs-drive/documents/${documentId}/kind`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
    });
  },
  invCustomsFileUrl(id: number) {
    return `/api/inv/customs/${id}/file`;
  },
  invCustomsCostFileUrl(costId: number) {
    return `/api/inv/customs/costs/${costId}/file`;
  },
  async invRecalcCost() {
    return req<{ ok: boolean; pairs: number }>("/api/inv/recalc-cost", { method: "POST" });
  },
  async invHangingValue() {
    return req<{ rows: HangingValueRow[] }>("/api/inv/hanging-value");
  },
  // URL tai ZIP/Excel hang loat (FE mo bang window.open, cookie session tu gui kem)
  invExportUrl(
    kind: "purchase" | "sale" | "issues" | "productions",
    fmt: "zip" | "xlsx",
    params: { tu?: string; den?: string; status_f?: string; ids?: string } = {},
  ) {
    const p = new URLSearchParams();
    if (params.tu) p.set("tu", params.tu);
    if (params.den) p.set("den", params.den);
    if (params.status_f) p.set("status_f", params.status_f);
    if (params.ids) p.set("ids", params.ids);
    return `/api/inv/${kind}/export-${fmt}?${p.toString()}`;
  },
  payrollEmployees() { return req<PayrollEmployee[]>("/api/payroll/employees"); },
  payrollCreateEmployee(body: Omit<PayrollEmployee, "id" | "active">) {
    return req<PayrollEmployee>("/api/payroll/employees", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  payrollPeriods() { return req<PayrollPeriod[]>("/api/payroll/periods"); },
  payrollCreatePeriod(month: string) {
    return req<PayrollPeriod>("/api/payroll/periods", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }),
    });
  },
  payrollUpdateLine(periodId: number, lineId: number, body: Record<string, unknown>) {
    return req<PayrollPeriod>(`/api/payroll/periods/${periodId}/lines/${lineId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  payrollReview(periodId: number) {
    return req<PayrollPeriod>(`/api/payroll/periods/${periodId}/review`, { method: "POST" });
  },
  payrollLock(periodId: number) {
    return req<PayrollPeriod>(`/api/payroll/periods/${periodId}/lock`, { method: "POST" });
  },
  payrollSyncDrive() {
    return req<{ job_id: number; status: string }>("/api/payroll/sync-drive", { method: "POST" });
  },
  payrollSyncStatus() {
    return req<{ job: null | { id: number; status: string; error: string; started_at: string;
      finished_at: string; stats: { progress?: number; phase?: string; message?: string;
        files?: string[]; imported?: number; summaries?: { filename: string; findings: number; error?: string }[] } } }>("/api/payroll/sync-drive/status");
  },
  payrollImports() { return req<PayrollImportItem[]>("/api/payroll/imports"); },
  payrollImportDetail(id: number) { return req<PayrollImportDetail>(`/api/payroll/imports/${id}`); },
  payrollLatestDraft(importId: number) {
    return req<{ draft: PayrollWorkbookDraft | null }>(`/api/payroll/imports/${importId}/draft`);
  },
  payrollNetTarget(importId: number, body: { row: number; target_net: number; allow_taxable_bonus: boolean }) {
    return req<PayrollNetTargetPlan>(`/api/payroll/imports/${importId}/net-target`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  payrollSaveDraft(importId: number, changes: PayrollWorkbookChange[]) {
    return req<PayrollWorkbookDraft>(`/api/payroll/imports/${importId}/draft`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }),
    });
  },
  payrollReviewDraft(id: number) {
    return req<PayrollWorkbookDraft>(`/api/payroll/drafts/${id}/review`, { method: "POST" });
  },
  payrollUploadDraft(id: number) {
    return req<PayrollWorkbookDraft>(`/api/payroll/drafts/${id}/upload-drive`, { method: "POST" });
  },
  payrollHrSummary(year: number) {
    return req<PayrollHrSummary>(`/api/payroll/hr-summary?year=${year}`);
  },
  payrollForecast(year: number, growthRate = 0) {
    return req<PayrollForecast>(`/api/payroll/forecast?year=${year}&growth_rate=${growthRate}`);
  },
  payrollCreatePayment(body: { employee_id: number; month: string; amount: number;
    status: "prepared" | "completed"; paid_at?: string; bank_name?: string;
    transaction_ref?: string; note?: string }) {
    return req<PayrollPayment>("/api/payroll/payments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  },
  payrollUploadPaymentEvidence(id: number, file: File) {
    const body = new FormData(); body.append("file", file);
    return req<PayrollPayment>(`/api/payroll/payments/${id}/evidence`, { method: "POST", body });
  },
  payrollPaymentEvidenceUrl(id: number) { return `/api/payroll/payments/${id}/evidence`; },
  payrollCancelPayment(id: number, reason: string) {
    return req<PayrollPayment>(`/api/payroll/payments/${id}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },
  payrollExportUrl(periodId: number) { return `/api/payroll/periods/${periodId}/export`; },
};

// --- Kieu du lieu ton kho ---
export interface InvWarehouse {
  id: number;
  code: string;
  name: string;
}

export interface InvItem {
  id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  note: string;
  active: boolean;
  product_id: number | null;
}

// --- To khai nhap khau (customs) ---
export interface InvCustomsLine {
  id: number;
  stt: number;
  ma_hs: string;
  mo_ta: string;
  so_luong: number;
  dvt: string;
  don_gia_nt: number;
  tri_gia_nt: number;
  tri_gia_tinh_thue: number;
  thue_suat_nk: number;
  tien_thue_nk: number;
  thue_suat_vat: number;
  tien_thue_vat: number;
  item_id: number | null;
  item_ma_hang: string;
  item_ten: string;
  warehouse_id: number | null;
  warehouse_code: string;
  match_kind: string;
  gia_von: number;
  suggestions: { item_id: number; ma_hang: string; ten: string; dvt: string; score?: number; reason?: string }[];
}

export interface InvCustomsCost {
  id: number;
  loai: string;
  ten: string;
  so_tien: number;
  ghi_chu: string;
  doc_url: string;
}

export interface InvCustomsDecl {
  id: number;
  so_to_khai: string;
  ngay_dang_ky: string;
  ma_loai_hinh: string;
  phan_luong: string;
  co_quan_hq: string;
  nguoi_xk: string;
  nuoc_xk: string;
  so_van_don: string;
  so_hoa_don: string;
  ngay_hoa_don: string;
  phuong_thuc_tt: string;
  incoterm: string;
  nguyen_te: string;
  tri_gia_nt: number;
  phi_ship_nt: number;
  ti_gia: number;
  tri_gia_tinh_thue: number;
  tong_thue_nk: number;
  tong_thue_vat: number;
  status: string;
  note: string;
  created_at: string;
  doc_url: string;
  tong_costs: number;
  lines: InvCustomsLine[];
  costs: InvCustomsCost[];
}

export interface CustomsDriveDocument {
  id: number; name: string; path: string; kind: string; mime_type: string;
  size: number; parse_error: string; file_url: string; kind_manual?: boolean;
}

export interface CustomsDriveFolder {
  id: number; year: number; drive_folder_id: string; name: string; path: string;
  drive_url: string; customs_id: number | null; link_status: string;
  dossier_status: string; match_reason: string;
  checklist: Record<string, { state: string }>;
  findings: { level: string; code: string; message: string }[];
  synced_at: string; documents: CustomsDriveDocument[];
}

export interface CustomsDriveSource {
  id: number; year: number; folder_id: string; enabled: boolean; last_synced_at: string;
}

export interface CustomsKhoanNop {
  noi_dung: string;
  so_tien: number;
  ma_chuong: string;
  ma_ndkt: string;
  phan_loai: string;
}

export interface CustomsMt103 {
  ngay: string;
  nguyen_te: string;
  so_tien_nt: number;
  remittance: string;
  beneficiary: string;
}

export type CustomsParseInfo =
  | { kind: "giay_nop_tien"; khoan_nop: CustomsKhoanNop[]; vat_paid: CustomsKhoanNop[] }
  | { kind: "mt103"; mt103: CustomsMt103 };

export interface StockRow {
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  warehouse_code: string;
  ton: number;
  don_gia_bq: number;
  gia_tri: number;
  kha_dung: number | null;
  nhap_cuoi: string;
}

export interface StockReport {
  rows: StockRow[];
  tong_gia_tri: number;
  ngay: string | null;
}

export interface StockCardRow {
  id: number;
  ngay: string;
  loai: string;
  loai_label: string;
  nhap: number;
  xuat: number;
  don_gia: number;
  gia_tri: number;
  ton: number;
  ton_gia_tri: number;
  ref_type: string;
  ref_id: number | null;
  lot_number?: string;
  serial_numbers?: string;
}

export interface ItemFlowDoc {
  kind: string;
  id: number | null;
  label: string;
  status: string;
}

export interface ItemFlowStep {
  ngay: string;
  loai: string;
  loai_label: string;
  warehouse_code: string;
  so_luong: number;
  gia_tri: number;
  so_du: number;
  doc: ItemFlowDoc | null;
  flow_to: { ma_hang: string; ten: string; so_luong: number }[] | null;
}

export interface ItemFlowStuck {
  kind: string;
  id: number;
  label: string;
  ngay: string;
  so_luong: number;
  warehouse_code: string;
}

export interface ItemFlow {
  item: { id: number; ma_hang: string; ten: string; dvt: string };
  ton: { warehouse_code: string; ton: number; gia_tri: number }[];
  steps: ItemFlowStep[];
  stuck: ItemFlowStuck[];
}

export interface OpeningImportResult {
  dry_run: boolean;
  tong: { so_ma: number; so_dong: number; so_ma_ton: number; tong_sl: number; tong_gia_tri: number };
  warnings: { code: string; msg: string }[];
  preview: { ma_hang: string; ten: string; dvt: string; kho: string; so_luong: number; gia_tri: number; don_gia: number }[];
  applied: { items_new: number; items_total: number; moves: number } | null;
}

export interface BangKeRow {
  so_hd: string;
  ngay: string;
  ten_ban: string;
  gia_tri: number;
  purchase_id?: number;
  purchase_gia_tri?: number;
}

export interface BangKeResult {
  khop: BangKeRow[];
  lech_tien: BangKeRow[];
  thieu_file: BangKeRow[];
  ngoai_bang_ke: BangKeRow[];
}

export interface InvPurchaseLine {
  id: number;
  stt: number;
  ten_raw: string;
  dvt: string;
  so_luong: number;
  don_gia: number;
  thanh_tien: number;
  thue_suat: number;
  item_id: number | null;
  item_ma_hang: string;
  item_ten: string;
  warehouse_id: number | null;
  match_kind: string;
  confidence: number;
  warnings: { code: string; msg: string }[];
  suggestions: { item_id: number; ma_hang: string; ten: string; dvt: string; score?: number; reason?: string }[];
}

export interface InvPurchase {
  id: number;
  so_hd: string;
  ky_hieu: string;
  mst_ban: string;
  ten_ban: string;
  ngay: string;
  tong_truoc_thue: number;
  tong_thue: number;
  tong_tien: number;
  source: string;
  status: string;
  loai: string; // hang_hoa | dich_vu
  confidence: number;
  warnings: { code: string; msg: string }[];
  dup_of: number | null;
  created_at: string;
  doc_url: string;
  lines: InvPurchaseLine[];
}

export interface InvSaleLine {
  id: number;
  stt: number;
  ten_raw: string;
  dvt: string;
  so_luong: number;
  don_gia_ban: number;
  thanh_tien: number;
  thue_suat: number;
  thue_kct: boolean;
  item_id: number | null;
  item_ma_hang: string;
  item_ten: string;
  warehouse_id: number | null;
  match_kind: string;
  line_class: string; // inut | camera | phan_mem | other
  fulfil_kind: string; // ton | sx | doanh_thu | none
  confidence: number;
  warnings: { code: string; msg: string }[];
  suggestions: { item_id: number; ma_hang: string; ten: string; dvt: string; score?: number; reason?: string }[];
  ton_hien_co: number;
  kha_dung_tai_ngay: number;
  de_xuat: string;
  warn_am_kho: boolean;
  lech_dong: boolean;
}

export interface InvSale {
  id: number;
  so_hd: string;
  ky_hieu: string;
  mst_mua: string;
  ten_mua: string;
  customer_id: number | null;
  ngay: string;
  tong_truoc_thue: number;
  tong_thue: number;
  tong_tien: number;
  source: string;
  status: string; // draft | reviewed | void
  is_dieu_chinh: boolean;
  dc_ref: string;
  confidence: number;
  warnings: { code: string; msg: string }[];
  dup_of: number | null;
  created_at: string;
  doc_url: string;
  lines: InvSaleLine[];
  fulfil_status: string; // du | mot_phan | chua | na
  fulfil_note: string[];
  ln_truoc_nc: number | null;
  nhan_cong_uoc: number;
  ln_sau_nc: number | null;
  ln_uoc: boolean;
}

export interface TaxSyncResult {
  mua_cong: number;
  mua_he_thong: number;
  ban_cong: number;
  ban_he_thong: number;
  missing_mua: {
    ngay: string;
    so_hd: number | string;
    ky_hieu: string;
    ten_ban: string;
    mst_ban: string;
    tong_tien: number;
    co_ma: boolean;
  }[];
  missing_ban: {
    ngay: string;
    so_hd: number | string;
    ky_hieu: string;
    ten_mua: string;
    tong_tien: number;
  }[];
  mismatch_mua?: {
    ngay: string;
    so_hd: number | string;
    ky_hieu: string;
    ten_ban: string;
    mst_ban: string;
    tien_he_thong: number;
    tien_cong_thue: number;
    lech: number;
  }[];
  orphan_mua?: {
    ngay: string;
    so_hd: number | string;
    ten_ban: string;
    mst_ban: string;
    tong_tien: number;
    source: string;
    status: string;
  }[];
  orphan_ban?: {
    ngay: string;
    so_hd: number | string;
    ky_hieu: string;
    ten_mua: string;
    tong_tien: number;
    status: string;
  }[];
  import?: { imported: number; skipped: number; errors: number };
}

export interface AppSettings {
  ai_enabled: boolean;
  ai_base_url: string;
  ai_api_key_set: boolean;
  ai_model: string;
  ai_max_tokens: number;
  ai_timeout: number;
  training_rate_limit_per_minute: number;
  training_rate_window_seconds: number;
  public_training_rate_limit: number;
  public_training_rate_window_seconds: number;
  nas_enabled: boolean;
  nas_host: string;
  nas_share: string;
  nas_user: string;
  nas_password_set: boolean;
  nas_base_path: string;
  nas_timeout: number;
  ihoadon_enabled: boolean;
  ihoadon_base_url: string;
  ihoadon_tax_code: string;
  ihoadon_username: string;
  ihoadon_password_set: boolean;
  ihoadon_timeout: number;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password_set: boolean;
  smtp_from: string;
  smtp_to: string;
}

export interface JobRun {
  id: number;
  kind: string;
  status: "running" | "success" | "failed" | "needs_action";
  period_from: string;
  period_to: string;
  stats: Record<string, unknown>;
  error: string;
  needs_action: boolean;
  started_at: string;
  finished_at: string | null;
}

export interface TaxReport {
  id: number;
  ky: string;
  tu: string;
  den: string;
  version: number;
  status: "draft" | "locked";
  snapshot: Record<string, number>;
  warnings: { level: string; message: string; invoice_id?: number }[];
  created_by: string;
  updated_at: string;
}

export interface OperationsDashboard {
  purchases: number;
  purchase_drafts: number;
  sales: number;
  sale_drafts: number;
  documents: { missing: number; renderable: number; source_only: number; ready: number };
  document_queue: {
    kind: "purchase" | "sale";
    id: number;
    state: "missing" | "renderable" | "source_only";
    ngay: string;
    so_hd: string;
    partner: string;
    status: string;
  }[];
  latest_sync: JobRun | null;
  latest_report: TaxReport | null;
}

export interface IhoadonDashboard {
  connected: boolean;
  account_name: string;
  tax_code: string;
  total: number;
  draft: number;
  issued: number;
  waiting: number;
  web_url: string;
}

export interface IhoadonDraft {
  id: string;
  other_id: string | null;
  customer_name: string;
  buyer_tax_code: string;
  total_payment: number;
  created_at: string;
  template_code: string;
  invoice_series: string;
  status: string;
}

export interface IhoadonDraftCreate {
  customer_name: string;
  buyer_tax_code: string;
  buyer_name: string;
  buyer_email: string;
  buyer_address: string;
  payment_method_name: string;
  note: string;
  lines: SaleDraftLine[];
}

export interface IhoadonDraftDelivery extends IhoadonDraftCreate {
  expected_issue_date: string;
  share_days: number;
}

export interface IhoadonDraftDeliveryResult {
  draft_id: string;
  status: string;
  template_code: string;
  invoice_series: string;
  document_id: number;
  customer_id: number | null;
  share_token: string;
  share_url: string;
  share_expires_at: string;
  zip_url: string;
  zip_filename: string;
  web_url: string;
  stock_warnings: string[];
}

export interface IhoadonDraftSyncResult {
  document_id: number;
  customer_id: number;
  share_url: string;
  synced_at: string;
  checks: Record<"customer_name" | "buyer_tax_code" | "buyer_address" | "total_payment_in_word", boolean>;
}

export interface SaleDraftLine {
  ma_hang: string;
  ten: string;
  dvt: string;
  so_luong: number;
  don_gia: number;
  thanh_tien: number;
  vat_name: string;
  tien_thue?: number | null;
  is_dich_vu: boolean;
}

export interface SuggestedInvoiceLine {
  ten: string;
  so_luong: number;
  dvt: string;
  don_gia: number;
  ly_do: string;
  match?: { item_id: number; ma_hang: string; ten: string; dvt: string; kind: string };
}

export interface InvSaleSummary {
  so_hd_count: number;
  dt_phan_mem: number;
  dt_hang_hoa: number;
  doanh_thu_truoc_thue: number;
  ln_truoc_nc: number;
  ln_sau_nc: number;
  ti_suat_ln: number;
  co_uoc_tinh: boolean;
}

export interface InvIssueLine {
  id: number;
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  warehouse_code: string;
  so_luong: number;
  don_gia_ban: number;
  thanh_tien_ban: number;
  gia_von: number;
  gia_von_uoc: number;
  don_gia_von_uoc: number;
}

// Muc dich xuat kho -> dinh khoan goi y (dong bo backend inventory.DINH_KHOAN_XUAT)
export type MucDichXuat = "ban" | "san_xuat" | "noi_bo" | "dieu_chuyen" | "huy";
export const MUC_DICH_XUAT: Record<MucDichXuat, { label: string; no: string; co: string }> = {
  ban: { label: "Bán hàng", no: "632", co: "156" },
  san_xuat: { label: "Xuất cho sản xuất", no: "621", co: "152" },
  noi_bo: { label: "Sử dụng nội bộ", no: "642", co: "152" },
  dieu_chuyen: { label: "Điều chuyển kho", no: "156", co: "156" },
  huy: { label: "Xuất huỷ/thanh lý", no: "811", co: "152" },
};

export interface InvIssue {
  id: number;
  so_ct: string;
  ngay: string;
  customer_id: number | null;
  customer_name: string;
  muc_dich: MucDichXuat;
  ly_do: string;
  nguoi_nhan: string;
  bo_phan: string;
  tk_no: string;
  tk_co: string;
  tong_gia_von: number;
  tong_gia_von_uoc: number;
  note: string;
  status: string;
  created_at: string;
  lines: InvIssueLine[];
}

export interface InvProductionLine {
  id: number;
  chieu: string;
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  so_luong: number;
  don_gia_tam: number;
  gia_tri: number;
  gia_tri_uoc: number;
  so_luong_dinh_muc: number | null;
  gia_tri_dinh_muc: number | null;
  lot_number?: string;
  serial_numbers?: string;
  note: string;
  orig_item_id: number | null;
}

export interface InvProduction {
  id: number;
  so_ct: string;
  ngay: string;
  note: string;
  description: string;
  status: string;
  recipe_id: number | null;
  cp_nhan_cong: number;
  cp_sxc: number;
  tong_gia_thanh: number;
  tong_gia_thanh_uoc: number;
  gia_thanh_dv_uoc: number;
  gia_ban_du_kien: number;
  sale_id: number | null;
  lot_number?: string;
  serial_numbers?: string;
  mfg_date?: string;
  exp_date?: string;
  am_kho_override?: boolean;
  created_at: string;
  lines: InvProductionLine[];
}

export interface ShortageCheckLineIn {
  item_id: number;
  so_luong: number;
  warehouse_id?: number;
}

export interface ShortageCheckIn {
  recipe_id?: number;
  output_item_id?: number;
  output_qty?: number;
  warehouse_id?: number;
  ngay?: string;
  lines?: ShortageCheckLineIn[];
}

export interface ShortageItemOut {
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  warehouse_code: string;
  required_qty: number;
  available_qty: number;
  shortage_qty: number;
  is_shortage: boolean;
  warning_level: string; // "ok" | "amber" | "red"
}

export interface ShortageCheckOut {
  has_shortage: boolean;
  can_produce: boolean;
  items: ShortageItemOut[];
}

export interface TraceabilityOutputItemOut {
  id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  qty: number;
  warehouse_id: number;
  warehouse_code: string;
}

export interface TraceabilityConsumedMaterialOut {
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  so_luong: number;
  lot_number: string;
  batch_no: string;
  serial_numbers: string[];
  warehouse_id: number;
  warehouse_code: string;
}

export interface TraceabilityRecordOut {
  production_id: number;
  so_ct: string;
  ngay: string;
  status: string;
  batch_no: string;
  lot_number: string;
  serial_numbers: string[];
  mfg_date: string;
  exp_date: string;
  output_item: TraceabilityOutputItemOut | null;
  consumed_materials: TraceabilityConsumedMaterialOut[];
}

export interface TraceabilityResponseOut {
  records: TraceabilityRecordOut[];
}

export interface InvRecipe {
  id: number;
  name: string;
  output_item_id: number;
  output_ten: string;
  output_qty: number;
  description: string;
  tong_gia_tri: number;
  gia_thanh_dv: number;
  thieu_gia: boolean;
  lines: {
    item_id: number;
    ma_hang: string;
    ten: string;
    dvt: string;
    warehouse_id: number;
    so_luong: number;
    don_gia_bq?: number;
    gia_tri?: number;
  }[];
}

export interface HangingValueRow {
  item_id: number;
  ma_hang: string;
  ten: string;
  warehouse_code: string;
  ton: number;
  gia_tri: number;
}

export interface SuggestBomResult {
  components: {
    ten: string;
    so_luong: number;
    ly_do: string;
    match: {
      item_id: number; ma_hang: string; ten: string; dvt: string; score: number;
      warehouse_id: number | null;
    } | null;
    dvt: string;
    don_gia_bq: number;
    thue_suat_est: number;
    kha_dung_tai_ngay: number;
  }[];
  cost_est: number | null;
  margin_est: number | null;
  note: string;
  totals: {
    cost_pretax: number;
    cost_with_tax: number;
    unmatched_count: number;
    suggested_price_low: number;
    suggested_price_high: number;
    actual_gia_ban: number;
    actual_margin_pct: number | null;
  };
}

export interface PymidCatalogItem {
  id: number; code: string; name: string; unit: string; source_price: number;
  category: "hardware" | "software"; level: number | null; valid_from: string;
  net_price: number; tax_amount: number; gross_price: number;
  vat_rate: number | null; vat_label: string; tax_treatment: "taxable" | "exempt";
}

export interface PymidCatalog {
  policy: { code: string; vat_rate: number; label: string; valid_to: string };
  items: PymidCatalogItem[];
}

export interface PymidStaffAccount {
  id: number;
  username: string;
  display_name: string;
  role: "pymid_staff";
}

export interface PymidOrderLine {
  name: string; unit: string; quantity: number; tax_treatment: "taxable" | "exempt";
  vat_rate: number | null; vat_label: string; net_amount: number; tax_amount: number; gross_amount: number;
}

export interface PymidOrderItem extends PymidCatalogItem {
  product_id: number;
  quantity: number;
  net_amount: number;
  tax_amount: number;
  gross_amount: number;
}

export interface PymidOrder {
  id: number; customer_id: number; level: number; status: string; document_date: string;
  customer_reference: string; note: string; policy_code: string; items: PymidOrderItem[];
  invoice_lines: PymidOrderLine[]; total_net: number; total_tax: number; total_gross: number;
  created_at: string; updated_at: string;
}

export interface EmailSyncSettings {
  enabled: boolean;
  mode: "rest_api" | "imap";
  // REST API OAuth
  client_id: string;
  has_client_secret: boolean;
  has_refresh_token: boolean;
  accounts_url: string;
  mail_api_url: string;
  // IMAP
  server: string;
  port: number;
  username: string;
  has_password: boolean;
  mailbox: string;
  days: number;
}

export interface EmailSyncTestResult {
  ok: boolean;
  message: string;
  mailbox?: string;
  total_emails?: number;
  account_name?: string;
  account_id?: string;
  refresh_token?: string;
}

export interface EmailSyncJobRun {
  id: number;
  kind: string;
  status: "running" | "success" | "needs_action" | "failed";
  started_at: string | null;
  finished_at: string | null;
  needs_action: boolean;
  error: string;
  stats: {
    emails_scanned?: number;
    attachments_found?: number;
    pdf_attached_to_existing?: number;
    created_new_draft?: number;
    skipped_existing?: number;
    errors?: number;
    details?: string[];
  };
}

// SPX Express Logistics Integration
export interface SpxSettings {
  spx_username: string;
  spx_password: string;
  spx_shop_id: string;
  spx_api_token: string;
  spx_cookies: string;
  spx_sender_name: string;
  spx_sender_phone: string;
  spx_sender_address: string;
  spx_sender_province: string;
  spx_sender_district: string;
  spx_sender_ward: string;
}

export interface SpxOrder {
  id: number;
  tracking_no: string;
  order_code: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  province: string;
  district: string;
  ward: string;
  cod_amount: number;
  weight_gram: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  item_description: string;
  note: string;
  payer: string;
  status: "ready_to_ship" | "picking" | "delivering" | "delivered" | "cancelled";
  shipping_fee: number;
  label_doc_id: string;
  sender_name: string;
  sender_phone: string;
  sender_address: string;
  is_printed: boolean;
  printed_at: string;
  created_at: string;
  updated_at: string;
}

export interface SpxOrderCreatePayload {
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  province?: string;
  district?: string;
  ward?: string;
  cod_amount?: number;
  weight_gram?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  item_description?: string;
  note?: string;
  payer?: string;
  order_code?: string;
  sender_name?: string;
  sender_phone?: string;
  sender_address?: string;
}

export interface SpxOrderListResponse {
  items: SpxOrder[];
  total: number;
  unprinted_count?: number;
  printed_count?: number;
}

export interface SpxStatsResponse {
  total: number;
  unprinted: number;
  printed: number;
}

export async function fetchSpxSettings(): Promise<SpxSettings> {
  const res = await fetch("/api/spx/settings", { credentials: "include" });
  if (!res.ok) throw new Error("Không thể tải cấu hình SPX Express");
  return res.json();
}

export async function saveSpxSettings(payload: Partial<SpxSettings>): Promise<SpxSettings> {
  const res = await fetch("/api/spx/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi lưu cấu hình" }));
    throw new Error(err.detail || "Không thể lưu cấu hình SPX Express");
  }
  return res.json();
}

export async function testSpxConnection(payload: {
  username?: string;
  password?: string;
  shop_id?: string;
  api_token?: string;
  cookies?: string;
}): Promise<{ success: boolean; message: string; user_info?: any }> {
  const res = await fetch("/api/spx/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function fetchSpxStats(): Promise<SpxStatsResponse> {
  const res = await fetch("/api/spx/stats", { credentials: "include" });
  if (!res.ok) return { total: 0, unprinted: 0, printed: 0 };
  return res.json();
}

export async function quickPrintSpxOrder(payload: {
  tracking_no: string;
  printer_name?: string;
  host?: string;
  print_remote?: boolean;
}): Promise<{ success: boolean; message: string; tracking_no: string; is_printed: boolean; printed_at: string }> {
  const res = await fetch("/api/spx/quick-print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi in nhanh" }));
    throw new Error(err.detail || "Không thể thực hiện in nhanh đơn SPX");
  }
  return res.json();
}

export async function syncSpxOrders(payload: {
  raw_text?: string;
  from_date?: string;
  to_date?: string;
}): Promise<{ success: boolean; message: string; total_synced: number; tracking_numbers: string[] }> {
  const res = await fetch("/api/spx/sync-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi đồng bộ" }));
    throw new Error(err.detail || "Không thể đồng bộ danh sách đơn SPX");
  }
  return res.json();
}

export async function batchPrintSpxOrders(payload: {
  tracking_numbers?: string[];
  from_date?: string;
  to_date?: string;
  printer_name?: string;
  host?: string;
}): Promise<{ success: boolean; message: string; total_printed: number; tracking_numbers: string[]; errors?: string[] }> {
  const res = await fetch("/api/spx/batch-print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi in hàng loạt" }));
    throw new Error(err.detail || "Không thể in hàng loạt đơn SPX");
  }
  return res.json();
}

export async function markSpxOrderPrinted(trackingNo: string, isPrinted: boolean = true): Promise<SpxOrder> {
  const endpoint = isPrinted ? "mark-printed" : "mark-unprinted";
  const res = await fetch(`/api/spx/orders/${encodeURIComponent(trackingNo)}/${endpoint}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Không thể cập nhật trạng thái in");
  return res.json();
}

export async function createSpxOrder(payload: SpxOrderCreatePayload): Promise<SpxOrder> {
  const res = await fetch("/api/spx/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi tạo vận đơn" }));
    throw new Error(err.detail || "Không thể tạo vận đơn SPX");
  }
  return res.json();
}

export async function fetchSpxOrders(params?: {
  status?: string;
  is_printed?: boolean;
  from_date?: string;
  to_date?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<SpxOrderListResponse> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.is_printed !== undefined) q.set("is_printed", String(params.is_printed));
  if (params?.from_date) q.set("from_date", params.from_date);
  if (params?.to_date) q.set("to_date", params.to_date);
  if (params?.search) q.set("search", params.search);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));

  const res = await fetch(`/api/spx/orders?${q.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("Không thể tải danh sách vận đơn SPX");
  return res.json();
}

export async function getSpxOrder(trackingNo: string): Promise<SpxOrder> {
  const res = await fetch(`/api/spx/orders/${encodeURIComponent(trackingNo)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Không thể tải thông tin vận đơn");
  return res.json();
}

export async function cancelSpxOrder(trackingNo: string): Promise<SpxOrder> {
  const res = await fetch(`/api/spx/orders/${encodeURIComponent(trackingNo)}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi hủy đơn" }));
    throw new Error(err.detail || "Không thể hủy vận đơn");
  }
  return res.json();
}

export function getSpxOrderLabelUrl(trackingNo: string): string {
  return `/api/spx/orders/${encodeURIComponent(trackingNo)}/label`;
}

export interface RemotePrinter {
  name: string;
  driver: string;
  port: string;
  is_thermal?: boolean;
}

export async function listRemotePrinters(host = "192.168.1.10"): Promise<RemotePrinter[]> {
  const res = await fetch(`/api/spx/printers?host=${encodeURIComponent(host)}`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

export async function printSpxOrderRemote(
  trackingNo: string,
  host = "192.168.1.10",
  printerName = "TP732H"
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `/api/spx/orders/${encodeURIComponent(trackingNo)}/print-remote?host=${encodeURIComponent(host)}&printer_name=${encodeURIComponent(printerName)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Lỗi in từ xa" }));
    throw new Error(err.detail || "Không thể gửi lệnh in tới máy in");
  }
  return res.json();
}
