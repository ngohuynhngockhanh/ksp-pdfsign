import { useEffect, useRef, useState } from "react";
import { api, type SignatureReport } from "../api";
import { PdfView } from "../components/PdfView";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  InlineAlert,
  MobileCard,
  MobileCardGrid,
  MobileCardRow,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  type IconName,
  type StatusBadgeTone,
  useToast,
} from "../components/ui";

export function Verify({
  docPk,
  onConsumed,
}: {
  docPk?: number | null;
  onConsumed?: () => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [reports, setReports] = useState<SignatureReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [source, setSource] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (docPk == null) return;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBusy(true);
    setErr("");
    setReports(null);
    setSource(`hồ sơ #${docPk}`);
    setPdfUrl(`/api/documents/${docPk}/download`);
    api
      .verifyDocument(docPk)
      .then((r) => setReports(r.signatures))
      .catch((e) => {
        const msg = (e as Error).message;
        setErr(msg);
        toast.error(msg);
      })
      .finally(() => {
        setBusy(false);
        onConsumed?.();
      });
  }, [docPk]);

  async function processFile(f: File) {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    const nextUrl = URL.createObjectURL(f);
    blobUrlRef.current = nextUrl;

    setBusy(true);
    setErr("");
    setReports(null);
    setSource(f.name);
    setPdfUrl(nextUrl);
    try {
      const r = await api.verify(f);
      setReports(r.signatures);
      const passed = r.signatures.filter((s) => s.intact && s.valid && s.trusted).length;
      if (r.signatures.length > 0 && passed === r.signatures.length) {
        toast.success(`Đã kiểm định ${r.signatures.length} chữ ký hợp lệ.`);
      } else if (r.signatures.length === 0) {
        toast.warning("Tài liệu không chứa chữ ký số nào.");
      } else {
        toast.warning(`${passed}/${r.signatures.length} chữ ký đạt kiểm định — cần xem xét.`);
      }
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
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

  const validReports =
    reports?.filter((report) => report.intact && report.valid && report.trusted).length ?? 0;
  const allValid = Boolean(reports && reports.length > 0 && validReports === reports.length);

  const inspectorPane = (
    <div className="ui-stack">
      <SectionCard
        padding="compact"
        icon="upload"
        title="Tài liệu kiểm định"
        actions={
          source ? (
            <AppButton
              size="sm"
              variant="ghost"
              leftIcon="upload"
              onClick={() => fileInputRef.current?.click()}
            >
              Chọn tệp khác
            </AppButton>
          ) : undefined
        }
      >
        <label
          className={`ui-dropzone ui-dropzone--vertical${dragActive ? " is-dragging" : ""}${source ? " has-file" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDropFile}
        >
          <input
            ref={fileInputRef}
            aria-label="PDF cần kiểm tra"
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={onFile}
          />
          <span className="ui-dropzone-icon" aria-hidden="true">
            <AppIcon
              name={busy ? "loader" : "shield-check"}
              size={20}
              className={busy ? "ui-spin" : undefined}
            />
          </span>
          <span className="ui-text-semibold ui-wrap">
            {busy ? "Đang phân tích chữ ký…" : "Chọn PDF để kiểm tra"}
          </span>
          <span className="ui-muted">
            Tệp chỉ được dùng cho phiên kiểm định hiện tại
          </span>
        </label>

        {source && (
          <div className="ui-subpanel ui-stack--xs ui-mt-3 ui-wrap">
            <span className="ui-kicker">Đang xem</span>
            <b className="ui-text-strong">{source}</b>
          </div>
        )}

        {err && (
          <InlineAlert tone="danger" onDismiss={() => setErr("")}>
            {err}
          </InlineAlert>
        )}
      </SectionCard>

      {busy && (
        <SectionCard padding="compact" title="Đang kiểm định chữ ký số…">
          <div className="ui-stack" role="status" aria-busy="true" aria-label="Đang kiểm định chữ ký">
            <SkeletonBlock variant="title" />
            <SkeletonBlock variant="line" lines={5} />
          </div>
        </SectionCard>
      )}

      {reports && (
        <InlineAlert
          tone={allValid ? "success" : "warning"}
          title={
            allValid
              ? "Tài liệu vượt qua kiểm định chính"
              : "Tài liệu cần xem xét"
          }
        >
          {reports.length
            ? `${validReports}/${reports.length} chữ ký đạt toàn vẹn, mật mã và chuỗi tin cậy CA.`
            : "Không phát hiện chữ ký số trong tài liệu PDF này."}
        </InlineAlert>
      )}

      {reports && reports.length === 0 && (
        <EmptyState
          compact
          icon="shield-alert"
          title="Tài liệu không có chữ ký số nào."
          description="Kiểm tra lại xem tài liệu đã được ký số chuẩn PAdES/PDF hay chưa."
        />
      )}

      {reports?.map((s, i) => (
        <SignatureReportCard key={`${s.field_name}-${i}`} report={s} />
      ))}
    </div>
  );

  const previewPane = (
    <div className="ui-viewer-pane verify-right">
      {pdfUrl ? (
        <PdfView url={pdfUrl} />
      ) : (
        <div className="ui-viewer-empty">
          <EmptyState
            icon="file-search"
            title="Chưa có tài liệu để kiểm định"
            description="Tải lên tệp PDF ở khung bên trái để kiểm tra tính toàn vẹn, chứng thư CA, hiệu lực và xem trước nội dung."
            action={
              <AppButton
                variant="primary"
                leftIcon="upload"
                onClick={() => fileInputRef.current?.click()}
              >
                Chọn PDF để kiểm tra
              </AppButton>
            }
          />
        </div>
      )}
    </div>
  );

  return (
    <PageShell maxWidth="wide" data-page="verify" className="verify-page">
      <PageHeader
        variant="compact"
        icon="shield-check"
        title="Kiểm định chữ ký số."
        subtitle="Đọc tính toàn vẹn, chuỗi tin cậy, thu hồi chứng thư và phạm vi ký của từng chữ ký trong PDF."
        actions={
          reports ? (
            <StatusBadge
              tone={allValid ? "success" : reports.length === 0 ? "neutral" : "warning"}
              icon={allValid ? "check-circle" : "alert-triangle"}
              size="md"
              className="num"
            >
              {reports.length ? `${validReports}/${reports.length} chữ ký đạt` : "Không có chữ ký"}
            </StatusBadge>
          ) : undefined
        }
      />

      <SplitWorkspace
        variant="sidebar-left"
        className="verify-workspace"
        mobileTabs={["Kết quả kiểm định", "Xem tài liệu PDF"]}
        primary={inspectorPane}
        secondary={previewPane}
      />
    </PageShell>
  );
}

function SignatureReportCard({ report: s }: { report: SignatureReport }) {
  const details: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
    { label: "Toàn vẹn (không sửa sau ký)", value: <CheckStatus ok={s.intact} /> },
    { label: "Hợp lệ mật mã", value: <CheckStatus ok={s.valid} /> },
    { label: "Chuỗi CA tin cậy", value: <CheckStatus ok={s.trusted} /> },
  ];

  if (s.revocation_ok !== null) {
    details.push({ label: "Không bị thu hồi", value: <CheckStatus ok={s.revocation_ok} /> });
  }

  details.push({
    label: "Timestamp",
    value: (
      <StatusBadge tone={s.has_timestamp ? "info" : "neutral"} size="sm">
        {s.has_timestamp ? "Có" : "Không"}
      </StatusBadge>
    ),
  });

  if (s.signing_time) {
    details.push({
      label: "Thời gian ký",
      value: new Date(s.signing_time).toLocaleString("vi-VN"),
      mono: true,
    });
  }

  if (s.certificate_issuer) {
    details.push({ label: "Nhà cung cấp chứng thư", value: s.certificate_issuer });
  }

  if (s.certificate_valid_from) {
    details.push({
      label: "Chứng thư có hiệu lực từ",
      value: new Date(s.certificate_valid_from).toLocaleString("vi-VN"),
      mono: true,
    });
  }

  if (s.certificate_valid_to) {
    details.push({
      label: "Chứng thư hết hạn",
      value: new Date(s.certificate_valid_to).toLocaleString("vi-VN"),
      mono: true,
    });
  }

  details.push({ label: "Phạm vi ký", value: s.coverage });

  if (s.ltv) {
    details.push({ label: "LTV", value: s.ltv });
  }

  return (
    <SectionCard
      padding="compact"
      className="sig-report"
      icon="badge-check"
      title={s.field_name}
      subtitle={s.signer_name || "Chưa rõ người ký"}
      actions={
        <StatusBadge tone={summaryTone(s)} icon={summaryIcon(s)} size="sm">
          {s.summary}
        </StatusBadge>
      }
    >
      <DataView
        desktop={
          <table className="ui-kv-table verify-detail-table">
            <tbody>
              {details.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className={`verify-detail-val${row.mono ? " num" : ""}`}>
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
        mobileCards={
          <MobileCard>
            <MobileCardGrid cols={1}>
              {details.map((row) => (
                <MobileCardRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  mono={row.mono}
                />
              ))}
            </MobileCardGrid>
          </MobileCard>
        }
      />

      {s.problems.length > 0 && (
        <InlineAlert tone="danger" title="Cảnh báo kiểm định" className="ui-mt-3">
          <ul className="ui-bullet-list ui-text-xs">
            {s.problems.map((p, j) => (
              <li key={j}>{p}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
    </SectionCard>
  );
}

function CheckStatus({ ok }: { ok: boolean }) {
  return ok ? (
    <StatusBadge tone="success" size="sm" icon="check-circle">
      Đạt
    </StatusBadge>
  ) : (
    <StatusBadge tone="danger" size="sm" icon="alert-circle">
      Không đạt
    </StatusBadge>
  );
}

function summaryTone(s: SignatureReport): StatusBadgeTone {
  if (s.intact && s.valid && s.trusted) return "success";
  if (s.intact && s.valid) return "warning";
  return "danger";
}

function summaryIcon(s: SignatureReport): IconName {
  if (s.intact && s.valid && s.trusted) return "check-circle";
  if (s.intact && s.valid) return "alert-triangle";
  return "alert-circle";
}
