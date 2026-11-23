import { useEffect, useState } from "react";
import {
  api,
  EmailSyncJobRun,
  EmailSyncSettings,
  EmailSyncTestResult,
} from "../api";
import { AppModal, DataView, FormGrid, ResponsiveTabs } from "./ui";

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
      /* ignore */
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

  const footer =
    tab === "sync" ? (
      <>
        <button type="button" onClick={onClose} disabled={busy}>
          Đóng
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !isConfigured}
          onClick={handleRunSync}
        >
          {busy ? "Đang quét email và giải nén…" : "Bắt đầu quét & Đồng bộ"}
        </button>
      </>
    ) : tab === "settings" ? (
      <>
        <button type="button" disabled={busy} onClick={handleTest}>
          {busy ? "Đang thử…" : "Test kết nối"}
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={handleSaveSettings}
        >
          {busy ? "Đang lưu…" : "Lưu cấu hình"}
        </button>
      </>
    ) : (
      <button type="button" onClick={onClose}>
        Đóng
      </button>
    );

  return (
    <AppModal
      open={isOpen}
      onClose={onClose}
      size="md"
      title="Đồng bộ hóa đơn từ Zoho Mail"
      subtitle="Tự động quét và kéo file PDF/XML hóa đơn về hệ thống"
      footer={footer}
    >
      <ResponsiveTabs
        ariaLabel="Chức năng đồng bộ Email Zoho"
        active={tab}
        onChange={(nextTab) => {
          setTab(nextTab);
          if (nextTab === "history") loadHistory();
        }}
        tabs={[
          { id: "sync", label: "Đồng bộ ngay" },
          {
            id: "settings",
            label: `Cấu hình Zoho (${settings.mode === "rest_api" ? "REST API" : "IMAP"})`,
          },
          { id: "history", label: "Lịch sử", badge: runs.length },
        ]}
      />

      {errorMsg && (
        <div className="warn-banner danger" role="alert" style={{ marginBottom: 12 }}>
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="warn-banner success" role="status" style={{ marginBottom: 12 }}>
          {successMsg}
        </div>
      )}

      {/* Tab 1: Đồng bộ ngay */}
      {tab === "sync" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              background: "var(--surface-subtle)",
              border: "1px solid var(--border)",
              padding: 14,
              borderRadius: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <div className="row-between">
              <strong style={{ fontSize: 13.5 }}>
                Phương thức:{" "}
                {settings.mode === "rest_api" ? "Zoho Mail REST API (OAuth 2.0)" : "IMAP SSL"}
              </strong>
              <span className={`chip ${isConfigured ? "green" : "amber"} sm`}>
                {isConfigured ? "Đã sẵn sàng" : "Chưa đủ cấu hình"}
              </span>
            </div>
            <label style={{ margin: 0 }}>
              Khoảng thời gian quét
              <select
                className="ui-select"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>7 ngày gần nhất</option>
                <option value={15}>15 ngày gần nhất</option>
                <option value={30}>30 ngày gần nhất (Khuyên dùng)</option>
                <option value={60}>60 ngày gần nhất</option>
                <option value={90}>Quý gần nhất (90 ngày)</option>
              </select>
            </label>
          </div>

          {syncResult && syncResult.stats && (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
              }}
            >
              <h4 style={{ margin: "0 0 8px", fontSize: 15 }}>Kết quả đợt đồng bộ</h4>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.65 }}>
                <li>
                  Tệp hóa đơn tìm thấy: <b className="num">{syncResult.stats.attachments_found ?? 0}</b>
                </li>
                <li>
                  Hóa đơn mua vào tạo mới:{" "}
                  <b className="num" style={{ color: "var(--green)" }}>
                    {syncResult.stats.created_new_draft ?? 0}
                  </b>
                </li>
                <li>
                  Hóa đơn cũ được gán bổ sung PDF:{" "}
                  <b className="num" style={{ color: "var(--primary-dark)" }}>
                    {syncResult.stats.pdf_attached_to_existing ?? 0}
                  </b>
                </li>
                <li>
                  Bỏ qua (đã có đủ file): <span className="num">{syncResult.stats.skipped_existing ?? 0}</span>
                </li>
                {Boolean(syncResult.stats.errors) && (
                  <li style={{ color: "var(--red)" }}>Lỗi: {syncResult.stats.errors}</li>
                )}
              </ul>

              {(syncResult.stats.details || []).length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    maxHeight: 140,
                    overflowY: "auto",
                    background: "var(--surface-subtle)",
                    padding: 10,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  {(syncResult.stats.details || []).map((d, i) => (
                    <div key={i}>• {d}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Cấu hình */}
      {tab === "settings" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                margin: 0,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="sync_mode"
                checked={settings.mode === "rest_api"}
                onChange={() => setSettings({ ...settings, mode: "rest_api" })}
              />
              <b>Zoho REST API (OAuth 2.0)</b>
              <span className="chip green sm">Khuyên dùng</span>
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                margin: 0,
                cursor: "pointer",
              }}
            >
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
            <div style={{ display: "grid", gap: 12 }}>
              <FormGrid cols={2}>
                <label style={{ margin: 0 }}>
                  Client ID
                  <input
                    className="ui-input"
                    value={settings.client_id}
                    placeholder="1000.XXXXXXXXXX..."
                    onChange={(e) => setSettings({ ...settings, client_id: e.target.value })}
                  />
                </label>
                <label style={{ margin: 0 }}>
                  Client Secret{" "}
                  {settings.has_client_secret && <span className="chip green sm">đã đặt</span>}
                  <input
                    className="ui-input"
                    type="password"
                    value={clientSecret}
                    placeholder={
                      settings.has_client_secret
                        ? "•••••••• (để trống = giữ nguyên)"
                        : "nhập Client Secret"
                    }
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </label>
              </FormGrid>

              <label style={{ margin: 0 }}>
                Mã Code một lần (Grant Token){" "}
                {settings.has_refresh_token && (
                  <span className="chip green sm">Đã có Refresh Token</span>
                )}
                <input
                  className="ui-input"
                  value={grantToken}
                  placeholder={
                    settings.has_refresh_token
                      ? "Đã cấp Refresh Token (nhập code mới nếu muốn cấp lại)"
                      : "1000.xxxx (Tạo từ Zoho Console -> Generate Code)"
                  }
                  onChange={(e) => setGrantToken(e.target.value)}
                />
              </label>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 12.5,
                  color: "var(--text)",
                  lineHeight: 1.55,
                }}
              >
                <b>Hướng dẫn tạo token miễn phí trong 1 phút:</b>
                <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  <li>
                    Truy cập{" "}
                    <a
                      href="https://api-console.zoho.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Zoho Developer Console (api-console.zoho.com)
                    </a>{" "}
                    → Bấm <b>Add Client</b> → Chọn <b>Self Client</b>.
                  </li>
                  <li>
                    Copy <b>Client ID</b> và <b>Client Secret</b> dán vào 2 ô trên.
                  </li>
                  <li>
                    Trong tab <b>Generate Code</b>, nhập Scope:{" "}
                    <code>ZohoMail.messages.READ,ZohoMail.accounts.READ</code> → Chọn 10 minutes →
                    Bấm <b>Generate</b>.
                  </li>
                  <li>
                    Copy mã Code dán vào ô <b>Mã Code</b> rồi bấm <b>Test kết nối</b> — hệ thống sẽ
                    tự động lưu Refresh Token.
                  </li>
                </ol>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <FormGrid cols={2}>
                <label style={{ margin: 0 }}>
                  Máy chủ IMAP
                  <input
                    className="ui-input"
                    value={settings.server}
                    placeholder="imappro.zoho.com"
                    onChange={(e) => setSettings({ ...settings, server: e.target.value })}
                  />
                </label>
                <label style={{ margin: 0 }}>
                  Cổng SSL
                  <input
                    className="ui-input"
                    type="number"
                    value={settings.port}
                    placeholder="993"
                    onChange={(e) =>
                      setSettings({ ...settings, port: Number(e.target.value) || 993 })
                    }
                  />
                </label>
              </FormGrid>

              <FormGrid cols={2}>
                <label style={{ margin: 0 }}>
                  Email đăng nhập
                  <input
                    className="ui-input"
                    value={settings.username}
                    placeholder="khanhnhn@inut.vn"
                    onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                  />
                </label>
                <label style={{ margin: 0 }}>
                  Hộp thư (Mailbox)
                  <input
                    className="ui-input"
                    value={settings.mailbox}
                    placeholder="INBOX"
                    onChange={(e) => setSettings({ ...settings, mailbox: e.target.value })}
                  />
                </label>
              </FormGrid>

              <label style={{ margin: 0 }}>
                Mật khẩu ứng dụng (App Password){" "}
                {settings.has_password && <span className="chip green sm">đã lưu</span>}
                <input
                  className="ui-input"
                  type="password"
                  value={password}
                  placeholder={
                    settings.has_password
                      ? "•••••••• (để trống = giữ nguyên)"
                      : "Nhập App Password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          )}

          {testResult && (
            <div
              className={`warn-banner ${testResult.ok ? "success" : "danger"}`}
              role="status"
            >
              {testResult.message}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Lịch sử */}
      {tab === "history" && (
        <div>
          {runs.length === 0 ? (
            <div className="empty">Chưa có lịch sử đồng bộ email nào.</div>
          ) : (
            <DataView
              mobileMode="card"
              desktop={
                <div className="table-wrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Trạng thái</th>
                        <th>Mới</th>
                        <th>Gán PDF</th>
                        <th>Lỗi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td className="nowrap">
                            {r.started_at
                              ? new Date(r.started_at).toLocaleString("vi-VN")
                              : `#${r.id}`}
                          </td>
                          <td>
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
                          <td className="num" style={{ color: "var(--green)", fontWeight: 700 }}>
                            {r.stats?.created_new_draft ?? 0}
                          </td>
                          <td className="num" style={{ color: "var(--primary-dark)", fontWeight: 700 }}>
                            {r.stats?.pdf_attached_to_existing ?? 0}
                          </td>
                          <td className="num" style={{ color: r.stats?.errors ? "var(--red)" : "inherit" }}>
                            {r.stats?.errors ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div className="ui-mobile-card-list">
                  {runs.map((r) => (
                    <article key={r.id} className="ui-mobile-card">
                      <div className="ui-mobile-card-head">
                        <h4 className="ui-mobile-card-title">
                          {r.started_at
                            ? new Date(r.started_at).toLocaleString("vi-VN")
                            : `Đợt #${r.id}`}
                        </h4>
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
                      </div>
                      <div className="ui-mobile-card-grid">
                        <div className="ui-mobile-card-kv">
                          <span>Tạo mới</span>
                          <strong className="num">{r.stats?.created_new_draft ?? 0}</strong>
                        </div>
                        <div className="ui-mobile-card-kv">
                          <span>Gán PDF</span>
                          <strong className="num">{r.stats?.pdf_attached_to_existing ?? 0}</strong>
                        </div>
                        <div className="ui-mobile-card-kv">
                          <span>Lỗi</span>
                          <strong className="num">{r.stats?.errors ?? 0}</strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              }
            />
          )}
        </div>
      )}
    </AppModal>
  );
}
