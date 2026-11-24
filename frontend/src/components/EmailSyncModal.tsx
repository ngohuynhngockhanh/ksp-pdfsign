import { useEffect, useId, useState } from "react";
import {
  api,
  EmailSyncJobRun,
  EmailSyncSettings,
  EmailSyncTestResult,
} from "../api";
import {
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  ResponsiveTabs,
  StatusBadge,
} from "./ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSyncSuccess?: () => void;
}

function runStatusTone(status: string): "success" | "warning" | "danger" {
  if (status === "success") return "success";
  if (status === "needs_action") return "warning";
  return "danger";
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

  const daysId = useId();
  const clientIdId = useId();
  const clientSecretId = useId();
  const grantTokenId = useId();
  const serverId = useId();
  const portId = useId();
  const usernameId = useId();
  const mailboxId = useId();
  const passwordId = useId();

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
        <AppButton variant="secondary" onClick={onClose} disabled={busy}>
          Đóng
        </AppButton>
        <AppButton
          variant="primary"
          leftIcon="refresh"
          loading={busy}
          disabled={!isConfigured}
          onClick={handleRunSync}
        >
          {busy ? "Đang quét email và giải nén…" : "Bắt đầu quét & Đồng bộ"}
        </AppButton>
      </>
    ) : tab === "settings" ? (
      <>
        <AppButton variant="secondary" leftIcon="wifi" loading={busy} onClick={handleTest}>
          {busy ? "Đang thử…" : "Test kết nối"}
        </AppButton>
        <AppButton variant="primary" leftIcon="save" loading={busy} onClick={handleSaveSettings}>
          {busy ? "Đang lưu…" : "Lưu cấu hình"}
        </AppButton>
      </>
    ) : (
      <AppButton variant="secondary" onClick={onClose}>
        Đóng
      </AppButton>
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
      <div className="ui-stack">
        <ResponsiveTabs
          ariaLabel="Chức năng đồng bộ Email Zoho"
          active={tab}
          onChange={(nextTab) => {
            setTab(nextTab);
            if (nextTab === "history") loadHistory();
          }}
          tabs={[
            { id: "sync", label: "Đồng bộ ngay", icon: "refresh" },
            {
              id: "settings",
              label: `Cấu hình Zoho (${settings.mode === "rest_api" ? "REST API" : "IMAP"})`,
              icon: "settings",
            },
            { id: "history", label: "Lịch sử", icon: "clock", badge: runs.length },
          ]}
        />

        {errorMsg && <InlineAlert tone="danger">{errorMsg}</InlineAlert>}
        {successMsg && <InlineAlert tone="success">{successMsg}</InlineAlert>}

        {/* Tab 1: Đồng bộ ngay */}
        {tab === "sync" && (
          <div className="ui-stack">
            <div className="ui-subpanel ui-subpanel--md ui-stack">
              <div className="ui-row-between">
                <strong className="ui-text-strong">
                  Phương thức:{" "}
                  {settings.mode === "rest_api" ? "Zoho Mail REST API (OAuth 2.0)" : "IMAP SSL"}
                </strong>
                <StatusBadge
                  tone={isConfigured ? "success" : "warning"}
                  size="sm"
                  dot
                >
                  {isConfigured ? "Đã sẵn sàng" : "Chưa đủ cấu hình"}
                </StatusBadge>
              </div>
              <FormField label="Khoảng thời gian quét" htmlFor={daysId}>
                <select
                  id={daysId}
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
              </FormField>
            </div>

            {syncResult && syncResult.stats && (
              <div className="ui-subpanel ui-subpanel--card ui-stack--sm inv-email-result">
                <h4>Kết quả đợt đồng bộ</h4>
                <ul>
                  <li>
                    Tệp hóa đơn tìm thấy:{" "}
                    <b className="num">{syncResult.stats.attachments_found ?? 0}</b>
                  </li>
                  <li>
                    Hóa đơn mua vào tạo mới:{" "}
                    <b className="num ui-text-success">
                      {syncResult.stats.created_new_draft ?? 0}
                    </b>
                  </li>
                  <li>
                    Hóa đơn cũ được gán bổ sung PDF:{" "}
                    <b className="num ui-text-brand">
                      {syncResult.stats.pdf_attached_to_existing ?? 0}
                    </b>
                  </li>
                  <li>
                    Bỏ qua (đã có đủ file):{" "}
                    <span className="num">{syncResult.stats.skipped_existing ?? 0}</span>
                  </li>
                  {Boolean(syncResult.stats.errors) && (
                    <li className="ui-text-danger">Lỗi: {syncResult.stats.errors}</li>
                  )}
                </ul>

                {(syncResult.stats.details || []).length > 0 && (
                  <div className="ui-subpanel ui-scroll-xs ui-text-xs">
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
          <div className="ui-stack">
            <div className="ui-row">
              <label className="ui-check-label">
                <input
                  type="radio"
                  name="sync_mode"
                  checked={settings.mode === "rest_api"}
                  onChange={() => setSettings({ ...settings, mode: "rest_api" })}
                />
                <span>Zoho REST API (OAuth 2.0)</span>
                <StatusBadge tone="success" size="sm">
                  Khuyên dùng
                </StatusBadge>
              </label>
              <label className="ui-check-label">
                <input
                  type="radio"
                  name="sync_mode"
                  checked={settings.mode === "imap"}
                  onChange={() => setSettings({ ...settings, mode: "imap" })}
                />
                <span>IMAP SSL</span>
              </label>
            </div>

            {settings.mode === "rest_api" ? (
              <div className="ui-stack">
                <FormGrid cols={2}>
                  <FormField label="Client ID" htmlFor={clientIdId}>
                    <input
                      id={clientIdId}
                      className="ui-input"
                      value={settings.client_id}
                      placeholder="1000.XXXXXXXXXX..."
                      onChange={(e) => setSettings({ ...settings, client_id: e.target.value })}
                    />
                  </FormField>
                  <FormField
                    label={
                      <>
                        Client Secret
                        {settings.has_client_secret && (
                          <StatusBadge tone="success" size="sm">
                            đã đặt
                          </StatusBadge>
                        )}
                      </>
                    }
                    htmlFor={clientSecretId}
                  >
                    <input
                      id={clientSecretId}
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
                  </FormField>
                </FormGrid>

                <FormField
                  label={
                    <>
                      Mã Code một lần (Grant Token)
                      {settings.has_refresh_token && (
                        <StatusBadge tone="success" size="sm">
                          Đã có Refresh Token
                        </StatusBadge>
                      )}
                    </>
                  }
                  htmlFor={grantTokenId}
                >
                  <input
                    id={grantTokenId}
                    className="ui-input"
                    value={grantToken}
                    placeholder={
                      settings.has_refresh_token
                        ? "Đã cấp Refresh Token (nhập code mới nếu muốn cấp lại)"
                        : "1000.xxxx (Tạo từ Zoho Console -> Generate Code)"
                    }
                    onChange={(e) => setGrantToken(e.target.value)}
                  />
                </FormField>

                <div className="ui-subpanel ui-text-xs">
                  <b>Hướng dẫn tạo token miễn phí trong 1 phút:</b>
                  <ol>
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
                      <code>ZohoMail.messages.READ,ZohoMail.accounts.READ</code> → Chọn 10 minutes
                      → Bấm <b>Generate</b>.
                    </li>
                    <li>
                      Copy mã Code dán vào ô <b>Mã Code</b> rồi bấm <b>Test kết nối</b> — hệ thống
                      sẽ tự động lưu Refresh Token.
                    </li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="ui-stack">
                <FormGrid cols={2}>
                  <FormField label="Máy chủ IMAP" htmlFor={serverId}>
                    <input
                      id={serverId}
                      className="ui-input"
                      value={settings.server}
                      placeholder="imappro.zoho.com"
                      onChange={(e) => setSettings({ ...settings, server: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Cổng SSL" htmlFor={portId}>
                    <input
                      id={portId}
                      className="ui-input"
                      type="number"
                      value={settings.port}
                      placeholder="993"
                      onChange={(e) =>
                        setSettings({ ...settings, port: Number(e.target.value) || 993 })
                      }
                    />
                  </FormField>
                  <FormField label="Email đăng nhập" htmlFor={usernameId}>
                    <input
                      id={usernameId}
                      className="ui-input"
                      value={settings.username}
                      placeholder="khanhnhn@inut.vn"
                      onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Hộp thư (Mailbox)" htmlFor={mailboxId}>
                    <input
                      id={mailboxId}
                      className="ui-input"
                      value={settings.mailbox}
                      placeholder="INBOX"
                      onChange={(e) => setSettings({ ...settings, mailbox: e.target.value })}
                    />
                  </FormField>
                </FormGrid>

                <FormField
                  label={
                    <>
                      Mật khẩu ứng dụng (App Password)
                      {settings.has_password && (
                        <StatusBadge tone="success" size="sm">
                          đã lưu
                        </StatusBadge>
                      )}
                    </>
                  }
                  htmlFor={passwordId}
                >
                  <input
                    id={passwordId}
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
                </FormField>
              </div>
            )}

            {testResult && (
              <InlineAlert tone={testResult.ok ? "success" : "danger"}>
                {testResult.message}
              </InlineAlert>
            )}
          </div>
        )}

        {/* Tab 3: Lịch sử */}
        {tab === "history" && (
          <DataView
            mobileMode="card"
            empty={
              runs.length === 0 ? (
                <EmptyState
                  icon="mail"
                  compact
                  title="Chưa có lịch sử đồng bộ email nào"
                  description="Chuyển sang tab Đồng bộ ngay để quét hóa đơn PDF/XML từ hộp thư."
                />
              ) : undefined
            }
            desktop={
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Trạng thái</th>
                      <th className="ui-text-right">Mới</th>
                      <th className="ui-text-right">Gán PDF</th>
                      <th className="ui-text-right">Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="ui-nowrap">
                          {r.started_at
                            ? new Date(r.started_at).toLocaleString("vi-VN")
                            : `#${r.id}`}
                        </td>
                        <td>
                          <StatusBadge tone={runStatusTone(r.status)} size="sm" dot>
                            {r.status}
                          </StatusBadge>
                        </td>
                        <td className="num ui-text-right ui-text-success ui-text-strong">
                          {r.stats?.created_new_draft ?? 0}
                        </td>
                        <td className="num ui-text-right ui-text-brand ui-text-strong">
                          {r.stats?.pdf_attached_to_existing ?? 0}
                        </td>
                        <td
                          className={`num ui-text-right${r.stats?.errors ? " ui-text-danger ui-text-strong" : ""}`}
                        >
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
                  <MobileCard key={r.id}>
                    <MobileCardHeader
                      title={
                        r.started_at
                          ? new Date(r.started_at).toLocaleString("vi-VN")
                          : `Đợt #${r.id}`
                      }
                      badge={
                        <StatusBadge tone={runStatusTone(r.status)} size="sm" dot>
                          {r.status}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow
                        label="Tạo mới"
                        value={r.stats?.created_new_draft ?? 0}
                        mono
                      />
                      <MobileCardRow
                        label="Gán PDF"
                        value={r.stats?.pdf_attached_to_existing ?? 0}
                        mono
                      />
                      <MobileCardRow
                        label="Lỗi"
                        value={r.stats?.errors ?? 0}
                        mono
                      />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
              </div>
            }
          />
        )}
      </div>
    </AppModal>
  );
}
