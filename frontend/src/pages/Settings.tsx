import { useEffect, useState } from "react";
import { api, AppSettings } from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

type SettingIconName = "settings" | "ai" | "nas" | "invoice" | "mail";

function SettingIcon({ name }: { name: SettingIconName }) {
  const paths: Record<SettingIconName, React.ReactNode> = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    ai: <><path d="M9 3h6v3h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h3V3Z"/><path d="M8 12h.01M16 12h.01M8 16h8"/></>,
    nas: <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h7M11 16.5h7"/></>,
    invoice: <><path d="M6 3h9l3 3v15l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  };
  return <svg className="setting-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function Settings() {
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
  const [nasTestMsg, setNasTestMsg] = useState("");
  const [ihoadonTestMsg, setIhoadonTestMsg] = useState("");
  const [disk, setDisk] = useState<Awaited<ReturnType<typeof api.nasDisk>> | null>(null);

  async function load() {
    setErr("");
    try {
      setS(await api.getAppSettings());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((c) => (c ? { ...c, [k]: v } : c));
  }

  async function save() {
    if (!s) return;
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function testAi() {
    setAiTestMsg("⏳ Đang gọi thử AI…");
    try {
      const r = await api.aiTest();
      setAiTestMsg((r.ok ? "✅ " : "❌ ") + r.message);
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
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-sm" onClick={testAi}>
            🧪 Test AI
          </button>
          {aiTestMsg && <span className="muted">{aiTestMsg}</span>}
        </div>
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
          <span>{ihoadonTestMsg || (s.ihoadon_password_set ? "Mật khẩu kết nối đã được lưu an toàn." : "Cần nhập mật khẩu để hoàn tất kết nối.")}</span>
          <div className="setting-action-buttons"><button type="button" disabled={busy} onClick={testIhoadon}>Test kết nối</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu kết nối iHOADON"}</button></div>
        </div>
      </section>

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
