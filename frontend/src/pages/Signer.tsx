import { useEffect, useId, useRef, useState } from "react";
import { api, type Customer, type Rect } from "../api";
import { PdfCanvas } from "../components/PdfCanvas";
import { CertPicker } from "../components/CertPicker";
import { defaultPassword, slugUsername } from "../util";
import {
  AppButton,
  AppIcon,
  AppModal,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SectionCard,
  SplitWorkspace,
  StatusBadge,
  useToast,
} from "../components/ui";

interface ZipFileEntry {
  doc_id: string;
  filename: string;
  size: number;
  signed?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export function Signer({
  defaultIp,
  defaultLocation,
  preSign,
  onOpenDocument,
}: {
  defaultIp: string;
  defaultLocation: string;
  preSign?: {
    docId: string;
    filename: string;
    docType: string;
    customerId: number | null;
    orderId?: number | null;
    existingDocumentId?: number | null;
  } | null;
  onOpenDocument?: (docPk: number) => void;
}) {
  const toast = useToast();
  const baseId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [docId, setDocId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);
  const [zipFiles, setZipFiles] = useState<ZipFileEntry[]>([]);
  const [mobileStep, setMobileStep] = useState<"doc" | "sign">("doc");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [ip, setIp] = useState(defaultIp);
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [certId, setCertId] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState(defaultLocation || "");

  // Watermark logo state with safe broken-image fallback (0 broken <img>)
  const [logoUrl, setLogoUrl] = useState(() => api.logoUrl());
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");

  // Quick-create customer modal (replaces native window.prompt/window.alert)
  const [createOpen, setCreateOpen] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustMst, setNewCustMst] = useState("");
  const [creatingCust, setCreatingCust] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    name: string;
    username: string;
    password: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [documentId, setDocumentId] = useState<number | null>(null);

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

  // Nạp BBBG / hồ sơ chuyển sang ký số (bỏ qua bước upload)
  useEffect(() => {
    if (preSign) {
      setDocId(preSign.docId);
      setFilename(preSign.filename);
      setRect(null);
      setDownloadUrl("");
      setDocumentId(null);
      setZipFiles([]);
      setMobileStep("doc");
      if (preSign.customerId != null) setCustomerId(String(preSign.customerId));
    }
  }, [preSign]);

