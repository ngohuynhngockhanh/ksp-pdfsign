import { useEffect, useState } from "react";
import {
  api,
  EmailSyncJobRun,
  EmailSyncSettings,
  EmailSyncTestResult,
} from "../api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSyncSuccess?: () => void;
}

export function EmailSyncModal({ isOpen, onClose, onSyncSuccess }: Props) {
  const [tab, setTab] = useState<"sync" | "settings" | "history">("sync");
  const [settings, setSettings] = useState<EmailSyncSettings>({
    enabled: true,
    mode: "rest_api",
    client_id: "",
    has_client_secret: false,
    has_refresh_token: false,
    accounts_url: "https://accounts.zoho.com",
    mail_api_url: "https://mail.zoho.com",
    server: "imappro.zoho.com",
    port: 993,
    username: "khanhnhn@inut.vn",
    has_password: false,
    mailbox: "INBOX",
    days: 30,
  });
  // Secrets
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [grantToken, setGrantToken] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<EmailSyncTestResult | null>(null);
  const [syncResult, setSyncResult] = useState<EmailSyncJobRun | null>(null);
  const [runs, setRuns] = useState<EmailSyncJobRun[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    loadSettings();
    loadHistory();
    setErrorMsg("");
    setSuccessMsg("");
    setTestResult(null);
  }, [isOpen]);

  async function loadSettings() {
    try {
      const data = await api.emailSyncSettings();
      setSettings(data);
      if (data.days) setDays(data.days);
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  }

  async function loadHistory() {
    try {
      const data = await api.emailSyncRuns();
      setRuns(data);
    } catch {
      // ignore
    }
  }

  async function handleTest() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");
    setTestResult(null);
    try {
      const res = await api.emailSyncTest({
        mode: settings.mode,
        client_id: settings.client_id,
        client_secret: clientSecret || undefined,
        refresh_token: refreshToken || undefined,
        grant_token: grantToken || undefined,
        accounts_url: settings.accounts_url,
        mail_api_url: settings.mail_api_url,
        server: settings.server,
        port: settings.port,
        username: settings.username,
        password: password || undefined,
        mailbox: settings.mailbox,
      });
      setTestResult(res);
      if (res.refresh_token) {
        setSettings((prev) => ({ ...prev, has_refresh_token: true }));
        setGrantToken("");
        setSuccessMsg("Đã đổi thành công Refresh Token từ mã Code Zoho!");
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const updated = await api.emailSyncSaveSettings({
        ...settings,
        client_secret: clientSecret || undefined,
        refresh_token: refreshToken || undefined,
        grant_token: grantToken || undefined,
        password: password || undefined,
      });
      setSettings(updated);
      setClientSecret("");
      setGrantToken("");
      setPassword("");
      setSuccessMsg("Đã lưu cấu hình Zoho Mail thành công!");
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunSync() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");
    setSyncResult(null);
    try {
      const res = await api.emailSyncRun(days);
      setSyncResult(res);
      setSuccessMsg("Quá trình quét và đồng bộ hoàn tất!");
      loadHistory();
      if (onSyncSuccess) onSyncSuccess();
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isConfigured =
    settings.mode === "rest_api"
      ? Boolean(settings.client_id && (settings.has_refresh_token || refreshToken || grantToken))
      : Boolean(settings.username && (settings.has_password || password));

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 660, width: "95%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            borderBottom: "1px solid var(--border-color, #e2e8f0)",
            paddingBottom: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, color: "var(--text-primary, #0f172a)" }}>
              📥 Đồng bộ hóa đơn từ Zoho Mail
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted, #64748b)" }}>
              Tự động quét và kéo file PDF/XML hóa đơn về hệ thống
            </p>
          </div>
          <button
            className="btn-sm ghost"
            style={{ fontSize: 18, lineHeight: 1 }}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        {/* Tab Header */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            className={`btn-sm ${tab === "sync" ? "active" : "ghost"}`}
            onClick={() => setTab("sync")}
          >
            ⚡ Đồng bộ ngay
          </button>
          <button
            className={`btn-sm ${tab === "settings" ? "active" : "ghost"}`}
            onClick={() => setTab("settings")}
          >
            ⚙️ Cấu hình Zoho ({settings.mode === "rest_api" ? "REST API" : "IMAP"})
          </button>
          <button
            className={`btn-sm ${tab === "history" ? "active" : "ghost"}`}
            onClick={() => {
              setTab("history");
              loadHistory();
            }}
          >
            📜 Lịch sử ({runs.length})
          </button>
        </div>

        {errorMsg && (
          <div className="warn-banner danger" style={{ marginBottom: 12 }}>
            ❌ {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="warn-banner success" style={{ marginBottom: 12 }}>
            ✅ {successMsg}
          </div>
        )}

        {/* Tab 1: Dong bo ngay */}
        {tab === "sync" && (
          <div>
            <div style={{ background: "var(--bg-subtle, #f8fafc)", padding: 12, borderRadius: 6, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Phương thức: {settings.mode === "rest_api" ? "Zoho Mail REST API (OAuth 2.0)" : "IMAP SSL"}
                </span>
                <span className={`chip ${isConfigured ? "green" : "amber"} sm`}>
                  {isConfigured ? "Đã sẵn sàng" : "Chưa đủ cấu hình"}
                </span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                Khoảng thời gian quét:
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
                >
                  <option value={7}>7 ngày gần nhất</option>
                  <option value={15}>15 ngày gần nhất</option>
                  <option value={30}>30 ngày gần nhất (Khuyên dùng)</option>
                  <option value={60}>60 ngày gần nhất</option>
                  <option value={90}>Quý gần nhất (90 ngày)</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 16 }}>
              <button
                className="primary"
                disabled={busy || !isConfigured}
                onClick={handleRunSync}
                style={{ padding: "8px 16px", fontWeight: 600 }}
              >
                {busy ? "⏳ Đang quét email và giải nén..." : "🚀 Bắt đầu quét & Đồng bộ"}
              </button>
            </div>

            {syncResult && syncResult.stats && (
              <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6, padding: 12, fontSize: 13 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>📊 Kết quả đợt đồng bộ:</h4>
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                  <li>
                    Tệp hóa đơn tìm thấy: <b>{syncResult.stats.attachments_found ?? 0}</b>
                  </li>
                  <li>
                    Hóa đơn mua vào tạo mới: <b style={{ color: "#16a34a" }}>{syncResult.stats.created_new_draft ?? 0}</b>
                  </li>
                  <li>
                    Hóa đơn cũ được gán bổ sung PDF: <b style={{ color: "#2563eb" }}>{syncResult.stats.pdf_attached_to_existing ?? 0}</b>
                  </li>
                  <li>
                    Bỏ qua (đã có đủ file): {syncResult.stats.skipped_existing ?? 0}
                  </li>
                  {Boolean(syncResult.stats.errors) && (
                    <li style={{ color: "#dc2626" }}>Lỗi: {syncResult.stats.errors}</li>
                  )}
                </ul>

                {(syncResult.stats.details || []).length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 120, overflowY: "auto", background: "#f1f5f9", padding: 8, borderRadius: 4, fontSize: 12 }}>
                    {(syncResult.stats.details || []).map((d, i) => (
                      <div key={i}>• {d}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Cau hinh */}
        {tab === "settings" && (
          <div>
            {/* Chon Mode */}
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="sync_mode"
                  checked={settings.mode === "rest_api"}
                  onChange={() => setSettings({ ...settings, mode: "rest_api" })}
                />
                <b>Zoho REST API (OAuth 2.0)</b> <span className="chip green sm">Miễn phí & Khuyên dùng</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="sync_mode"
                  checked={settings.mode === "imap"}
                  onChange={() => setSettings({ ...settings, mode: "imap" })}
                />
                <b>IMAP SSL</b>
              </label>
            </div>

            {settings.mode === "rest_api" ? (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <label style={{ fontSize: 13 }}>
                    Client ID
                    <input
                      value={settings.client_id}
                      placeholder="1000.XXXXXXXXXX..."
                      onChange={(e) => setSettings({ ...settings, client_id: e.target.value })}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    Client Secret {settings.has_client_secret && <span className="chip green sm">đã đặt</span>}
                    <input
                      type="password"
                      value={clientSecret}
                      placeholder={settings.has_client_secret ? "•••••••• (để trống = giữ nguyên)" : "nhập Client Secret"}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                  </label>
                </div>

                <label style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
                  Mã Code một lần (Grant Token) {settings.has_refresh_token && <span className="chip green sm">Đã có Refresh Token vĩnh viễn</span>}
                  <input
                    value={grantToken}
                    placeholder={settings.has_refresh_token ? "Đã cấp Refresh Token (nhập code mới nếu muốn cấp lại)" : "1000.xxxx (Tạo từ Zoho Console -> Generate Code)"}
                    onChange={(e) => setGrantToken(e.target.value)}
                  />
                </label>

                {/* Huong dan tao token */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, fontSize: 12, color: "#334155", marginBottom: 12, lineHeight: 1.5 }}>
                  <b>💡 Hướng dẫn tạo miễn phí trong 1 phút:</b>
                  <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    <li>Truy cập <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer" style={{ color: "#0284c7", fontWeight: 600 }}>Zoho Developer Console (api-console.zoho.com)</a> &rarr; Bấm <b>Add Client</b> &rarr; Chọn <b>Self Client</b>.</li>
                    <li>Copy <b>Client ID</b> và <b>Client Secret</b> dán vào 2 ô trên.</li>
                    <li>Trong tab <b>Generate Code</b>, nhập Scope: <code style={{ background: "#e2e8f0", padding: "1px 4px", borderRadius: 3 }}>ZohoMail.messages.READ,ZohoMail.accounts.READ</code> &rarr; Chọn 10 minutes &rarr; Bấm <b>Generate</b>.</li>
                    <li>Copy mã Code dán vào ô <b>Mã Code</b> rồi bấm <b>Test kết nối</b> &rarr; Hệ thống sẽ tự động lưu Refresh Token vĩnh viễn!</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <label style={{ fontSize: 13 }}>
                    Máy chủ IMAP
                    <input
                      value={settings.server}
                      placeholder="imappro.zoho.com"
                      onChange={(e) => setSettings({ ...settings, server: e.target.value })}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    Cổng SSL
                    <input
                      type="number"
                      value={settings.port}
                      placeholder="993"
                      onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) || 993 })}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <label style={{ fontSize: 13 }}>
                    Email đăng nhập
                    <input
                      value={settings.username}
                      placeholder="khanhnhn@inut.vn"
                      onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    Hộp thư (Mailbox)
                    <input
                      value={settings.mailbox}
                      placeholder="INBOX"
                      onChange={(e) => setSettings({ ...settings, mailbox: e.target.value })}
                    />
                  </label>
                </div>

                <label style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
                  Mật khẩu ứng dụng (App Password) {settings.has_password && <span className="chip green sm">đã lưu</span>}
                  <input
                    type="password"
                    value={password}
                    placeholder={settings.has_password ? "•••••••• (để trống = giữ nguyên)" : "Nhập App Password"}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
            )}

            {testResult && (
              <div className={`warn-banner ${testResult.ok ? "success" : "danger"}`} style={{ marginBottom: 12, fontSize: 13 }}>
                {testResult.ok ? `✅ ${testResult.message}` : `❌ ${testResult.message}`}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-sm ghost" disabled={busy} onClick={handleTest}>
                {busy ? "Đang thử..." : "🧪 Test kết nối"}
              </button>
              <button className="btn-sm primary" disabled={busy} onClick={handleSaveSettings}>
                {busy ? "Đang lưu..." : "💾 Lưu cấu hình"}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Lich su */}
        {tab === "history" && (
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {runs.length === 0 ? (
              <p style={{ color: "#64748b", textAlign: "center", margin: "24px 0" }}>
                Chưa có lịch sử đồng bộ email nào.
              </p>
            ) : (
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Thời gian</th>
                    <th style={{ padding: "6px 8px" }}>Trạng thái</th>
                    <th style={{ padding: "6px 8px" }}>Mới</th>
                    <th style={{ padding: "6px 8px" }}>Gán PDF</th>
                    <th style={{ padding: "6px 8px" }}>Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 8px" }}>
                        {r.started_at ? new Date(r.started_at).toLocaleString("vi-VN") : `#${r.id}`}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <span
                          className={`chip ${
                            r.status === "success"
                              ? "green"
                              : r.status === "needs_action"
                              ? "amber"
                              : "red"
                          } sm`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", color: "#16a34a" }}>
                        {r.stats?.created_new_draft ?? 0}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#2563eb" }}>
                        {r.stats?.pdf_attached_to_existing ?? 0}
                      </td>
                      <td style={{ padding: "6px 8px", color: r.stats?.errors ? "#dc2626" : "inherit" }}>
                        {r.stats?.errors ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
