// Client goi backend. Cookie phien duoc gui tu dong (credentials: include).

export interface CertInfo {
  id: string;
  subject: string;
  issuer: string;
  serial: string;
  valid_from: string;
  valid_to: string;
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
  note: string;
  created_at: string;
  document_count: number;
  account_usernames: string[];
  aliases: string[];
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

async function req<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
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
      customer_id: number | null;
      customer_name: string | null;
      agent_default_ip: string;
      default_location: string;
      using_default_secrets: boolean;
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
      { id: number; username: string; role: string; customer_name: string | null }[]
    >("/api/users");
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
  async invPurchaseSave(id: number, body: unknown) {
    return req<InvPurchase>(`/api/inv/purchase/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
  async invSales(statusF = "", filters: { tu?: string; den?: string } = {}) {
    const p = new URLSearchParams({ status_f: statusF });
    if (filters.tu) p.set("tu", filters.tu);
    if (filters.den) p.set("den", filters.den);
    return req<InvSale[]>(`/api/inv/sale?${p.toString()}`);
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
  async invSaleSuggestBom(
    sid: number,
    lineId: number,
    context = "",
    existing: { ten: string; so_luong: number; dvt?: string }[] = [],
  ) {
    return req<{
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
    }>(`/api/inv/sale/${sid}/suggest-bom/${lineId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, existing }),
    });
  },
  async invItemCost(itemId: number, ngay = "") {
    return req<{
      dvt: string; don_gia_bq: number; thue_suat_est: number; kha_dung_tai_ngay: number;
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
  async invIssuePost(id: number) {
    return req<InvIssue>(`/api/inv/issues/${id}/post`, { method: "POST" });
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
  async invProductionPost(id: number) {
    return req<InvProduction>(`/api/inv/productions/${id}/post`, { method: "POST" });
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
  created_at: string;
  lines: InvProductionLine[];
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
