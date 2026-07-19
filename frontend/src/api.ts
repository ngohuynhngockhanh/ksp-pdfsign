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
}

export const DOC_TYPES: Record<string, string> = {
  "": "Chưa phân loại",
  bbbg: "Biên bản bàn giao",
  hop_dong: "Hợp đồng",
  bao_gia: "Báo giá",
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
  }) {
    return req<{ doc_id: string; signed: boolean; download_url: string }>(
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
      search?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const p = new URLSearchParams();
    if (opts.unassigned) p.set("unassigned", "true");
    if (opts.customerId != null) p.set("customer_id", String(opts.customerId));
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
      items: { stt: number; ten: string; dvt: string; so_luong: string }[];
      ngay: { day: number; month: number; year: number } | null;
      ky_hieu: string;
      raw_text: string;
      source?: string;
      suggested_customer: { id: number; name: string } | null;
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
  async setDocType(docPk: number, docType: string) {
    return req<DocRecord>(`/api/documents/${docPk}/type`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_type: docType }),
    });
  },
};
