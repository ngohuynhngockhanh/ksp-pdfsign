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
};
