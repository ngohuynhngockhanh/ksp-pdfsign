import { useEffect, useState } from "react";
import {
  api,
  fetchSpxSettings,
  saveSpxSettings,
  testSpxConnection,
  type AppSettings,
  type Customer,
  type CustomerInvoice,
  type EmailSyncSettings,
  type ServiceApiKeyItem,
  type SpxSettings,
} from "../api";
import {
  AppButton,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useToast,
  type ResponsiveTabItem,
} from "../components/ui";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

type SettingsTab = "all" | "ai" | "nas" | "invoices" | "logistics" | "relay";

const SETTINGS_TABS: Array<ResponsiveTabItem<SettingsTab>> = [
  { id: "all", label: "Tất cả", icon: "layers" },
  { id: "ai", label: "AI & Training", icon: "bot" },
  { id: "nas", label: "Lưu trữ NAS", icon: "hard-drive" },
  { id: "invoices", label: "iHOADON & Zoho", icon: "receipt" },
  { id: "logistics", label: "SPX Express", icon: "truck" },
  { id: "relay", label: "SMTP & API Keys", icon: "key" },
];

export function Settings({
  usingDefaultSecrets = false,
  mustChangePassword = false,
  onChangePassword,
}: {
  usingDefaultSecrets?: boolean;
  mustChangePassword?: boolean;
  onChangePassword?: () => void;
}) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>("all");
  const [s, setS] = useState<AppSettings | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Secret inputs (blank = keep existing)
  const [aiKey, setAiKey] = useState("");
  const [nasPass, setNasPass] = useState("");
  const [ihoadonPass, setIhoadonPass] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [aiTestMsg, setAiTestMsg] = useState("");
  const [aiPrompt, setAiPrompt] = useState("Trả lời đúng một từ: OK");
  const [aiReply, setAiReply] = useState("");
  const [nasTestMsg, setNasTestMsg] = useState("");
  const [ihoadonTestMsg, setIhoadonTestMsg] = useState("");
  const [syncStatus, setSyncStatus] = useState<Awaited<
    ReturnType<typeof api.ihoadonCustomerSyncStatus>
  > | null>(null);
  const [unmatched, setUnmatched] = useState<CustomerInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [disk, setDisk] = useState<Awaited<ReturnType<typeof api.nasDisk>> | null>(null);

  // Zoho Mail sync state
  const [zohoSettings, setZohoSettings] = useState<EmailSyncSettings | null>(null);
  const [zohoClientSecret, setZohoClientSecret] = useState("");
  const [zohoGrantToken, setZohoGrantToken] = useState("");
  const [zohoRefreshToken, setZohoRefreshToken] = useState("");
  const [zohoPass, setZohoPass] = useState("");
  const [zohoTestMsg, setZohoTestMsg] = useState("");
  const [zohoSyncMsg, setZohoSyncMsg] = useState("");
  const [zohoBusy, setZohoBusy] = useState(false);

  // SPX Express Logistics state
  const [spxSettings, setSpxSettings] = useState<SpxSettings | null>(null);
  const [spxPass, setSpxPass] = useState("");
  const [spxApiToken, setSpxApiToken] = useState("");
  const [spxCookies, setSpxCookies] = useState("");
  const [spxTestMsg, setSpxTestMsg] = useState("");
  const [spxBusy, setSpxBusy] = useState(false);

  // Service API Keys (Email + Telegram Relay)
  const [svcKeys, setSvcKeys] = useState<ServiceApiKeyItem[]>([]);
  const [svcName, setSvcName] = useState("");
  const [svcScopeMail, setSvcScopeMail] = useState(true);
  const [svcScopeTg, setSvcScopeTg] = useState(true);
  const [svcNewSecret, setSvcNewSecret] = useState("");
  const [svcMsg, setSvcMsg] = useState("");
  const [svcBusy, setSvcBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      const [settings, status, unmatchedRows, customerRows, zohoCfg, spxCfg, svcRes] =
        await Promise.all([
          api.getAppSettings(),
          api.ihoadonCustomerSyncStatus(),
          api.ihoadonUnmatched(),
          api.listCustomers(),
          api.emailSyncSettings().catch(() => null),
          fetchSpxSettings().catch(() => null),
          api.listServiceKeys().catch(() => null),
        ]);
      setS(settings);
      setSyncStatus(status && typeof status.total === "number" ? status : null);
      setUnmatched(Array.isArray(unmatchedRows) ? unmatchedRows : []);
      setCustomers(Array.isArray(customerRows) ? customerRows : []);
      if (zohoCfg && typeof zohoCfg.mode === "string") setZohoSettings(zohoCfg);
      if (spxCfg && typeof spxCfg.spx_username === "string") setSpxSettings(spxCfg);
      if (svcRes && Array.isArray(svcRes.keys)) setSvcKeys(svcRes.keys);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (syncStatus?.job?.status !== "running") return;
    const timer = window.setInterval(() => {
      void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [syncStatus?.job?.status]);

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((c) => (c ? { ...c, [k]: v } : c));
  }

  async function save() {
    if (!s) return false;
    setBusy(true);
    setErr("");
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
      toast.success("Đã lưu cấu hình (có hiệu lực ngay, không cần khởi động lại).");
      setAiKey("");
      setNasPass("");
      setIhoadonPass("");
      setSmtpPass("");
      await load();
      return true;
    } catch (e) {
      const m = (e as Error).message;
      setErr(m);
      toast.error(m);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testAi() {
    setAiTestMsg("Đang lưu cấu hình và gọi thử AI…");
    setAiReply("");
    try {
      if (!(await save())) return;
      const r = await api.aiTest(aiPrompt);
      setAiTestMsg(r.message);
      setAiReply(r.reply || "");
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      const m = (e as Error).message;
      setAiTestMsg(m);
      toast.error(m);
    }
  }

  async function testNas() {
    setNasTestMsg("Đang kiểm tra NAS…");
    try {
      const r = await api.nasTest();
      setNasTestMsg(r.message);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      const m = (e as Error).message;
      setNasTestMsg(m);
      toast.error(m);
    }
  }

  async function loadDisk() {
    setDisk(null);
    try {
      setDisk(await api.nasDisk());
    } catch (e) {
      const m = (e as Error).message;
      setErr(m);
      toast.error(m);
    }
  }

  async function testIhoadon() {
    setIhoadonTestMsg("Đang đăng nhập và đọc số lượng hóa đơn…");
    try {
      await save();
      const r = await api.ihoadonDashboard();
      const okMsg = `Kết nối thành công · ${r.total} hóa đơn · ${r.draft} bản nháp.`;
      setIhoadonTestMsg(okMsg);
      toast.success(okMsg);
    } catch (e) {
      const m = `Kết nối thất bại: ${(e as Error).message}`;
      setIhoadonTestMsg(m);
      toast.error(m);
    }
  }

  async function syncIhoadon() {
    setIhoadonTestMsg("Đã yêu cầu đồng bộ; tiến trình đang chạy nền...");
    try {
      await api.ihoadonCustomerSync();
      toast.info("Đang đồng bộ hóa đơn cổng khách hàng ở nền.");
      window.setTimeout(() => {
        void load();
      }, 1500);
    } catch (e) {
      const m = (e as Error).message;
      setIhoadonTestMsg(m);
      toast.error(m);
    }
  }

  async function assignInvoice(invoiceId: number, customerId: number) {
    if (!customerId) return;
    try {
      await api.ihoadonAssignCustomer(invoiceId, customerId);
      toast.success("Đã ghép hóa đơn với khách hàng.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
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
      setZohoTestMsg(res.message);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      if (res.refresh_token) {
        setZohoSettings((prev) => (prev ? { ...prev, has_refresh_token: true } : prev));
        setZohoGrantToken("");
      }
    } catch (e) {
      const m = (e as Error).message;
      setZohoTestMsg(m);
      toast.error(m);
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
      setZohoRefreshToken("");
      setZohoPass("");
      const okMsg = "Đã lưu cấu hình Zoho Mail thành công.";
      setZohoTestMsg(okMsg);
      toast.success(okMsg);
    } catch (e) {
      const m = (e as Error).message;
      setZohoTestMsg(m);
      toast.error(m);
    } finally {
      setZohoBusy(false);
    }
  }

  async function syncZoho() {
    setZohoBusy(true);
    setZohoSyncMsg("");
    try {
      const run = await api.emailSyncRun(zohoSettings?.days || 30);
      const okMsg = `Đã quét xong: ${run.stats?.attachments_found ?? 0} file tìm thấy, ${run.stats?.created_new_draft ?? 0} HĐ mới, ${run.stats?.pdf_attached_to_existing ?? 0} gắn PDF.`;
      setZohoSyncMsg(okMsg);
      toast.success(okMsg);
    } catch (e) {
      const m = (e as Error).message;
      setZohoSyncMsg(m);
      toast.error(m);
    } finally {
      setZohoBusy(false);
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
      setSpxTestMsg(res.message);
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e: unknown) {
      const m = (e as Error)?.message || "Lỗi kiểm tra kết nối SPX";
      setSpxTestMsg(m);
      toast.error(m);
    } finally {
      setSpxBusy(false);
    }
  }

  async function saveSpx() {
    if (!spxSettings) return;
    setSpxBusy(true);
    setSpxTestMsg("");
    try {
      const payload: Partial<SpxSettings> = { ...spxSettings };
      if (spxPass) payload.spx_password = spxPass;
      if (spxApiToken) payload.spx_api_token = spxApiToken;
      if (spxCookies) payload.spx_cookies = spxCookies;
      const res = await saveSpxSettings(payload);
      setSpxSettings(res);
      setSpxPass("");
      setSpxApiToken("");
      setSpxCookies("");
      const okMsg = "Đã lưu cấu hình SPX Express an toàn.";
      setSpxTestMsg(okMsg);
      toast.success(okMsg);
    } catch (e: unknown) {
      const m = (e as Error)?.message || "Lỗi lưu cấu hình SPX";
      setSpxTestMsg(m);
      toast.error(m);
    } finally {
      setSpxBusy(false);
    }
  }

  async function createSvcKey() {
    const clean = svcName.trim();
    if (!clean) {
      const m = "Vui lòng nhập tên ứng dụng (VD: inut-solar-hub).";
      setSvcMsg(m);
      toast.warning(m);
      return;
    }
    const scopes: string[] = [];
    if (svcScopeMail) scopes.push("mail:send");
    if (svcScopeTg) scopes.push("telegram:send");
    if (!scopes.length) {
      const m = "Chọn ít nhất 1 quyền (Email hoặc Telegram).";
      setSvcMsg(m);
      toast.warning(m);
      return;
    }
    setSvcBusy(true);
    setSvcMsg("");
    setSvcNewSecret("");
    try {
      const res = await api.createServiceKey(clean, scopes);
      setSvcNewSecret(res.api_key);
      setSvcName("");
      const okMsg = `Đã tạo Service API Key cho "${res.key.name}". Hãy sao chép ngay vì hệ thống chỉ hiển thị 1 lần.`;
      setSvcMsg(okMsg);
      toast.success(`Đã tạo Service API Key "${res.key.name}".`);
      const latest = await api.listServiceKeys();
      setSvcKeys(latest.keys);
    } catch (e: unknown) {
      const m = `Lỗi tạo key: ${(e as Error)?.message || String(e)}`;
      setSvcMsg(m);
      toast.error(m);
    } finally {
      setSvcBusy(false);
    }
  }

  async function revokeSvcKey(id: number, name: string) {
    setSvcBusy(true);
    setSvcMsg("");
    try {
      await api.revokeServiceKey(id);
      const okMsg = `Đã thu hồi API Key "${name}".`;
      setSvcMsg(okMsg);
      toast.success(okMsg);
      const latest = await api.listServiceKeys();
      setSvcKeys(latest.keys);
    } catch (e: unknown) {
      const m = `Lỗi thu hồi key: ${(e as Error)?.message || String(e)}`;
      setSvcMsg(m);
      toast.error(m);
    } finally {
      setSvcBusy(false);
    }
  }

  const showSection = (group: Exclude<SettingsTab, "all">) =>
    activeTab === "all" || activeTab === group;

  if (!s) {
    return (
      <PageShell data-page="settings">
        <PageHeader
          variant="compact"
          icon="settings"
          eyebrow="SYSTEM CONTROL"
          title="Cài đặt hệ thống"
          subtitle="Quản lý các kết nối dịch vụ của CRM tại một nơi."
        />
        {err ? (
          <InlineAlert
            tone="danger"
            action={
              <AppButton variant="secondary" size="sm" leftIcon="refresh" onClick={load}>
                Thử lại
              </AppButton>
            }
          >
            {err}
          </InlineAlert>
        ) : (
          <SectionCard>
            <SkeletonBlock variant="line" lines={6} />
          </SectionCard>
        )}
      </PageShell>
    );
  }

  const zohoConnected = Boolean(
    zohoSettings &&
      zohoSettings.enabled &&
      ((zohoSettings.mode === "rest_api" &&
        (zohoSettings.has_refresh_token || zohoRefreshToken || zohoGrantToken)) ||
        (zohoSettings.mode === "imap" && (zohoSettings.has_password || zohoPass))),
  );

  return (
    <PageShell data-page="settings">
      <PageHeader
        variant="compact"
        icon="settings"
        eyebrow="SYSTEM CONTROL"
        title="Cài đặt hệ thống"
        subtitle="Quản lý các kết nối dịch vụ của CRM tại một nơi."
        actions={
          <AppButton variant="primary" leftIcon="save" loading={busy} onClick={save}>
            {busy ? "Đang lưu…" : "Lưu tất cả thay đổi"}
          </AppButton>
        }
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {(usingDefaultSecrets || mustChangePassword) && (
        <section role="region" aria-label="Bảo mật tài khoản và khóa hệ thống">
          <SectionCard
            eyebrow="SECURITY ATTENTION"
            title="Cần hoàn tất cấu hình bảo mật"
            subtitle="Cảnh báo được gom tại đây để không che các màn hình vận hành."
            icon="shield-alert"
            padding="compact"
          >
            <div className="ui-stack--sm">
              {usingDefaultSecrets && (
                <InlineAlert tone="warning" title="Mật khẩu/khóa mặc định">
                  Đổi các secret mặc định trong <code className="ui-code">.env</code> trước khi đưa
                  hệ thống ra môi trường thật.
                </InlineAlert>
              )}
              {mustChangePassword && (
                <InlineAlert
                  tone="danger"
                  title="Mật khẩu tạm"
                  action={
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="lock"
                      onClick={onChangePassword}
                    >
                      Đổi mật khẩu tài khoản
                    </AppButton>
                  }
                >
                  Tài khoản hiện tại cần đặt mật khẩu riêng để kết thúc trạng thái khởi tạo.
                </InlineAlert>
              )}
            </div>
          </SectionCard>
        </section>
      )}

      <ResponsiveTabs
        variant="segmented"
        tabs={SETTINGS_TABS}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel="Nhóm cài đặt hệ thống"
      />

      <div className="ui-stack">
        {/* ---- AI ---- */}
        {showSection("ai") && (
          <>
            <SectionCard
              eyebrow="TRÍ TUỆ NHÂN TẠO"
              title="AI Assistant"
              subtitle="9router hoặc endpoint tương thích OpenAI"
              icon="bot"
              actions={
                <StatusBadge tone={s.ai_enabled ? "success" : "neutral"} dot>
                  {s.ai_enabled ? "Đang bật" : "Đang tắt"}
                </StatusBadge>
              }
            >
              <div className="ui-stack">
                <label className="ui-check-label">
                  <input
                    type="checkbox"
                    checked={s.ai_enabled}
                    onChange={(e) => set("ai_enabled", e.target.checked)}
                  />
                  <span>Bật AI (gợi ý BOM, gợi ý dòng hóa đơn…)</span>
                </label>

                <FormGrid cols={2}>
                  <FormField label="Endpoint (base URL)" htmlFor="set-ai-url">
                    <input
                      id="set-ai-url"
                      className="ui-input"
                      value={s.ai_base_url}
                      placeholder="http://127.0.0.1:20128/v1"
                      onChange={(e) => set("ai_base_url", e.target.value)}
                    />
                  </FormField>

                  <FormField
                    htmlFor="set-ai-key"
                    label={
                      <span className="ui-row">
                        <span>API key</span>
                        {s.ai_api_key_set && (
                          <StatusBadge tone="success" size="sm">
                            đã đặt
                          </StatusBadge>
                        )}
                      </span>
                    }
                  >
                    <input
                      id="set-ai-key"
                      className="ui-input"
                      type="password"
                      value={aiKey}
                      placeholder={s.ai_api_key_set ? "•••• (để trống = giữ nguyên)" : "nhập API key"}
                      onChange={(e) => setAiKey(e.target.value)}
                    />
                  </FormField>
                </FormGrid>

                <FormGrid cols={3}>
                  <FormField label="Model" htmlFor="set-ai-model">
                    <input
                      id="set-ai-model"
                      className="ui-input"
                      value={s.ai_model}
                      onChange={(e) => set("ai_model", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Max tokens" htmlFor="set-ai-tokens">
                    <input
                      id="set-ai-tokens"
                      className="ui-input"
                      type="number"
                      value={s.ai_max_tokens}
                      onChange={(e) => set("ai_max_tokens", Number(e.target.value) || 0)}
                    />
                  </FormField>
                  <FormField label="Timeout (s)" htmlFor="set-ai-timeout">
                    <input
                      id="set-ai-timeout"
                      className="ui-input"
                      type="number"
                      value={s.ai_timeout}
                      onChange={(e) => set("ai_timeout", Number(e.target.value) || 0)}
                    />
                  </FormField>
                </FormGrid>

                <hr className="ui-divider" />

                <div className="ui-stack--sm">
                  <div className="ui-row">
                    <span className="ui-muted">Lệnh mẫu:</span>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setAiPrompt("Trả lời đúng một từ: OK")}
                    >
                      Ping
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setAiPrompt(
                          "Tóm tắt trong 3 gạch đầu dòng lợi ích của hệ thống CRM cho doanh nghiệp nhỏ.",
                        )
                      }
                    >
                      Tóm tắt
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setAiPrompt(
                          "Trả về đúng JSON hợp lệ gồm hai khóa: status là ok và model là tên model bạn đang chạy.",
                        )
                      }
                    >
                      Test JSON
                    </AppButton>
                  </div>

                  <FormField label="Prompt chạy thử" htmlFor="set-ai-prompt">
                    <textarea
                      id="set-ai-prompt"
                      className="ui-textarea"
                      rows={2}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Nhập câu hỏi hoặc lệnh muốn thử với LLM…"
                    />
                  </FormField>

                  <div className="ui-row">
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="play"
                      disabled={busy || !aiPrompt.trim()}
                      onClick={testAi}
                    >
                      {busy ? "Đang gọi…" : "Lưu & chạy prompt"}
                    </AppButton>
                    {aiTestMsg && <span className="ui-muted">{aiTestMsg}</span>}
                  </div>
                  {aiReply && <pre className="ui-pre">{aiReply}</pre>}
                </div>
              </div>
            </SectionCard>

            {/* ---- TRAINING RATE LIMITS ---- */}
            <SectionCard
              eyebrow="HERMES TRAINING"
              title="Giới hạn nhịp hỏi"
              subtitle="Cấu hình ngay trên KSP, không cần sửa code"
              icon="activity"
              actions={
                <StatusBadge tone="brand" size="sm">
                  {s.training_rate_limit_per_minute ?? 100}/{s.training_rate_window_seconds ?? 60}s
                </StatusBadge>
              }
            >
              <div className="ui-stack">
                <FormGrid cols={2}>
                  <FormField label="Training nội bộ + Messenger (lần)" htmlFor="set-tr-limit">
                    <input
                      id="set-tr-limit"
                      className="ui-input"
                      type="number"
                      min={1}
                      max={10000}
                      value={s.training_rate_limit_per_minute ?? 100}
                      onChange={(e) =>
                        set(
                          "training_rate_limit_per_minute",
                          Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Cửa sổ (giây)" htmlFor="set-tr-win">
                    <input
                      id="set-tr-win"
                      className="ui-input"
                      type="number"
                      min={1}
                      max={3600}
                      value={s.training_rate_window_seconds ?? 60}
                      onChange={(e) =>
                        set(
                          "training_rate_window_seconds",
                          Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Trợ lý công khai iNut.vn (lần)" htmlFor="set-pub-limit">
                    <input
                      id="set-pub-limit"
                      className="ui-input"
                      type="number"
                      min={1}
                      max={10000}
                      value={s.public_training_rate_limit ?? 20}
                      onChange={(e) =>
                        set(
                          "public_training_rate_limit",
                          Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Cửa sổ công khai (giây)" htmlFor="set-pub-win">
                    <input
                      id="set-pub-win"
                      className="ui-input"
                      type="number"
                      min={1}
                      max={3600}
                      value={s.public_training_rate_window_seconds ?? 60}
                      onChange={(e) =>
                        set(
                          "public_training_rate_window_seconds",
                          Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormField>
                </FormGrid>
                <p className="ui-muted">
                  Mặc định đặt 100 lần/phút. Trang Training hiển thị số đang chạy, hoàn tất, lỗi và
                  bị từ chối.
                </p>
              </div>
            </SectionCard>
          </>
        )}

        {/* ---- NAS ---- */}
        {showSection("nas") && (
          <SectionCard
            eyebrow="LƯU TRỮ NỘI BỘ"
            title="NAS Storage"
            subtitle="Đồng bộ hồ sơ, hóa đơn và chứng từ gốc"
            icon="hard-drive"
            actions={
              <StatusBadge tone={s.nas_enabled ? "success" : "neutral"} dot>
                {s.nas_enabled ? "Đang bật" : "Đang tắt"}
              </StatusBadge>
            }
          >
            <div className="ui-stack">
              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={s.nas_enabled}
                  onChange={(e) => set("nas_enabled", e.target.checked)}
                />
                <span>Bật đồng bộ NAS</span>
              </label>

              <FormGrid cols={2}>
                <FormField label="Host / IP" htmlFor="set-nas-host">
                  <input
                    id="set-nas-host"
                    className="ui-input"
                    value={s.nas_host}
                    onChange={(e) => set("nas_host", e.target.value)}
                  />
                </FormField>
                <FormField label="Share" htmlFor="set-nas-share">
                  <input
                    id="set-nas-share"
                    className="ui-input"
                    value={s.nas_share}
                    onChange={(e) => set("nas_share", e.target.value)}
                  />
                </FormField>
                <FormField label="User" htmlFor="set-nas-user">
                  <input
                    id="set-nas-user"
                    className="ui-input"
                    value={s.nas_user}
                    onChange={(e) => set("nas_user", e.target.value)}
                  />
                </FormField>
                <FormField
                  htmlFor="set-nas-pass"
                  label={
                    <span className="ui-row">
                      <span>Password</span>
                      {s.nas_password_set && (
                        <StatusBadge tone="success" size="sm">
                          đã đặt
                        </StatusBadge>
                      )}
                    </span>
                  }
                >
                  <input
                    id="set-nas-pass"
                    className="ui-input"
                    type="password"
                    value={nasPass}
                    placeholder={
                      s.nas_password_set ? "•••• (để trống = giữ nguyên)" : "nhập mật khẩu"
                    }
                    onChange={(e) => setNasPass(e.target.value)}
                  />
                </FormField>
                <FormField label="Thư mục gốc (base path)" htmlFor="set-nas-base">
                  <input
                    id="set-nas-base"
                    className="ui-input"
                    value={s.nas_base_path}
                    onChange={(e) => set("nas_base_path", e.target.value)}
                  />
                </FormField>
                <FormField label="Timeout (s)" htmlFor="set-nas-timeout">
                  <input
                    id="set-nas-timeout"
                    className="ui-input"
                    type="number"
                    value={s.nas_timeout}
                    onChange={(e) => set("nas_timeout", Number(e.target.value) || 0)}
                  />
                </FormField>
              </FormGrid>

              <div className="ui-row">
                <AppButton variant="secondary" size="sm" leftIcon="wifi" onClick={testNas}>
                  Test kết nối
                </AppButton>
                <AppButton variant="ghost" size="sm" leftIcon="bar-chart" onClick={loadDisk}>
                  Xem dung lượng
                </AppButton>
                {nasTestMsg && <span className="ui-muted">{nasTestMsg}</span>}
              </div>

              {disk &&
                (disk.ok ? (
                  <InlineAlert tone={(disk.percent_used ?? 0) > 90 ? "warning" : "info"}>
                    <div className="ui-stack--sm">
                      <div className="ui-row-between">
                        <span>
                          Đã dùng <strong>{vnd(disk.used_gb ?? 0)} GB</strong> /{" "}
                          {vnd(disk.total_gb ?? 0)} GB
                        </span>
                        <span>
                          Khả dụng: <strong>{vnd(disk.free_gb ?? 0)} GB</strong> (
                          {(100 - (disk.percent_used ?? 0)).toFixed(1)}% trống)
                        </span>
                      </div>
                      <progress
                        className={`ui-progress${(disk.percent_used ?? 0) > 90 ? " ui-progress--danger" : ""}`}
                        value={Math.min(100, disk.percent_used ?? 0)}
                        max={100}
                      />
                    </div>
                  </InlineAlert>
                ) : (
                  <InlineAlert tone="danger">{disk.message}</InlineAlert>
                ))}
            </div>
          </SectionCard>
        )}

        {/* ---- iHOADON & ZOHO ---- */}
        {showSection("invoices") && (
          <>
            <SectionCard
              eyebrow="HÓA ĐƠN ĐIỆN TỬ"
              title="iHOADON"
              subtitle="Đồng bộ và tạo hóa đơn bán ra dạng GHI_TAM (không ký, giữ số hay phát hành)"
              icon="receipt"
              actions={
                <StatusBadge tone={s.ihoadon_enabled ? "success" : "neutral"} dot>
                  {s.ihoadon_enabled ? "Đang kết nối" : "Chưa bật"}
                </StatusBadge>
              }
              footer={
                <>
                  <span className="ui-muted">
                    {ihoadonTestMsg ||
                      (syncStatus
                        ? `${syncStatus.total} hóa đơn cổng khách · ${syncStatus.unmatched} chưa ghép`
                        : "Chưa đồng bộ cổng khách hàng.")}
                  </span>
                  <div className="ui-row">
                    <AppButton variant="secondary" size="sm" disabled={busy} onClick={testIhoadon}>
                      Test kết nối
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="refresh"
                      disabled={busy || syncStatus?.job?.status === "running"}
                      onClick={syncIhoadon}
                    >
                      {syncStatus?.job?.status === "running"
                        ? "Đang đồng bộ…"
                        : "Đồng bộ cổng khách"}
                    </AppButton>
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="save"
                      loading={busy}
                      onClick={save}
                    >
                      {busy ? "Đang lưu…" : "Lưu kết nối iHOADON"}
                    </AppButton>
                  </div>
                </>
              }
            >
              <div className="ui-stack">
                <label className="ui-check-label">
                  <input
                    type="checkbox"
                    checked={s.ihoadon_enabled}
                    onChange={(e) => set("ihoadon_enabled", e.target.checked)}
                  />
                  <span>Bật kết nối iHOADON</span>
                </label>

                <FormGrid cols={2}>
                  <FormField label="Website" htmlFor="set-ihd-url" fullWidth>
                    <input
                      id="set-ihd-url"
                      className="ui-input"
                      value={s.ihoadon_base_url}
                      onChange={(e) => set("ihoadon_base_url", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Mã số thuế" htmlFor="set-ihd-mst">
                    <input
                      id="set-ihd-mst"
                      className="ui-input"
                      value={s.ihoadon_tax_code}
                      onChange={(e) => set("ihoadon_tax_code", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Tên đăng nhập" htmlFor="set-ihd-user">
                    <input
                      id="set-ihd-user"
                      className="ui-input"
                      value={s.ihoadon_username}
                      onChange={(e) => set("ihoadon_username", e.target.value)}
                    />
                  </FormField>
                  <FormField
                    htmlFor="set-ihd-pass"
                    label={
                      <span className="ui-row">
                        <span>Mật khẩu</span>
                        {s.ihoadon_password_set && (
                          <StatusBadge tone="success" size="sm">
                            đã đặt
                          </StatusBadge>
                        )}
                      </span>
                    }
                  >
                    <input
                      id="set-ihd-pass"
                      className="ui-input"
                      type="password"
                      value={ihoadonPass}
                      placeholder={
                        s.ihoadon_password_set
                          ? "•••• (để trống = giữ nguyên)"
                          : "nhập mật khẩu iHOADON"
                      }
                      onChange={(e) => setIhoadonPass(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Timeout (s)" htmlFor="set-ihd-timeout">
                    <input
                      id="set-ihd-timeout"
                      className="ui-input"
                      type="number"
                      value={s.ihoadon_timeout}
                      onChange={(e) => set("ihoadon_timeout", Number(e.target.value) || 30)}
                    />
                  </FormField>
                </FormGrid>

                {syncStatus?.job && (
                  <p className="ui-muted">
                    Lần gần nhất: {syncStatus.job.status} ·{" "}
                    {new Date(syncStatus.job.started_at).toLocaleString("vi-VN")} ·{" "}
                    {syncStatus.job.stats.seen ?? 0} hóa đơn, {syncStatus.job.stats.errors ?? 0} lỗi
                    file.
                  </p>
                )}

                {unmatched.length > 0 && (
                  <div className="ui-stack--sm">
                    <h4 className="ui-subhead">Hóa đơn chưa ghép MST ({unmatched.length})</h4>
                    {unmatched.slice(0, 20).map((inv) => (
                      <div className="ui-link-row" key={inv.id}>
                        <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                          <strong>
                            {inv.invoice_date} · {inv.invoice_series} {inv.invoice_number}
                          </strong>
                          <small>
                            {inv.buyer_name} · MST {inv.buyer_tax_code || "trống"}
                          </small>
                        </span>
                        <select
                          className="ui-select ui-grow"
                          defaultValue=""
                          aria-label={`Chọn khách hàng cho hóa đơn ${inv.invoice_number}`}
                          onChange={(e) => void assignInvoice(inv.id, Number(e.target.value))}
                        >
                          <option value="">Chọn khách hàng…</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.tax_code}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>

            {zohoSettings && (
              <SectionCard
                eyebrow="HỘP THƯ HÓA ĐƠN"
                title={`Zoho Mail (${zohoSettings.mode === "rest_api" ? "REST API OAuth 2.0" : "IMAP Sync"})`}
                subtitle="Tự động quét tệp PDF / XML hóa đơn mua vào gửi về hộp thư"
                icon="mail"
                actions={
                  <StatusBadge tone={zohoConnected ? "success" : "neutral"} dot>
                    {zohoSettings.enabled ? "Đang bật" : "Đang tắt"}
                  </StatusBadge>
                }
                footer={
                  <>
                    <span className="ui-muted">
                      {zohoTestMsg ||
                        zohoSyncMsg ||
                        (zohoSettings.mode === "rest_api"
                          ? "Zoho REST API OAuth 2.0 hoàn toàn miễn phí."
                          : "IMAP SSL dùng App Password.")}
                    </span>
                    <div className="ui-row">
                      <AppButton
                        variant="secondary"
                        size="sm"
                        disabled={zohoBusy}
                        onClick={testZoho}
                      >
                        Test kết nối
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="refresh"
                        disabled={
                          zohoBusy ||
                          (zohoSettings.mode === "rest_api"
                            ? !zohoSettings.has_refresh_token &&
                              !zohoRefreshToken &&
                              !zohoGrantToken
                            : !zohoSettings.has_password)
                        }
                        onClick={syncZoho}
                      >
                        {zohoBusy ? "Đang quét…" : "Quét email ngay"}
                      </AppButton>
                      <AppButton
                        variant="primary"
                        size="sm"
                        leftIcon="save"
                        loading={zohoBusy}
                        onClick={saveZoho}
                      >
                        {zohoBusy ? "Đang lưu…" : "Lưu cấu hình Zoho"}
                      </AppButton>
                    </div>
                  </>
                }
              >
                <div className="ui-stack">
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={zohoSettings.enabled}
                      onChange={(e) =>
                        setZohoSettings({ ...zohoSettings, enabled: e.target.checked })
                      }
                    />
                    <span>Bật tự động quét &amp; đồng bộ hóa đơn từ Zoho Mail</span>
                  </label>

                  <div className="cm-toggle-bar">
                    <label className="ui-check-label">
                      <input
                        type="radio"
                        name="settings_zoho_mode"
                        checked={zohoSettings.mode === "rest_api"}
                        onChange={() => setZohoSettings({ ...zohoSettings, mode: "rest_api" })}
                      />
                      <strong>Zoho REST API (OAuth 2.0)</strong>
                      <StatusBadge tone="success" size="sm">
                        Khuyên dùng
                      </StatusBadge>
                    </label>
                    <label className="ui-check-label">
                      <input
                        type="radio"
                        name="settings_zoho_mode"
                        checked={zohoSettings.mode === "imap"}
                        onChange={() => setZohoSettings({ ...zohoSettings, mode: "imap" })}
                      />
                      <strong>IMAP SSL</strong>
                    </label>
                  </div>

                  {zohoSettings.mode === "rest_api" ? (
                    <>
                      <FormGrid cols={2}>
                        <FormField label="Client ID" htmlFor="set-zoho-cid">
                          <input
                            id="set-zoho-cid"
                            className="ui-input"
                            value={zohoSettings.client_id}
                            placeholder="1000.XXXXXXXXXX..."
                            onChange={(e) =>
                              setZohoSettings({ ...zohoSettings, client_id: e.target.value })
                            }
                          />
                        </FormField>
                        <FormField
                          htmlFor="set-zoho-csec"
                          label={
                            <span className="ui-row">
                              <span>Client Secret</span>
                              {zohoSettings.has_client_secret && (
                                <StatusBadge tone="success" size="sm">
                                  đã đặt
                                </StatusBadge>
                              )}
                            </span>
                          }
                        >
                          <input
                            id="set-zoho-csec"
                            className="ui-input"
                            type="password"
                            value={zohoClientSecret}
                            placeholder={
                              zohoSettings.has_client_secret
                                ? "•••• (để trống = giữ nguyên)"
                                : "nhập Client Secret"
                            }
                            onChange={(e) => setZohoClientSecret(e.target.value)}
                          />
                        </FormField>
                        <FormField
                          htmlFor="set-zoho-grant"
                          label={
                            <span className="ui-row">
                              <span>Mã Code một lần (Grant Token)</span>
                              {zohoSettings.has_refresh_token && (
                                <StatusBadge tone="success" size="sm">
                                  Đã có Refresh Token
                                </StatusBadge>
                              )}
                            </span>
                          }
                        >
                          <input
                            id="set-zoho-grant"
                            className="ui-input"
                            value={zohoGrantToken}
                            placeholder={
                              zohoSettings.has_refresh_token
                                ? "Đã cấp token (nhập code mới nếu cấp lại)"
                                : "1000.xxxx (Tạo từ Zoho Console -> Generate Code)"
                            }
                            onChange={(e) => setZohoGrantToken(e.target.value)}
                          />
                        </FormField>
                        <FormField label="Số ngày quét mặc định" htmlFor="set-zoho-days">
                          <input
                            id="set-zoho-days"
                            className="ui-input"
                            type="number"
                            value={zohoSettings.days}
                            onChange={(e) =>
                              setZohoSettings({
                                ...zohoSettings,
                                days: Number(e.target.value) || 30,
                              })
                            }
                          />
                        </FormField>
                      </FormGrid>

                      <InlineAlert tone="info" title="Hướng dẫn tạo OAuth miễn phí">
                        Truy cập{" "}
                        <a
                          href="https://api-console.zoho.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Zoho Developer Console (api-console.zoho.com)
                        </a>{" "}
                        -&gt; Add Client -&gt; Self Client -&gt; Copy Client ID &amp; Client Secret
                        -&gt; Tab Generate Code nhập Scope{" "}
                        <code className="ui-code">
                          ZohoMail.messages.READ,ZohoMail.accounts.READ
                        </code>{" "}
                        (10 minutes) rồi dán vào đây và bấm Test kết nối.
                      </InlineAlert>
                    </>
                  ) : (
                    <FormGrid cols={2}>
                      <FormField label="Máy chủ IMAP" htmlFor="set-imap-host">
                        <input
                          id="set-imap-host"
                          className="ui-input"
                          value={zohoSettings.server}
                          placeholder="imappro.zoho.com"
                          onChange={(e) =>
                            setZohoSettings({ ...zohoSettings, server: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField label="Cổng SSL" htmlFor="set-imap-port">
                        <input
                          id="set-imap-port"
                          className="ui-input"
                          type="number"
                          value={zohoSettings.port}
                          placeholder="993"
                          onChange={(e) =>
                            setZohoSettings({
                              ...zohoSettings,
                              port: Number(e.target.value) || 993,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Tài khoản Email" htmlFor="set-imap-user">
                        <input
                          id="set-imap-user"
                          className="ui-input"
                          value={zohoSettings.username}
                          placeholder="khanhnhn@inut.vn"
                          onChange={(e) =>
                            setZohoSettings({ ...zohoSettings, username: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField
                        htmlFor="set-imap-pass"
                        label={
                          <span className="ui-row">
                            <span>Mật khẩu ứng dụng (App Password)</span>
                            {zohoSettings.has_password && (
                              <StatusBadge tone="success" size="sm">
                                đã đặt
                              </StatusBadge>
                            )}
                          </span>
                        }
                      >
                        <input
                          id="set-imap-pass"
                          className="ui-input"
                          type="password"
                          value={zohoPass}
                          placeholder={
                            zohoSettings.has_password
                              ? "•••• (để trống = giữ nguyên)"
                              : "nhập App Password Zoho"
                          }
                          onChange={(e) => setZohoPass(e.target.value)}
                        />
                      </FormField>
                      <FormField label="Hộp thư (Mailbox)" htmlFor="set-imap-box">
                        <input
                          id="set-imap-box"
                          className="ui-input"
                          value={zohoSettings.mailbox}
                          placeholder="INBOX"
                          onChange={(e) =>
                            setZohoSettings({ ...zohoSettings, mailbox: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField label="Số ngày quét mặc định" htmlFor="set-imap-days">
                        <input
                          id="set-imap-days"
                          className="ui-input"
                          type="number"
                          value={zohoSettings.days}
                          onChange={(e) =>
                            setZohoSettings({
                              ...zohoSettings,
                              days: Number(e.target.value) || 30,
                            })
                          }
                        />
                      </FormField>
                    </FormGrid>
                  )}
                </div>
              </SectionCard>
            )}
          </>
        )}

        {/* ---- SPX EXPRESS ---- */}
        {showSection("logistics") && spxSettings && (
          <SectionCard
            eyebrow="GIAO HÀNG & LOGISTICS"
            title="Vận đơn SPX Express (spx.vn)"
            subtitle="Tự động tạo đơn, lấy mã vận đơn SPXVN & in tem nhiệt khổ A6"
            icon="truck"
            actions={
              <StatusBadge tone={spxSettings.spx_username ? "success" : "neutral"} dot>
                {spxSettings.spx_username ? "Đã liên thông" : "Chưa cấu hình"}
              </StatusBadge>
            }
            footer={
              <>
                <span className="ui-muted">
                  {spxTestMsg || "Liên thông trực tiếp cổng SPX Express & In tem nhãn nhiệt A6."}
                </span>
                <div className="ui-row">
                  <AppButton variant="secondary" size="sm" disabled={spxBusy} onClick={testSpx}>
                    {spxBusy ? "Đang kiểm tra…" : "Test kết nối SPX"}
                  </AppButton>
                  <AppButton
                    variant="primary"
                    size="sm"
                    leftIcon="save"
                    loading={spxBusy}
                    onClick={saveSpx}
                  >
                    {spxBusy ? "Đang lưu…" : "Lưu cấu hình SPX"}
                  </AppButton>
                </div>
              </>
            }
          >
            <div className="ui-stack">
              <FormGrid cols={2}>
                <FormField label="Tài khoản / SĐT đăng nhập SPX" htmlFor="set-spx-user">
                  <input
                    id="set-spx-user"
                    className="ui-input"
                    value={spxSettings.spx_username}
                    placeholder="0345296757"
                    onChange={(e) =>
                      setSpxSettings({ ...spxSettings, spx_username: e.target.value })
                    }
                  />
                </FormField>
                <FormField
                  htmlFor="set-spx-pass"
                  label={
                    <span className="ui-row">
                      <span>Mật khẩu SPX</span>
                      {spxSettings.spx_password && (
                        <StatusBadge tone="success" size="sm">
                          đã lưu AES-128
                        </StatusBadge>
                      )}
                    </span>
                  }
                >
                  <input
                    id="set-spx-pass"
                    className="ui-input"
                    type="password"
                    value={spxPass}
                    placeholder="để trống = giữ nguyên"
                    onChange={(e) => setSpxPass(e.target.value)}
                  />
                </FormField>
                <FormField label="Shop ID (Tùy chọn)" htmlFor="set-spx-shop">
                  <input
                    id="set-spx-shop"
                    className="ui-input"
                    value={spxSettings.spx_shop_id}
                    placeholder="Mã Shop trên SPX Portal (nếu có)"
                    onChange={(e) =>
                      setSpxSettings({ ...spxSettings, spx_shop_id: e.target.value })
                    }
                  />
                </FormField>
                <FormField
                  htmlFor="set-spx-token"
                  label={
                    <span className="ui-row">
                      <span>API Token / Secret Key (Tùy chọn)</span>
                      {spxSettings.spx_api_token && (
                        <StatusBadge tone="success" size="sm">
                          đã có token
                        </StatusBadge>
                      )}
                    </span>
                  }
                >
                  <input
                    id="set-spx-token"
                    className="ui-input"
                    type="password"
                    value={spxApiToken}
                    placeholder="API Key do SPX cấp (nếu có)"
                    onChange={(e) => setSpxApiToken(e.target.value)}
                  />
                </FormField>
                <FormField
                  htmlFor="set-spx-cookies"
                  fullWidth
                  label={
                    <span className="ui-row">
                      <span>Session Cookies (SPC_EC / spx_sid / spx_token)</span>
                      {spxSettings.spx_cookies && (
                        <StatusBadge tone="success" size="sm">
                          đã lưu phiên Live
                        </StatusBadge>
                      )}
                    </span>
                  }
                >
                  <input
                    id="set-spx-cookies"
                    className="ui-input"
                    type="password"
                    value={spxCookies}
                    placeholder="Dán chuỗi Cookie từ trình duyệt (để trống = giữ nguyên)"
                    onChange={(e) => setSpxCookies(e.target.value)}
                  />
                </FormField>
              </FormGrid>

              <hr className="ui-divider" />

              <h4 className="ui-subhead">Thông tin kho người gửi mặc định</h4>
              <FormGrid cols={2}>
                <FormField label="Tên Shop / Doanh nghiệp" htmlFor="set-spx-sname">
                  <input
                    id="set-spx-sname"
                    className="ui-input"
                    value={spxSettings.spx_sender_name}
                    placeholder="CÔNG TY CP ĐT & PT CÔNG NGHỆ INUT"
                    onChange={(e) =>
                      setSpxSettings({ ...spxSettings, spx_sender_name: e.target.value })
                    }
                  />
                </FormField>
                <FormField label="Số điện thoại kho" htmlFor="set-spx-sphone">
                  <input
                    id="set-spx-sphone"
                    className="ui-input"
                    value={spxSettings.spx_sender_phone}
                    placeholder="0345296757"
                    onChange={(e) =>
                      setSpxSettings({ ...spxSettings, spx_sender_phone: e.target.value })
                    }
                  />
                </FormField>
                <FormField label="Địa chỉ kho lấy hàng" htmlFor="set-spx-saddr" fullWidth>
                  <input
                    id="set-spx-saddr"
                    className="ui-input"
                    value={spxSettings.spx_sender_address}
                    placeholder="Khu Công Nghệ Cao, TP. Thủ Đức, TP. Hồ Chí Minh"
                    onChange={(e) =>
                      setSpxSettings({ ...spxSettings, spx_sender_address: e.target.value })
                    }
                  />
                </FormField>
              </FormGrid>
            </div>
          </SectionCard>
        )}

        {/* ---- SMTP & SERVICE API KEYS ---- */}
        {showSection("relay") && (
          <>
            <SectionCard
              eyebrow="CẢNH BÁO VẬN HÀNH"
              title="Email SMTP"
              subtitle="Thông báo khi phiên thuế hết hạn hoặc cron thất bại"
              icon="mail"
              actions={
                <StatusBadge
                  tone={s.smtp_host && s.smtp_password_set ? "success" : "neutral"}
                  dot
                >
                  {s.smtp_host && s.smtp_password_set ? "Đã cấu hình" : "Chưa đủ"}
                </StatusBadge>
              }
            >
              <FormGrid cols={2}>
                <FormField label="SMTP host" htmlFor="set-smtp-host">
                  <input
                    id="set-smtp-host"
                    className="ui-input"
                    value={s.smtp_host}
                    onChange={(e) => set("smtp_host", e.target.value)}
                    placeholder="smtp.gmail.com"
                  />
                </FormField>
                <FormField label="Port" htmlFor="set-smtp-port">
                  <input
                    id="set-smtp-port"
                    className="ui-input"
                    type="number"
                    value={s.smtp_port}
                    onChange={(e) => set("smtp_port", Number(e.target.value) || 587)}
                  />
                </FormField>
                <FormField label="Tài khoản" htmlFor="set-smtp-user">
                  <input
                    id="set-smtp-user"
                    className="ui-input"
                    value={s.smtp_username}
                    onChange={(e) => set("smtp_username", e.target.value)}
                  />
                </FormField>
                <FormField
                  htmlFor="set-smtp-pass"
                  label={
                    <span className="ui-row">
                      <span>Mật khẩu</span>
                      {s.smtp_password_set && (
                        <StatusBadge tone="success" size="sm">
                          đã đặt
                        </StatusBadge>
                      )}
                    </span>
                  }
                >
                  <input
                    id="set-smtp-pass"
                    className="ui-input"
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder="để trống = giữ nguyên"
                  />
                </FormField>
                <FormField label="Email gửi" htmlFor="set-smtp-from">
                  <input
                    id="set-smtp-from"
                    className="ui-input"
                    value={s.smtp_from}
                    onChange={(e) => set("smtp_from", e.target.value)}
                  />
                </FormField>
                <FormField label="Email nhận" htmlFor="set-smtp-to">
                  <input
                    id="set-smtp-to"
                    className="ui-input"
                    value={s.smtp_to}
                    onChange={(e) => set("smtp_to", e.target.value)}
                  />
                </FormField>
              </FormGrid>
            </SectionCard>

            <SectionCard
              eyebrow="HỆ SINH THÁI INUT · RELAY API"
              title="Service API Keys (Email & Telegram Relay)"
              subtitle="Cấp khóa có phân quyền cho hệ thống ngoài (như iNut Solar Hub) gửi Email và Telegram qua KSP"
              icon="key"
              actions={
                <StatusBadge
                  tone={svcKeys.some((k) => k.is_active) ? "success" : "neutral"}
                  dot
                >
                  {svcKeys.filter((k) => k.is_active).length} đang hoạt động
                </StatusBadge>
              }
              footer={
                <>
                  <span className="ui-muted">
                    {svcMsg || "Khóa chỉ lưu băm SHA-256 trong CSDL và có thể thu hồi tức thì."}
                  </span>
                  <AppButton
                    variant="primary"
                    size="sm"
                    leftIcon="plus"
                    loading={svcBusy}
                    onClick={createSvcKey}
                  >
                    {svcBusy ? "Đang tạo…" : "Tạo Service API Key"}
                  </AppButton>
                </>
              }
            >
              <div className="ui-stack">
                <FormGrid cols={2}>
                  <FormField label="Tên ứng dụng / dịch vụ" htmlFor="set-svc-name">
                    <input
                      id="set-svc-name"
                      className="ui-input"
                      value={svcName}
                      onChange={(e) => setSvcName(e.target.value)}
                      placeholder="inut-solar-hub"
                    />
                  </FormField>
                  <FormField label="Phạm vi quyền (Scopes)">
                    <div className="cm-toggle-bar">
                      <label className="ui-check-label">
                        <input
                          type="checkbox"
                          checked={svcScopeMail}
                          onChange={(e) => setSvcScopeMail(e.target.checked)}
                        />
                        <span>mail:send (Email + Đính kèm)</span>
                      </label>
                      <label className="ui-check-label">
                        <input
                          type="checkbox"
                          checked={svcScopeTg}
                          onChange={(e) => setSvcScopeTg(e.target.checked)}
                        />
                        <span>telegram:send (Bot Telegram)</span>
                      </label>
                    </div>
                  </FormField>
                </FormGrid>

                {svcNewSecret && (
                  <InlineAlert
                    tone="info"
                    title="API Key mới (chỉ hiển thị 1 lần duy nhất)"
                    action={
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="copy"
                        onClick={() => {
                          void navigator.clipboard?.writeText(svcNewSecret);
                          const okMsg = "Đã sao chép API Key vào clipboard.";
                          setSvcMsg(okMsg);
                          toast.success(okMsg);
                        }}
                      >
                        Sao chép
                      </AppButton>
                    }
                  >
                    <code className="ui-code">{svcNewSecret}</code>
                  </InlineAlert>
                )}

                {svcKeys.length === 0 ? (
                  <EmptyState
                    icon="key"
                    title="Chưa có Service API Key nào"
                    description="Tạo khóa mới phía trên để cấp quyền gửi Email hoặc Telegram cho hệ thống ngoài."
                    compact
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="ui-kv-table">
                      <thead>
                        <tr>
                          <th>Ứng dụng</th>
                          <th>Prefix</th>
                          <th>Scopes</th>
                          <th>Dùng gần nhất</th>
                          <th>Trạng thái</th>
                          <th className="ui-text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {svcKeys.map((k) => (
                          <tr key={k.id}>
                            <td>
                              <strong>{k.name}</strong>
                            </td>
                            <td>
                              <code className="ui-code">{k.key_prefix}</code>
                            </td>
                            <td>{k.scopes.join(", ")}</td>
                            <td>
                              {k.last_used_at
                                ? k.last_used_at.slice(0, 16).replace("T", " ")
                                : "Chưa dùng"}
                            </td>
                            <td>
                              <StatusBadge tone={k.is_active ? "success" : "neutral"} size="sm">
                                {k.is_active ? "Hoạt động" : "Đã thu hồi"}
                              </StatusBadge>
                            </td>
                            <td className="ui-text-right">
                              {k.is_active && (
                                <AppButton
                                  variant="danger"
                                  size="sm"
                                  disabled={svcBusy}
                                  onClick={() => void revokeSvcKey(k.id, k.name)}
                                >
                                  Thu hồi
                                </AppButton>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </SectionCard>
          </>
        )}
      </div>

      <div className="ui-sticky-bar ui-sticky-bar--bottom">
        <div className="ui-stack--sm">
          <strong>Sẵn sàng áp dụng thay đổi</strong>
          <small className="ui-muted">Cấu hình được mã hóa và có hiệu lực ngay.</small>
        </div>
        <AppButton variant="primary" leftIcon="save" loading={busy} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu cấu hình"}
        </AppButton>
      </div>
    </PageShell>
  );
}
