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
}

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
  async listDocuments(opts: { customerId?: number; unassigned?: boolean } = {}) {
    const p = new URLSearchParams();
    if (opts.unassigned) p.set("unassigned", "true");
    if (opts.customerId != null) p.set("customer_id", String(opts.customerId));
    return req<DocRecord[]>(`/api/documents?${p.toString()}`);
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
};
