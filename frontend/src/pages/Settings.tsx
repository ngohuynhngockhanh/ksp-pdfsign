import { useEffect, useState } from "react";
import {
  api,
  AppSettings,
  EmailSyncSettings,
  SpxSettings,
  fetchSpxSettings,
  saveSpxSettings,
  testSpxConnection,
  type Customer,
  type CustomerInvoice,
} from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

type SettingIconName = "settings" | "ai" | "nas" | "invoice" | "mail" | "spx";

function SettingIcon({ name }: { name: SettingIconName }) {
  const paths: Record<SettingIconName, React.ReactNode> = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    ai: <><path d="M9 3h6v3h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h3V3Z"/><path d="M8 12h.01M16 12h.01M8 16h8"/></>,
    nas: <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h7M11 16.5h7"/></>,
    invoice: <><path d="M6 3h9l3 3v15l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
    spx: <><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
  };
  return <svg className="setting-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}


export function Settings({
  usingDefaultSecrets = false,
  mustChangePassword = false,
  onChangePassword,
}: {
  usingDefaultSecrets?: boolean;
  mustChangePassword?: boolean;
  onChangePassword?: () => void;
}) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // secret nhap moi (de trong = giu nguyen)
  const [aiKey, setAiKey] = useState("");
  const [nasPass, setNasPass] = useState("");
  const [ihoadonPass, setIhoadonPass] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [aiTestMsg, setAiTestMsg] = useState("");
  const [aiPrompt, setAiPrompt] = useState("Trả lời đúng một từ: OK");
  const [aiReply, setAiReply] = useState("");
  const [nasTestMsg, setNasTestMsg] = useState("");
  const [ihoadonTestMsg, setIhoadonTestMsg] = useState("");
  const [syncStatus, setSyncStatus] = useState<Awaited<ReturnType<typeof api.ihoadonCustomerSyncStatus>> | null>(null);
  const [unmatched, setUnmatched] = useState<CustomerInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [disk, setDisk] = useState<Awaited<ReturnType<typeof api.nasDisk>> | null>(null);
  const [zohoSettings, setZohoSettings] = useState<EmailSyncSettings | null>(null);
  const [zohoClientSecret, setZohoClientSecret] = useState("");
  const [zohoGrantToken, setZohoGrantToken] = useState("");
  const [zohoRefreshToken, setZohoRefreshToken] = useState("");
  const [zohoPass, setZohoPass] = useState("");
  const [zohoTestMsg, setZohoTestMsg] = useState("");
  const [zohoSyncMsg, setZohoSyncMsg] = useState("");
  const [zohoBusy, setZohoBusy] = useState(false);

  // SPX Express Logistics State
  const [spxSettings, setSpxSettings] = useState<SpxSettings | null>(null);
  const [spxPass, setSpxPass] = useState("");
  const [spxApiToken, setSpxApiToken] = useState("");
  const [spxCookies, setSpxCookies] = useState("");
  const [spxTestMsg, setSpxTestMsg] = useState("");
  const [spxBusy, setSpxBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      const [settings, status, unmatchedRows, customerRows, zohoCfg, spxCfg] = await Promise.all([
        api.getAppSettings(),
        api.ihoadonCustomerSyncStatus(),
        api.ihoadonUnmatched(),
        api.listCustomers(),
        api.emailSyncSettings().catch(() => null),
        fetchSpxSettings().catch(() => null),
      ]);
      setS(settings);
      setSyncStatus(status);
      setUnmatched(unmatchedRows);
      setCustomers(customerRows);
      if (zohoCfg) setZohoSettings(zohoCfg);
      if (spxCfg) setSpxSettings(spxCfg);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function testSpx() {
    if (!spxSettings) return;
    setSpxBusy(true);
    setSpxTestMsg("");
    try {
      const res = await testSpxConnection({
        username: spxSettings.spx_username,
        password: spxPass || undefined,
        shop_id: spxSettings.spx_shop_id || undefined,
        api_token: spxApiToken || undefined,
        cookies: spxCookies || undefined,
      });
      setSpxTestMsg(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
    } catch (e: any) {
      setSpxTestMsg(`❌ ${e.message || "Lỗi kiểm tra kết nối SPX"}`);
    } finally {
      setSpxBusy(false);
    }
  }

  async function saveSpx() {
    if (!spxSettings) return;
    setSpxBusy(true);
    setSpxTestMsg("");
    try {
      const payload: Partial<SpxSettings> = {
        ...spxSettings,
      };
      if (spxPass) payload.spx_password = spxPass;
      if (spxApiToken) payload.spx_api_token = spxApiToken;
      if (spxCookies) payload.spx_cookies = spxCookies;
      const res = await saveSpxSettings(payload);
      setSpxSettings(res);
      setSpxPass("");
      setSpxApiToken("");
      setSpxCookies("");
      setSpxTestMsg("✅ Đã lưu cấu hình SPX Express an toàn.");
    } catch (e: any) {
      setSpxTestMsg(`❌ ${e.message || "Lỗi lưu cấu hình SPX"}`);
    } finally {
      setSpxBusy(false);
    }
  }



  async function testZoho() {
    if (!zohoSettings) return;
    setZohoBusy(true);
    setZohoTestMsg("");
    try {
      const res = await api.emailSyncTest({
        mode: zohoSettings.mode,
        client_id: zohoSettings.client_id,
        client_secret: zohoClientSecret || undefined,
        refresh_token: zohoRefreshToken || undefined,
        grant_token: zohoGrantToken || undefined,
        accounts_url: zohoSettings.accounts_url,
        mail_api_url: zohoSettings.mail_api_url,
        server: zohoSettings.server,
        port: zohoSettings.port,
        username: zohoSettings.username,
        password: zohoPass || undefined,
        mailbox: zohoSettings.mailbox,
      });
      setZohoTestMsg(res.ok ? `✅ ${res.message}` : `❌ ${res.message}`);
      if (res.refresh_token) {
        setZohoSettings((prev) => (prev ? { ...prev, has_refresh_token: true } : prev));
        setZohoGrantToken("");
      }
    } catch (e) {
      setZohoTestMsg(`❌ ${(e as Error).message}`);
    } finally {
      setZohoBusy(false);
    }
  }

  async function saveZoho() {
    if (!zohoSettings) return;
    setZohoBusy(true);
    try {
      const updated = await api.emailSyncSaveSettings({
        ...zohoSettings,
        client_secret: zohoClientSecret || undefined,
        refresh_token: zohoRefreshToken || undefined,
        grant_token: zohoGrantToken || undefined,
        password: zohoPass || undefined,
      });
      setZohoSettings(updated);
      setZohoClientSecret("");
      setZohoGrantToken("");
      setZohoPass("");
      setZohoTestMsg("✅ Đã lưu cấu hình Zoho Mail thành công.");
    } catch (e) {
      setZohoTestMsg(`❌ ${(e as Error).message}`);
    } finally {
      setZohoBusy(false);
    }
  }

  async function syncZoho() {
    setZohoBusy(true);
    setZohoSyncMsg("");
    try {
      const run = await api.emailSyncRun(zohoSettings?.days || 30);
      setZohoSyncMsg(
        `✅ Đã quét xong: ${run.stats?.attachments_found ?? 0} file tìm thấy, ${run.stats?.created_new_draft ?? 0} HĐ mới, ${run.stats?.pdf_attached_to_existing ?? 0} gắn PDF.`
      );
    } catch (e) {
      setZohoSyncMsg(`❌ ${(e as Error).message}`);
    } finally {
      setZohoBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (syncStatus?.job?.status !== "running") return;
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [syncStatus?.job?.status]);

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((c) => (c ? { ...c, [k]: v } : c));
  }

  async function save() {
    if (!s) return false;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        ai_enabled: s.ai_enabled,
        ai_base_url: s.ai_base_url,
        ai_model: s.ai_model,
        ai_max_tokens: s.ai_max_tokens,
        ai_timeout: s.ai_timeout,
        training_rate_limit_per_minute: s.training_rate_limit_per_minute,
        training_rate_window_seconds: s.training_rate_window_seconds,
        public_training_rate_limit: s.public_training_rate_limit,
        public_training_rate_window_seconds: s.public_training_rate_window_seconds,
        nas_enabled: s.nas_enabled,
        nas_host: s.nas_host,
        nas_share: s.nas_share,
        nas_user: s.nas_user,
        nas_base_path: s.nas_base_path,
        nas_timeout: s.nas_timeout,
        ihoadon_enabled: s.ihoadon_enabled,
        ihoadon_base_url: s.ihoadon_base_url,
        ihoadon_tax_code: s.ihoadon_tax_code,
        ihoadon_username: s.ihoadon_username,
        ihoadon_timeout: s.ihoadon_timeout,
        smtp_host: s.smtp_host,
        smtp_port: s.smtp_port,
        smtp_username: s.smtp_username,
        smtp_from: s.smtp_from,
        smtp_to: s.smtp_to,
      };
      if (aiKey.trim()) body.ai_api_key = aiKey.trim();
      if (nasPass.trim()) body.nas_password = nasPass.trim();
      if (ihoadonPass.trim()) body.ihoadon_password = ihoadonPass.trim();
      if (smtpPass.trim()) body.smtp_password = smtpPass.trim();
      await api.saveAppSettings(body);
      setMsg("✅ Đã lưu cấu hình (có hiệu lực ngay, không cần khởi động lại).");
      setAiKey("");
      setNasPass("");
      setIhoadonPass("");
      setSmtpPass("");
      await load();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testAi() {
    setAiTestMsg("⏳ Đang lưu cấu hình và gọi thử AI…");
    setAiReply("");
    try {
      if (!(await save())) return;
      const r = await api.aiTest(aiPrompt);
      setAiTestMsg((r.ok ? "✅ " : "❌ ") + r.message);
      setAiReply(r.reply || "");
    } catch (e) {
      setAiTestMsg("❌ " + (e as Error).message);
    }
  }
  async function testNas() {
    setNasTestMsg("⏳ Đang kiểm tra NAS…");
    try {
      const r = await api.nasTest();
      setNasTestMsg((r.ok ? "✅ " : "❌ ") + r.message);
    } catch (e) {
      setNasTestMsg("❌ " + (e as Error).message);
    }
  }
  async function loadDisk() {
    setDisk(null);
    try {
      setDisk(await api.nasDisk());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function testIhoadon() {
    setIhoadonTestMsg("Đang đăng nhập và đọc số lượng hóa đơn…");
    try {
      await save();
      const r = await api.ihoadonDashboard();
      setIhoadonTestMsg(`Kết nối thành công · ${r.total} hóa đơn · ${r.draft} bản nháp.`);
    } catch (e) {
      setIhoadonTestMsg(`Kết nối thất bại: ${(e as Error).message}`);
    }
  }

  async function syncIhoadon() {
    setIhoadonTestMsg("Đã yêu cầu đồng bộ; tiến trình đang chạy nền...");
    try {
      await api.ihoadonCustomerSync();
      window.setTimeout(load, 1500);
    } catch (e) {
      setIhoadonTestMsg((e as Error).message);
    }
  }

  async function assignInvoice(invoiceId: number, customerId: number) {
    if (!customerId) return;
    await api.ihoadonAssignCustomer(invoiceId, customerId);
    await load();
  }

  if (!s) return <div className="docs-page">{err ? <div className="error">{err}</div> : "Đang tải…"}</div>;

  return (
    <div className="docs-page settings-page">
      <header className="settings-hero">
        <div className="settings-hero-mark"><SettingIcon name="settings" /></div>
        <div>
          <span className="eyebrow">SYSTEM CONTROL</span>
          <h2>Cài đặt hệ thống</h2>
          <p>Quản lý các kết nối dịch vụ của CRM tại một nơi.</p>
        </div>
        <button className="settings-save-primary" disabled={busy} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu tất cả thay đổi"}
        </button>
      </header>
      {err && <div className="error">{err}</div>}
      {msg && <div className="settings-toast" role="status">{msg}</div>}

      {(usingDefaultSecrets || mustChangePassword) && <section className="settings-security-center" role="region" aria-label="Bảo mật tài khoản và khóa hệ thống">
        <div><span className="eyebrow">SECURITY ATTENTION</span><h3>Cần hoàn tất cấu hình bảo mật</h3><p>Cảnh báo được gom tại đây để không che các màn hình vận hành.</p></div>
        <div className="settings-security-items">
          {usingDefaultSecrets && <article><b>Mật khẩu/khóa mặc định</b><span>Đổi các secret mặc định trong <code>.env</code> trước khi đưa hệ thống ra môi trường thật.</span></article>}
          {mustChangePassword && <article><b>Mật khẩu tạm</b><span>Tài khoản hiện tại cần đặt mật khẩu riêng để kết thúc trạng thái khởi tạo.</span><button type="button" onClick={onChangePassword}>Đổi mật khẩu tài khoản</button></article>}
        </div>
      </section>}

      <div className="settings-grid">

      {/* ---- AI ---- */}
      <section className="panel setting-card setting-ai">
        <header className="setting-card-head"><span className="setting-card-icon"><SettingIcon name="ai" /></span><div><span className="setting-card-kicker">TRÍ TUỆ NHÂN TẠO</span><h3>AI Assistant</h3><p>9router hoặc endpoint tương thích OpenAI</p></div><span className={`setting-state ${s.ai_enabled ? "on" : "off"}`}>{s.ai_enabled ? "Đang bật" : "Đang tắt"}</span></header>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={s.ai_enabled}
            onChange={(e) => set("ai_enabled", e.target.checked)}
          />
          Bật AI (gợi ý BOM, gợi ý dòng hóa đơn…)
        </label>
        <label>
          Endpoint (base URL)
          <input
            style={{ width: "100%" }}
            value={s.ai_base_url}
            placeholder="http://127.0.0.1:20128/v1"
            onChange={(e) => set("ai_base_url", e.target.value)}
          />
        </label>
        <label>
          API key {s.ai_api_key_set && <span className="chip green sm">đã đặt</span>}
          <input
            style={{ width: "100%" }}
            type="password"
            value={aiKey}
            placeholder={s.ai_api_key_set ? "•••• (để trống = giữ nguyên)" : "nhập API key"}
            onChange={(e) => setAiKey(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Model
            <input value={s.ai_model} onChange={(e) => set("ai_model", e.target.value)} />
          </label>
          <label>
            Max tokens
            <input
              type="number"
              style={{ width: 100 }}
              value={s.ai_max_tokens}
              onChange={(e) => set("ai_max_tokens", Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Timeout (s)
            <input
              type="number"
              style={{ width: 90 }}
              value={s.ai_timeout}
              onChange={(e) => set("ai_timeout", Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <div className="ai-test-console">
          <div className="ai-test-samples"><span>Lệnh mẫu:</span>
            <button type="button" onClick={() => setAiPrompt("Trả lời đúng một từ: OK")}>Ping</button>
            <button type="button" onClick={() => setAiPrompt("Tóm tắt trong 3 gạch đầu dòng lợi ích của hệ thống CRM cho doanh nghiệp nhỏ.")}>Tóm tắt</button>
            <button type="button" onClick={() => setAiPrompt("Trả về đúng JSON hợp lệ gồm hai khóa: status là ok và model là tên model bạn đang chạy.")}>Test JSON</button>
          </div>
          <label>Prompt chạy thử<textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Nhập câu hỏi hoặc lệnh muốn thử với LLM…" /></label>
          <div className="ai-test-run"><button className="btn-sm" disabled={busy || !aiPrompt.trim()} onClick={testAi}>{busy ? "Đang gọi…" : "🧪 Lưu & chạy prompt"}</button>{aiTestMsg && <span className="muted">{aiTestMsg}</span>}</div>
          {aiReply && <pre className="ai-test-reply">{aiReply}</pre>}
        </div>
      </section>

      {/* ---- TRAINING ---- */}
      <section className="panel setting-card setting-ai">
        <header className="setting-card-head"><span className="setting-card-icon"><SettingIcon name="ai" /></span><div><span className="setting-card-kicker">HERMES TRAINING</span><h3>Giới hạn nhịp hỏi</h3><p>Cấu hình ngay trên KSP, không cần sửa code</p></div><span className="setting-state on">{s.training_rate_limit_per_minute}/{s.training_rate_window_seconds}s</span></header>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 180 }}>
            Training nội bộ + Messenger (lần)
            <input type="number" min={1} max={10000} value={s.training_rate_limit_per_minute} onChange={(e) => set("training_rate_limit_per_minute", Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label style={{ width: 150 }}>
            Cửa sổ (giây)
            <input type="number" min={1} max={3600} value={s.training_rate_window_seconds} onChange={(e) => set("training_rate_window_seconds", Math.max(1, Number(e.target.value) || 1))} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 180 }}>
            Trợ lý công khai iNut.vn (lần)
            <input type="number" min={1} max={10000} value={s.public_training_rate_limit} onChange={(e) => set("public_training_rate_limit", Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label style={{ width: 150 }}>
            Cửa sổ công khai (giây)
            <input type="number" min={1} max={3600} value={s.public_training_rate_window_seconds} onChange={(e) => set("public_training_rate_window_seconds", Math.max(1, Number(e.target.value) || 1))} />
          </label>
        </div>
        <p className="muted">Mặc định đã đặt 100 lần/phút. Trang Training hiển thị số đang chạy, hoàn tất, lỗi và bị từ chối.</p>
      </section>

      {/* ---- NAS ---- */}
      <section className="panel setting-card setting-nas">
        <header className="setting-card-head"><span className="setting-card-icon"><SettingIcon name="nas" /></span><div><span className="setting-card-kicker">LƯU TRỮ NỘI BỘ</span><h3>NAS Storage</h3><p>Đồng bộ hồ sơ, hóa đơn và chứng từ gốc</p></div><span className={`setting-state ${s.nas_enabled ? "on" : "off"}`}>{s.nas_enabled ? "Đang bật" : "Đang tắt"}</span></header>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={s.nas_enabled}
            onChange={(e) => set("nas_enabled", e.target.checked)}
          />
          Bật đồng bộ NAS
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Host / IP
            <input value={s.nas_host} onChange={(e) => set("nas_host", e.target.value)} />
          </label>
          <label>
            Share
            <input style={{ width: 120 }} value={s.nas_share} onChange={(e) => set("nas_share", e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            User
            <input value={s.nas_user} onChange={(e) => set("nas_user", e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>
            Password {s.nas_password_set && <span className="chip green sm">đã đặt</span>}
            <input
              type="password"
              value={nasPass}
              placeholder={s.nas_password_set ? "•••• (để trống = giữ nguyên)" : "nhập mật khẩu"}
              onChange={(e) => setNasPass(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Thư mục gốc (base path)
            <input value={s.nas_base_path} onChange={(e) => set("nas_base_path", e.target.value)} />
          </label>
          <label>
            Timeout (s)
            <input
              type="number"
              style={{ width: 90 }}
              value={s.nas_timeout}
              onChange={(e) => set("nas_timeout", Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-sm" onClick={testNas}>
            🧪 Test kết nối
          </button>
          {nasTestMsg && <span className="muted">{nasTestMsg}</span>}
          <button className="btn-sm ghost" onClick={loadDisk}>
            📊 Xem dung lượng
          </button>
        </div>
        {disk && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            {disk.ok ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>
                    Đã dùng <b>{vnd(disk.used_gb ?? 0)} GB</b> / {vnd(disk.total_gb ?? 0)} GB
                  </span>
                  <span>
                    Khả dụng: <b>{vnd(disk.free_gb ?? 0)} GB</b> ({(100 - (disk.percent_used ?? 0)).toFixed(1)}% trống)
                  </span>
                </div>
                <div
                  style={{
                    height: 12,
                    borderRadius: 6,
                    background: "#e5e8ec",
                    marginTop: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, disk.percent_used ?? 0)}%`,
                      height: "100%",
                      background: (disk.percent_used ?? 0) > 90 ? "#c0392b" : "#2d8f4e",
                    }}
                  />
                </div>
              </div>
            ) : (
              <span>❌ {disk.message}</span>
            )}
          </div>
        )}
      </section>

      {/* ---- iHOADON ---- */}
      <section className="panel setting-card setting-ihoadon">
        <header className="setting-card-head"><span className="setting-card-icon"><SettingIcon name="invoice" /></span><div><span className="setting-card-kicker">HÓA ĐƠN ĐIỆN TỬ</span><h3>iHOADON</h3><p>Đồng bộ và tạo hóa đơn bán ra dạng GHI_TAM</p></div><span className={`setting-state ${s.ihoadon_enabled ? "on" : "off"}`}>{s.ihoadon_enabled ? "Đang kết nối" : "Chưa bật"}</span></header>
        <p className="muted">
          CRM chỉ xem và tạo hóa đơn <b>GHI_TAM</b>; không ký, giữ số hoặc phát hành.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={s.ihoadon_enabled}
            onChange={(e) => set("ihoadon_enabled", e.target.checked)}
          />
          Bật kết nối iHOADON
        </label>
        <label>
          Website
          <input style={{ width: "100%" }} value={s.ihoadon_base_url} onChange={(e) => set("ihoadon_base_url", e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Mã số thuế
            <input value={s.ihoadon_tax_code} onChange={(e) => set("ihoadon_tax_code", e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>
            Tên đăng nhập
            <input value={s.ihoadon_username} onChange={(e) => set("ihoadon_username", e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Mật khẩu {s.ihoadon_password_set && <span className="chip green sm">đã đặt</span>}
            <input
              type="password"
              value={ihoadonPass}
              placeholder={s.ihoadon_password_set ? "•••• (để trống = giữ nguyên)" : "nhập mật khẩu iHOADON"}
              onChange={(e) => setIhoadonPass(e.target.value)}
            />
          </label>
          <label>
            Timeout (s)
            <input type="number" style={{ width: 90 }} value={s.ihoadon_timeout} onChange={(e) => set("ihoadon_timeout", Number(e.target.value) || 30)} />
          </label>
        </div>
        <div className="setting-card-action">
          <span>{ihoadonTestMsg || (syncStatus ? `${syncStatus.total} hóa đơn cổng khách · ${syncStatus.unmatched} chưa ghép` : "Chưa đồng bộ cổng khách hàng.")}</span>
          <div className="setting-action-buttons"><button type="button" disabled={busy} onClick={testIhoadon}>Test kết nối</button><button type="button" disabled={busy || syncStatus?.job?.status === "running"} onClick={syncIhoadon}>{syncStatus?.job?.status === "running" ? "Đang đồng bộ…" : "Đồng bộ cổng khách"}</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu kết nối iHOADON"}</button></div>
        </div>
        {syncStatus?.job && <div className="muted" style={{ marginTop: 8 }}>Lần gần nhất: {syncStatus.job.status} · {new Date(syncStatus.job.started_at).toLocaleString("vi-VN")} · {syncStatus.job.stats.seen ?? 0} hóa đơn, {syncStatus.job.stats.errors ?? 0} lỗi file.</div>}
        {unmatched.length > 0 && <div className="ihoadon-unmatched"><b>Hóa đơn chưa ghép MST ({unmatched.length})</b>{unmatched.slice(0, 20).map((inv) => <div className="ihoadon-unmatched-row" key={inv.id}><span>{inv.invoice_date} · {inv.invoice_series} {inv.invoice_number}<small>{inv.buyer_name} · MST {inv.buyer_tax_code || "trống"}</small></span><select defaultValue="" onChange={(e) => assignInvoice(inv.id, Number(e.target.value))}><option value="">Chọn khách hàng…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.tax_code}</option>)}</select></div>)}</div>}
      </section>

      {/* ---- Zoho Mail (Dong bo hoa don) ---- */}
      {zohoSettings && (
        <section className="panel setting-card setting-mail">
          <header className="setting-card-head">
            <span className="setting-card-icon"><SettingIcon name="mail" /></span>
            <div>
              <span className="setting-card-kicker">HỘP THƯ HÓA ĐƠN</span>
              <h3>Zoho Mail ({zohoSettings.mode === "rest_api" ? "REST API OAuth 2.0" : "IMAP Sync"})</h3>
              <p>Tự động quét tệp PDF / XML hóa đơn mua vào gửi về hộp thư</p>
            </div>
            <span className={`setting-state ${zohoSettings.enabled && ((zohoSettings.mode === "rest_api" && (zohoSettings.has_refresh_token || zohoRefreshToken || zohoGrantToken)) || (zohoSettings.mode === "imap" && (zohoSettings.has_password || zohoPass))) ? "on" : "off"}`}>
              {zohoSettings.enabled ? "Đang bật" : "Đang tắt"}
            </span>
          </header>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={zohoSettings.enabled}
              onChange={(e) => setZohoSettings({ ...zohoSettings, enabled: e.target.checked })}
            />
            Bật tự động quét & đồng bộ hóa đơn từ Zoho Mail
          </label>

          {/* Chon Mode */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="settings_zoho_mode"
                checked={zohoSettings.mode === "rest_api"}
                onChange={() => setZohoSettings({ ...zohoSettings, mode: "rest_api" })}
              />
              <b>Zoho REST API (OAuth 2.0)</b> <span className="chip green sm">Miễn phí & Khuyên dùng</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="settings_zoho_mode"
                checked={zohoSettings.mode === "imap"}
                onChange={() => setZohoSettings({ ...zohoSettings, mode: "imap" })}
              />
              <b>IMAP SSL</b>
            </label>
          </div>

          {zohoSettings.mode === "rest_api" ? (
            <div>
              <div className="form-grid-2">
                <label>
                  Client ID
                  <input
                    value={zohoSettings.client_id}
                    placeholder="1000.XXXXXXXXXX..."
                    onChange={(e) => setZohoSettings({ ...zohoSettings, client_id: e.target.value })}
                  />
                </label>
                <label>
                  Client Secret {zohoSettings.has_client_secret && <span className="chip green sm">đã đặt</span>}
                  <input
                    type="password"
                    value={zohoClientSecret}
                    placeholder={zohoSettings.has_client_secret ? "•••• (để trống = giữ nguyên)" : "nhập Client Secret"}
                    onChange={(e) => setZohoClientSecret(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-grid-2" style={{ marginTop: 8 }}>
                <label>
                  Mã Code một lần (Grant Token) {zohoSettings.has_refresh_token && <span className="chip green sm">Đã có Refresh Token vĩnh viễn</span>}
                  <input
                    value={zohoGrantToken}
                    placeholder={zohoSettings.has_refresh_token ? "Đã cấp token (nhập code mới nếu cấp lại)" : "1000.xxxx (Tạo từ Zoho Console -> Generate Code)"}
                    onChange={(e) => setZohoGrantToken(e.target.value)}
                  />
                </label>
                <label>
                  Số ngày quét mặc định
                  <input
                    type="number"
                    value={zohoSettings.days}
                    onChange={(e) => setZohoSettings({ ...zohoSettings, days: Number(e.target.value) || 30 })}
                  />
                </label>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, fontSize: 12, color: "#334155", marginTop: 10, lineHeight: 1.5 }}>
                <b>💡 Hướng dẫn tạo miễn phí:</b> Truy cập <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer" style={{ color: "#0284c7", fontWeight: 600 }}>Zoho Developer Console (api-console.zoho.com)</a> &rarr; Bấm <b>Add Client</b> &rarr; Chọn <b>Self Client</b> &rarr; Copy <b>Client ID</b> & <b>Client Secret</b> &rarr; Vào tab <b>Generate Code</b> nhập Scope <code style={{ background: "#e2e8f0", padding: "1px 4px", borderRadius: 3 }}>ZohoMail.messages.READ,ZohoMail.accounts.READ</code> (10 minutes) rồi dán mã Code vào đây &rarr; Bấm <b>Test kết nối</b>.
              </div>
            </div>
          ) : (
            <div className="form-grid-2">
              <label>
                Máy chủ IMAP
                <input
                  value={zohoSettings.server}
                  placeholder="imappro.zoho.com"
                  onChange={(e) => setZohoSettings({ ...zohoSettings, server: e.target.value })}
                />
              </label>
              <label>
                Cổng SSL
                <input
                  type="number"
                  value={zohoSettings.port}
                  placeholder="993"
                  onChange={(e) => setZohoSettings({ ...zohoSettings, port: Number(e.target.value) || 993 })}
                />
              </label>
              <label>
                Tài khoản Email
                <input
                  value={zohoSettings.username}
                  placeholder="khanhnhn@inut.vn"
                  onChange={(e) => setZohoSettings({ ...zohoSettings, username: e.target.value })}
                />
              </label>
              <label>
                Mật khẩu ứng dụng (App Password) {zohoSettings.has_password && <span className="chip green sm">đã đặt</span>}
                <input
                  type="password"
                  value={zohoPass}
                  placeholder={zohoSettings.has_password ? "•••• (để trống = giữ nguyên)" : "nhập App Password Zoho"}
                  onChange={(e) => setZohoPass(e.target.value)}
                />
              </label>
              <label>
                Hộp thư (Mailbox)
                <input
                  value={zohoSettings.mailbox}
                  placeholder="INBOX"
                  onChange={(e) => setZohoSettings({ ...zohoSettings, mailbox: e.target.value })}
                />
              </label>
              <label>
                Số ngày quét mặc định
                <input
                  type="number"
                  value={zohoSettings.days}
                  onChange={(e) => setZohoSettings({ ...zohoSettings, days: Number(e.target.value) || 30 })}
                />
              </label>
            </div>
          )}

          <div className="setting-card-action" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13 }}>{zohoTestMsg || zohoSyncMsg || (zohoSettings.mode === "rest_api" ? "Zoho REST API OAuth 2.0 hoàn toàn miễn phí." : "IMAP SSL dùng App Password.")}</span>
            <div className="setting-action-buttons">
              <button type="button" disabled={zohoBusy} onClick={testZoho}>
                Test kết nối
              </button>
              <button type="button" disabled={zohoBusy || (zohoSettings.mode === "rest_api" ? (!zohoSettings.has_refresh_token && !zohoRefreshToken && !zohoGrantToken) : !zohoSettings.has_password)} onClick={syncZoho}>
                {zohoBusy ? "Đang quét…" : "Quét email ngay"}
              </button>
              <button className="primary" disabled={zohoBusy} onClick={saveZoho}>
                {zohoBusy ? "Đang lưu…" : "Lưu cấu hình Zoho"}
              </button>
            </div>
          </div>
        </section>
      )}

      {spxSettings && (
        <section className="panel setting-card setting-spx">
          <header className="setting-card-head">
            <span className="setting-card-icon">
              <SettingIcon name="spx" />
            </span>
            <div>
              <span className="setting-card-kicker">GIAO HÀNG & LOGISTICS</span>
              <h3>Vận Đơn SPX Express (spx.vn)</h3>
              <p>Tự động tạo đơn, lấy mã vận đơn SPXVN & in tem nhiệt khổ A6</p>
            </div>
            <span className={`setting-state ${spxSettings.spx_username ? "on" : "off"}`}>
              {spxSettings.spx_username ? "Đã liên thông" : "Chưa cấu hình"}
            </span>
          </header>

          <div className="form-grid-2">
            <label>
              Tài khoản / SĐT Đăng nhập SPX
              <input
                value={spxSettings.spx_username}
                placeholder="0345296757"
                onChange={(e) => setSpxSettings({ ...spxSettings, spx_username: e.target.value })}
              />
            </label>
            <label>
              Mật khẩu SPX {spxSettings.spx_password && <span className="chip green sm">đã lưu AES-128</span>}
              <input
                type="password"
                value={spxPass}
                placeholder="để trống = giữ nguyên"
                onChange={(e) => setSpxPass(e.target.value)}
              />
            </label>
            <label>
              Shop ID (Tùy chọn)
              <input
                value={spxSettings.spx_shop_id}
                placeholder="Mã Shop trên SPX Portal (nếu có)"
                onChange={(e) => setSpxSettings({ ...spxSettings, spx_shop_id: e.target.value })}
              />
            </label>
            <label>
              API Token / Secret Key (Tùy chọn) {spxSettings.spx_api_token && <span className="chip green sm">đã có token</span>}
              <input
                type="password"
                value={spxApiToken}
                placeholder="API Key do SPX cấp (nếu có)"
                onChange={(e) => setSpxApiToken(e.target.value)}
              />
            </label>
            <label style={{ gridColumn: "span 2" }}>
              Session Cookies (SPC_EC / spx_sid / spx_token) {spxSettings.spx_cookies && <span className="chip green sm">đã lưu phiên Live</span>}
              <input
                type="password"
                value={spxCookies}
                placeholder="Dán chuỗi Cookie từ trình duyệt (để trống = giữ nguyên)"
                onChange={(e) => setSpxCookies(e.target.value)}
              />
            </label>
          </div>


          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 }}>
              Thông Tin Kho Người Gửi Mặc Định
            </h4>
            <div className="form-grid-2">
              <label>
                Tên Shop / Doanh nghiệp
                <input
                  value={spxSettings.spx_sender_name}
                  placeholder="CÔNG TY CP ĐT & PT CÔNG NGHỆ INUT"
                  onChange={(e) => setSpxSettings({ ...spxSettings, spx_sender_name: e.target.value })}
                />
              </label>
              <label>
                Số điện thoại kho
                <input
                  value={spxSettings.spx_sender_phone}
                  placeholder="0345296757"
                  onChange={(e) => setSpxSettings({ ...spxSettings, spx_sender_phone: e.target.value })}
                />
              </label>
              <label style={{ gridColumn: "span 2" }}>
                Địa chỉ kho lấy hàng
                <input
                  value={spxSettings.spx_sender_address}
                  placeholder="Khu Công Nghệ Cao, TP. Thủ Đức, TP. Hồ Chí Minh"
                  onChange={(e) => setSpxSettings({ ...spxSettings, spx_sender_address: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="setting-card-action" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13 }}>{spxTestMsg || "Liên thông trực tiếp cổng SPX Express & In tem nhãn nhiệt A6."}</span>
            <div className="setting-action-buttons">
              <button type="button" disabled={spxBusy} onClick={testSpx}>
                {spxBusy ? "Đang kiểm tra…" : "Test kết nối SPX"}
              </button>
              <button className="primary" disabled={spxBusy} onClick={saveSpx}>
                {spxBusy ? "Đang lưu…" : "Lưu cấu hình SPX"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="panel setting-card setting-mail">
        <header className="setting-card-head"><span className="setting-card-icon"><SettingIcon name="mail" /></span><div><span className="setting-card-kicker">CẢNH BÁO VẬN HÀNH</span><h3>Email SMTP</h3><p>Thông báo khi phiên thuế hết hạn hoặc cron thất bại</p></div><span className={`setting-state ${s.smtp_host && s.smtp_password_set ? "on" : "off"}`}>{s.smtp_host && s.smtp_password_set ? "Đã cấu hình" : "Chưa đủ"}</span></header>
        <div className="form-grid-2">
          <label>SMTP host<input value={s.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" /></label>
          <label>Port<input type="number" value={s.smtp_port} onChange={(e) => set("smtp_port", Number(e.target.value) || 587)} /></label>
          <label>Tài khoản<input value={s.smtp_username} onChange={(e) => set("smtp_username", e.target.value)} /></label>
          <label>Mật khẩu {s.smtp_password_set && <span className="chip green sm">đã đặt</span>}<input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="để trống = giữ nguyên" /></label>
          <label>Email gửi<input value={s.smtp_from} onChange={(e) => set("smtp_from", e.target.value)} /></label>
          <label>Email nhận<input value={s.smtp_to} onChange={(e) => set("smtp_to", e.target.value)} /></label>
        </div>
      </section>

      </div>

      <div className="settings-savebar">
        <div><b>Sẵn sàng áp dụng thay đổi</b><small>Cấu hình được mã hóa và có hiệu lực ngay.</small></div>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu cấu hình"}
        </button>
      </div>
    </div>
  );
}
