import { useEffect, useState } from "react";
import { api, AppSettings } from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
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

  if (!s) return <div className="docs-page">{err ? <div className="error">{err}</div> : "Đang tải…"}</div>;

  return (
    <div className="docs-page" style={{ maxWidth: 720 }}>
      <h2>Cài đặt hệ thống</h2>
      {err && <div className="error">{err}</div>}
      {msg && <div className="warn-banner">{msg}</div>}

      {/* ---- AI ---- */}
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>🤖 AI (9router / endpoint tương thích OpenAI)</h3>
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
      </div>

      {/* ---- NAS ---- */}
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>NAS · Lưu trữ hồ sơ và hóa đơn</h3>
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
      </div>

      {/* ---- iHOADON ---- */}
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>iHOADON · Đồng bộ hóa đơn bán ra</h3>
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
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>Email cảnh báo đồng bộ thuế</h3>
        <p className="muted">Gửi email khi phiên cổng thuế hết hạn hoặc job 02:00 thất bại.</p>
        <div className="form-grid-2">
          <label>SMTP host<input value={s.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" /></label>
          <label>Port<input type="number" value={s.smtp_port} onChange={(e) => set("smtp_port", Number(e.target.value) || 587)} /></label>
          <label>Tài khoản<input value={s.smtp_username} onChange={(e) => set("smtp_username", e.target.value)} /></label>
          <label>Mật khẩu {s.smtp_password_set && <span className="chip green sm">đã đặt</span>}<input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="để trống = giữ nguyên" /></label>
          <label>Email gửi<input value={s.smtp_from} onChange={(e) => set("smtp_from", e.target.value)} /></label>
          <label>Email nhận<input value={s.smtp_to} onChange={(e) => set("smtp_to", e.target.value)} /></label>
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: 14 }}>
        <button className="primary" disabled={busy} onClick={save}>
          💾 Lưu cấu hình
        </button>
      </div>
    </div>
  );
}