  async function processFile(f: File) {
    setErr("");
    setDownloadUrl("");
    setDocumentId(null);
    setRect(null);
    setUploading(true);
    const isZip = f.name.toLowerCase().endsWith(".zip") || f.type.includes("zip");
    try {
      if (isZip) {
        const r = await api.uploadZip(f);
        setZipFiles(r.files.map((x) => ({ ...x, signed: false })));
        setDocId(null);
        setFilename("");
        toast.info(`Đã giải nén ${r.files.length} tệp PDF từ gói ZIP.`);
      } else {
        setZipFiles([]);
        const r = await api.upload(f);
        setDocId(r.doc_id);
        setFilename(r.filename);
      }
      setMobileStep("doc");
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await processFile(f);
  }

  function onDropFile(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  }

  // Chọn 1 file trong danh sách ZIP để xem/ký (không đóng tab, ký xong chọn file kế)
  function pickZipFile(zf: ZipFileEntry) {
    setDocId(zf.doc_id);
    setFilename(zf.filename);
    setRect(null);
    setDownloadUrl("");
    setDocumentId(null);
    setMobileStep("doc");
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoBusy(true);
    try {
      await api.uploadLogo(f);
      setLogoFailed(false);
      setLogoUrl(api.logoUrl());
      toast.success("Đã cập nhật logo chữ ký.");
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function onResetLogo() {
    setLogoBusy(true);
    try {
      await api.resetLogo();
      setLogoFailed(false);
      setLogoUrl(api.logoUrl());
      toast.success("Đã khôi phục logo mặc định (INUT).");
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = newCustName.trim();
    if (!trimmedName) {
      toast.warning("Vui lòng nhập tên công ty hoặc khách hàng.");
      return;
    }
    setCreatingCust(true);
    const trimmedMst = newCustMst.trim();
    const username = slugUsername(trimmedName);
    const password = defaultPassword(trimmedMst);
    try {
      const created = await api.createCustomer({
        name: trimmedName,
        tax_code: trimmedMst,
        account_username: username,
        account_password: password,
      });
      setCustomers(await api.listCustomers());
      setCustomerId(String(created.id));
      setCreatedCreds({ name: trimmedName, username, password });
      setCreateOpen(false);
      setNewCustName("");
      setNewCustMst("");
      toast.success(`Đã tạo khách hàng "${trimmedName}".`);
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setCreatingCust(false);
    }
  }

  async function doSign() {
    if (!docId || !rect || !certId) return;
    setBusy(true);
    setErr("");
    setDownloadUrl("");
    try {
      const r = await api.sign({
        doc_id: docId,
        rect,
        cert_id: certId,
        agent: { ip, admin_password: adminPassword, pin },
        reason,
        location,
        signer_name: "",
        filename,
        customer_id: customerId === "" ? null : Number(customerId),
        doc_type: preSign?.docType || "",
        order_id: preSign?.orderId ?? null,
        existing_document_id: preSign?.existingDocumentId ?? null,
      });
      setDownloadUrl(r.download_url);
      setDocumentId(r.document_id);
      if (zipFiles.length) {
        setZipFiles((prev) =>
          prev.map((z) => (z.doc_id === docId ? { ...z, signed: true } : z)),
        );
      }
      setMobileStep("sign");
      toast.success("Đã ký số và lưu tài liệu vào hồ sơ.");
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const readyToSign = Boolean(docId && rect && certId && !busy);
  const signedZipCount = zipFiles.filter((z) => z.signed).length;

  const renderZipList = (keyPrefix: string) => (
    <div className="zip-list">
      <div className="ui-row-between ui-muted">
        <span>
          {zipFiles.length} tệp trong ZIP — chọn từng tệp để ký lần lượt
        </span>
        {signedZipCount > 0 && (
          <StatusBadge tone="success" size="sm">
            {signedZipCount}/{zipFiles.length} đã ký
          </StatusBadge>
        )}
      </div>
      {zipFiles.map((zf) => (
        <AppButton
          key={`${keyPrefix}${zf.doc_id}`}
          variant="ghost"
          size="sm"
          className={
            "zip-item" +
            (docId === zf.doc_id ? " active" : "") +
            (zf.signed ? " signed" : "")
          }
          onClick={() => pickZipFile(zf)}
        >
          <span className="zip-name">
            {zf.signed && (
              <AppIcon
                name="check-circle"
                size={14}
                className="ui-text-success ui-shrink-0"
              />
            )}
            <span>{zf.filename}</span>
          </span>
          <span className="ui-muted ui-shrink-0 num">{formatSize(zf.size)}</span>
        </AppButton>
      ))}
    </div>
  );

  const sidebarContent = (
    <div className="ui-stack">
      {preSign && (
        <InlineAlert tone="info" title="Tài liệu nạp sẵn để ký số">
          {preSign.existingDocumentId
            ? `Đang ký đối ứng cho hồ sơ #${preSign.existingDocumentId}: ${preSign.filename}`
            : preSign.filename}
        </InlineAlert>
      )}

      <SectionCard
        padding="compact"
        icon="upload"
        title="1. Tải tài liệu & Vị trí ký"
      >
        <label
          className={`ui-dropzone ui-dropzone--vertical${dragActive ? " is-dragging" : ""}${filename ? " has-file" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDropFile}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.zip"
            className="sr-only"
            aria-label="Chọn tệp PDF hoặc ZIP cần ký"
            onChange={onUpload}
          />
          <span className="ui-dropzone-icon ui-dropzone-icon--pill" aria-hidden="true">
            <AppIcon name={uploading ? "loader" : "upload"} size={20} className={uploading ? "ui-spin" : undefined} />
          </span>
          <span className="ui-text-semibold ui-wrap">
            {uploading
              ? "Đang tải tệp lên…"
              : filename
                ? "Đổi tệp PDF hoặc ZIP"
                : "Chọn tệp PDF hoặc ZIP"}
          </span>
          <span className="ui-muted">
            Kéo thả tệp vào đây hoặc nhấn để chọn từ máy
          </span>
        </label>

        {filename && zipFiles.length === 0 && (
          <div className="ui-subpanel ui-row ui-row--nowrap ui-mt-2">
            <AppIcon name="file-text" size={15} className="ui-text-brand ui-shrink-0" />
            <span className="ui-text-xs ui-text-semibold ui-truncate" title={filename}>
              {filename}
            </span>
          </div>
        )}

        {zipFiles.length > 0 && renderZipList("d-")}

        <div className="ui-stack--sm ui-divider-top">
          <div className="ui-inline ui-text-xs ui-text-semibold">
            <AppIcon name="pen-tool" size={14} />
            <span>Vùng chữ ký</span>
          </div>
          {rect ? (
            <StatusBadge tone="success" size="sm" icon="check-circle" className="num">
              Trang {rect.page + 1} · ({Math.round(rect.x1)}, {Math.round(rect.y1)}) – (
              {Math.round(rect.x2)}, {Math.round(rect.y2)}) pt
            </StatusBadge>
          ) : (
            <span className="ui-muted">
              Kéo chuột hoặc chạm kéo trên trang PDF để chọn vị trí ký.
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard
        padding="compact"
        icon="key"
        title="2. Máy token & Chứng thư số"
      >
        <FormGrid cols={2} className="signer-token-grid">
          <FormField label="IP máy Windows" htmlFor={`${baseId}-ip`} fullWidth>
            <input
              id={`${baseId}-ip`}
              className="ui-input num"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.x"
            />
          </FormField>
          <FormField label="Mã PIN token" htmlFor={`${baseId}-pin`}>
            <input
              id={`${baseId}-pin`}
              className="ui-input"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </FormField>
          <FormField label="Mật khẩu Admin" htmlFor={`${baseId}-admin`}>
            <input
              id={`${baseId}-admin`}
              className="ui-input"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </FormField>
        </FormGrid>

        <div className="ui-stack--sm ui-divider-top">
          <span className="ui-text-xs ui-text-strong">Chứng thư số (WIN-CA)</span>
          <CertPicker
            ip={ip}
            adminPassword={adminPassword}
            value={certId}
            onChange={setCertId}
          />
        </div>
      </SectionCard>

      <SectionCard
        padding="compact"
        icon="sliders-horizontal"
        title="3. Tuỳ chọn & Ký số"
      >
        <div className="ui-stack--sm ui-divider-top">
          <span className="ui-text-xs ui-text-strong">Logo chữ ký (chìm)</span>
          <div className="ui-logo-box">
            <div className="ui-logo-frame ui-logo-frame--sm">
              {!logoFailed ? (
                <img
                  src={logoUrl}
                  alt="Logo chữ ký chìm"
                  className="signer-logo-img"
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth === 0) setLogoFailed(true);
                  }}
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div className="ui-logo-fallback" aria-label="Logo mặc định INUT">
                  <AppIcon name="stamp" size={22} />
                  <span>INUT</span>
                </div>
              )}
            </div>
            <div className="ui-stack--sm ui-flex-1">
              <p className="ui-muted">
                Logo chìm mờ trên chữ ký. Mặc định là logo INUT.
              </p>
              <div className="ui-row">
                <label className="ui-btn ui-btn--secondary ui-btn--sm signer-logo-upload-btn">
                  <AppIcon name="upload" size={14} />
                  <span>{logoBusy ? "Đang tải…" : "Đổi logo"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={logoBusy}
                    onChange={onLogoFile}
                  />
                </label>
                <AppButton
                  variant="ghost"
                  size="sm"
                  leftIcon="rotate-ccw"
                  disabled={logoBusy}
                  onClick={onResetLogo}
                >
                  Mặc định
                </AppButton>
              </div>
            </div>
          </div>
        </div>

        <FormGrid cols={2} className="ui-mt-3">
          <FormField label="Lý do ký" htmlFor={`${baseId}-reason`}>
            <input
              id={`${baseId}-reason`}
              className="ui-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tuỳ chọn"
            />
          </FormField>
          <FormField label="Nơi ký" htmlFor={`${baseId}-loc`}>
            <input
              id={`${baseId}-loc`}
              className="ui-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FormField>
          <FormField label="Phân loại khách hàng" htmlFor={`${baseId}-cust`} fullWidth>
            <select
              id={`${baseId}-cust`}
              className="ui-select"
              value={customerId}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setCreateOpen(true);
                  return;
                }
                setCustomerId(e.target.value);
              }}
            >
              <option value="">— để trống, phân loại sau ở tab Hồ sơ —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">+ Tạo khách hàng mới…</option>
            </select>
          </FormField>
        </FormGrid>

        {createdCreds && (
          <InlineAlert
            tone="success"
            title={`Đã tạo tài khoản cho ${createdCreds.name}`}
            onDismiss={() => setCreatedCreds(null)}
          >
            Tài khoản: <b>{createdCreds.username}</b> · Mật khẩu tạm:{" "}
            <b className="num">{createdCreds.password}</b>
          </InlineAlert>
        )}

        {err && (
          <InlineAlert tone="danger" onDismiss={() => setErr("")}>
            {err}
          </InlineAlert>
        )}

        <div className="ui-mt-3">
          <AppButton
            variant="primary"
            size="lg"
            fullWidth
            leftIcon="file-signature"
            loading={busy}
            disabled={!readyToSign}
            onClick={doSign}
          >
            {busy ? "Đang ký…" : "Ký số"}
          </AppButton>
        </div>

        {downloadUrl && (
          <InlineAlert tone="success" title="Đã ký và lưu vào hồ sơ.">
            <div className="ui-row ui-mt-2">
              <a className="ui-btn ui-btn--primary ui-btn--sm download" href={downloadUrl}>
                <AppIcon name="download" size={14} />
                <span>Tải PDF đã ký</span>
              </a>
              {documentId != null && onOpenDocument && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="folder-open"
                  onClick={() => onOpenDocument(documentId)}
                >
                  Mở trong Hồ sơ
                </AppButton>
              )}
            </div>
          </InlineAlert>
        )}
      </SectionCard>
    </div>
  );

  const viewerContent = (
    <div className="ui-viewer-pane viewer">
      {/* Mobile-only styled dropzone inside Step 1 so phone users pick PDF immediately */}
      <div className="signer-mobile-upload">
        <label className={`ui-dropzone ui-dropzone--vertical ui-dropzone--compact${filename ? " has-file" : ""}`}>
          <input
            type="file"
            accept="application/pdf,.zip"
            className="sr-only"
            aria-label="Tải PDF hoặc ZIP cần ký trên di động"
            onChange={onUpload}
          />
          <span className="ui-dropzone-icon ui-dropzone-icon--pill" aria-hidden="true">
            <AppIcon name="upload" size={18} />
          </span>
          <span className="ui-text-semibold ui-wrap">
            {filename ? filename : "Chọn tệp PDF hoặc ZIP cần ký"}
          </span>
          <span className="ui-muted">
            {filename ? "Nhấn để chọn tài liệu khác" : "Chạm để mở tệp từ thiết bị"}
          </span>
        </label>
        {zipFiles.length > 0 && renderZipList("m-")}
      </div>

      {docId ? (
        <PdfCanvas url={api.docUrl(docId)} onSelect={setRect} />
      ) : (
        <div className="ui-viewer-empty">
          <EmptyState
            icon="file-signature"
            title="Chưa có tài liệu PDF"
            description="Tải lên tệp PDF đơn lẻ hoặc tệp ZIP nhiều tài liệu để xem trước và kéo chọn vùng đặt chữ ký số."
            action={
              <AppButton
                variant="primary"
                leftIcon="upload"
                onClick={() => fileInputRef.current?.click()}
              >
                Chọn tệp PDF / ZIP
              </AppButton>
            }
          />
        </div>
      )}
    </div>
  );

  return (
    <PageShell maxWidth="wide" data-page="signer" className="signer-page">
      <PageHeader
        variant="compact"
        icon="file-signature"
        title="Ký số PDF"
        subtitle="Tải tài liệu PDF hoặc gói ZIP, chọn vị trí chữ ký trên trang và ký bằng USB Token WIN-CA."
        actions={
          <div className="signer-header-status">
            <StatusBadge
              tone={docId ? "success" : "neutral"}
              icon={docId ? "check-circle" : "circle"}
              size="sm"
            >
              PDF
            </StatusBadge>
            <StatusBadge
              tone={rect ? "success" : "neutral"}
              icon={rect ? "check-circle" : "circle"}
              size="sm"
            >
              Vùng ký
            </StatusBadge>
            <StatusBadge
              tone={certId ? "success" : "neutral"}
              icon={certId ? "check-circle" : "circle"}
              size="sm"
            >
              Chứng thư
            </StatusBadge>
          </div>
        }
      />

      {/* Mobile 2-step switcher (<=820px only; hidden on desktop) */}
      <div className="signer-mobile-switcher">
        <ResponsiveTabs
          variant="segmented"
          ariaLabel="Các bước ký số"
          active={mobileStep}
          onChange={setMobileStep}
          tabs={[
            {
              id: "doc",
              label: "1. Tài liệu & Vị trí",
              icon: "file-signature",
              badge: rect ? "OK" : undefined,
            },
            {
              id: "sign",
              label: "2. Token & Ký số",
              icon: "key",
              badge: certId ? "OK" : undefined,
            },
          ]}
        />
      </div>

      <SplitWorkspace
        variant="sidebar-left"
        className="signer-workspace"
        primaryClassName={mobileStep === "doc" ? "signer-pane-hidden-mobile" : ""}
        secondaryClassName={mobileStep === "sign" ? "signer-pane-hidden-mobile" : ""}
        primary={sidebarContent}
        secondary={viewerContent}
      />

      {/* Sticky mobile ready-state bar (<=820px only) */}
      <div className="signer-ready-bar" aria-live="polite">
        <div className="signer-ready-status">
          <StatusBadge
            tone={docId ? "success" : "neutral"}
            icon={docId ? "check-circle" : "circle"}
            size="sm"
          >
            PDF
          </StatusBadge>
          <StatusBadge
            tone={rect ? "success" : "neutral"}
            icon={rect ? "check-circle" : "circle"}
            size="sm"
          >
            Vùng ký
          </StatusBadge>
          <StatusBadge
            tone={certId ? "success" : "neutral"}
            icon={certId ? "check-circle" : "circle"}
            size="sm"
          >
            Chứng thư
          </StatusBadge>
        </div>
        {mobileStep === "doc" ? (
          <AppButton
            variant="primary"
            size="sm"
            rightIcon="arrow-right"
            onClick={() => setMobileStep("sign")}
          >
            Bước 2
          </AppButton>
        ) : (
          <AppButton
            variant="primary"
            size="sm"
            leftIcon="file-signature"
            loading={busy}
            disabled={!readyToSign}
            onClick={doSign}
          >
            {busy ? "Đang ký…" : "Ký số ngay"}
          </AppButton>
        )}
      </div>

      <AppModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="sm"
        title="Tạo khách hàng mới"
        subtitle="Hệ thống tự sinh tài khoản đăng nhập cổng hồ sơ cho khách hàng."
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setCreateOpen(false)}>
              Huỷ
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="user-plus"
              loading={creatingCust}
              type="submit"
              form={`${baseId}-create-cust-form`}
            >
              Tạo khách hàng
            </AppButton>
          </>
        }
      >
        <form id={`${baseId}-create-cust-form`} onSubmit={handleCreateCustomer} className="ui-stack">
          <FormField label="Tên công ty / khách hàng" htmlFor={`${baseId}-new-name`} required>
            <input
              id={`${baseId}-new-name`}
              className="ui-input"
              value={newCustName}
              onChange={(e) => setNewCustName(e.target.value)}
              placeholder="Ví dụ: Công ty TNHH ABC"
              required
            />
          </FormField>
          <FormField label="Mã số thuế" htmlFor={`${baseId}-new-mst`} hint="Tuỳ chọn, có thể để trống.">
            <input
              id={`${baseId}-new-mst`}
              className="ui-input num"
              value={newCustMst}
              onChange={(e) => setNewCustMst(e.target.value)}
              placeholder="0123456789"
            />
          </FormField>
        </form>
      </AppModal>
    </PageShell>
  );
}
