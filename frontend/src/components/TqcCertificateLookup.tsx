import { useEffect, useRef, useState } from "react";
import { api, TqcCertificate, TqcSearchResponse } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useToast,
  type InlineAlertTone,
  type StatusBadgeTone,
} from "./ui";
import { safeHttpUrl } from "../utils/url";

function provenanceLabel(value: string): string {
  if (value === "verified_live") return "Đã xác minh live";
  if (value === "verified_cached") return "Cache đã xác minh";
  if (value === "not_found_in_local_index") return "Chưa có trong index";
  return value;
}

function provenanceTone(value: string): StatusBadgeTone {
  if (value === "verified_live") return "success";
  if (value === "verified_cached") return "info";
  return "neutral";
}

function statusTone(value: string): StatusBadgeTone {
  if (value === "active") return "success";
  if (value === "expired" || value === "cancelled") return "danger";
  return "warning";
}

function statusLabel(value: string): string {
  if (value === "active") return "Còn hiệu lực";
  if (value === "expired") return "Hết hiệu lực";
  if (value === "cancelled") return "Đã hủy/thu hồi";
  return "Chưa xác định";
}

export function TqcCertificateLookup() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [applicant, setApplicant] = useState("");
  const [certificateNo, setCertificateNo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [validOn, setValidOn] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(false);
  const [result, setResult] = useState<TqcSearchResponse | null>(null);
  const [selected, setSelected] = useState<TqcCertificate | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importReady, setImportReady] = useState(false);
  const [pendingCsv, setPendingCsv] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<InlineAlertTone>("info");
  const [apiMode, setApiMode] = useState("");
  const mountedRef = useRef(true);
  const [failedImportJobId, setFailedImportJobId] = useState<number | null>(null);

  const pollTqcImportJob = async (jobId: number) => {
    let consecutiveFailures = 0;
    while (mountedRef.current) {
      let job;
      try {
        job = await api.standards.getTqcImportJob(jobId);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 10) throw error;
        const retryDelay = Math.min(5000, 500 * 2 ** (consecutiveFailures - 1));
        setMessageTone("warning");
        setMessage(`Mất kết nối job CSV; đang thử lại (${consecutiveFailures}/10).`);
        await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        continue;
      }
      if (job.status === "failed") {
        setFailedImportJobId(job.job_id);
        throw new Error(job.error || "Import CSV TQC nền thất bại.");
      }
      if (job.status === "success" && job.result) return job.result;
      setMessageTone("info");
      setMessage(`Đang import CSV: ${job.progress}% (${job.requested} dòng).`);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return null;
  };

  useEffect(() => {
    mountedRef.current = true;
    api.standards
      .getTqcStatus()
      .then((status) => setApiMode(status.search_mode))
      .catch(() => setApiMode("offline"));

    api.standards
      .getLatestTqcImportJob()
      .then(async ({ job }) => {
        if (!job || !mountedRef.current) return;
        if (job.status === "failed") {
          setFailedImportJobId(job.job_id);
          setMessageTone("danger");
          setMessage(job.error || "Import CSV TQC nền thất bại.");
          return;
        }
        if (job.status !== "running") return;
        setImporting(true);
        setMessageTone("info");
        setMessage(`Đang nối lại job CSV #${job.job_id}.`);
        try {
          const completed = await pollTqcImportJob(job.job_id);
          if (completed && mountedRef.current) {
            setMessageTone("success");
            setMessage(
              `CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`,
            );
            toast.success("Đã hoàn tất nối lại tác vụ import CSV TQC.");
          }
        } catch (error: unknown) {
          if (mountedRef.current) {
            setMessageTone("danger");
            setMessage((error as Error)?.message || "Import CSV TQC thất bại.");
          }
        } finally {
          if (mountedRef.current) setImporting(false);
        }
      })
      .catch(() => {});

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const search = async (targetPage = 1) => {
    if (
      ![query, model, manufacturer, applicant, certificateNo, statusFilter, validOn].some((v) =>
        v.trim(),
      )
    ) {
      setMessageTone("warning");
      setMessage("Nhập ít nhất một điều kiện tìm kiếm.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await api.standards.searchTqc({
        q: query,
        model,
        manufacturer,
        applicant,
        certificate_no: certificateNo,
        status: statusFilter,
        valid_on: validOn,
        page: targetPage,
        page_size: 20,
      });
      setResult(response);
      setPage(targetPage);
      setSelected(null);
      if (!response.items.length) {
        setMessageTone("info");
        setMessage(response.warning || "Chưa có trong index nội bộ.");
      }
    } catch (error: unknown) {
      setMessageTone("danger");
      setMessage((error as Error)?.message || "Không thể tra cứu TQC.");
    } finally {
      setLoading(false);
    }
  };

  const lookupExact = async () => {
    if (!certificateNo.trim()) {
      setMessageTone("warning");
      setMessage("Nhập số GCN để kiểm tra live.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await api.standards.getTqcCertificate(certificateNo.trim(), refresh);
      setSelected(response.certificate);
      setResult(null);
      toast.success("Đã hoàn tất xác minh số GCN trực tiếp từ TQC.");
    } catch (error: unknown) {
      setSelected(null);
      setMessageTone("danger");
      setMessage((error as Error)?.message || "TQC không tìm thấy số GCN này.");
    } finally {
      setLoading(false);
    }
  };

  const previewEntries = importText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      /^[A-Za-z0-9]{6,120}$/.test(line) ? { certificate_no: line } : { qr_input: line },
    );

  const importPastedEntries = async () => {
    const entries = previewEntries;
    if (!entries.length) {
      setMessageTone("warning");
      setMessage("Dán ít nhất một số GCN hoặc QR URL.");
      return;
    }
    setImporting(true);
    setMessage("");
    try {
      const response = await api.standards.importTqc(entries, refresh);
      setMessageTone("success");
      setMessage(
        `Đã xử lý ${response.requested}: xác minh ${response.verified}, cache ${response.cached}, không thấy ${response.not_found}, lỗi ${response.errors.length}.`,
      );
      toast.success("Đã cập nhật dữ liệu GCN vào chỉ mục TQC.");
      setImportText("");
      setImportReady(false);
    } catch (error: unknown) {
      setMessageTone("danger");
      setMessage((error as Error)?.message || "Import TQC thất bại.");
    } finally {
      setImporting(false);
    }
  };

  const importCsv = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setFailedImportJobId(null);
    setMessage("");
    try {
      const started = await api.standards.importTqcCsv(file, refresh);
      setMessageTone("info");
      setMessage(`Đã xếp hàng import ${started.requested} dòng CSV.`);
      const completed = await pollTqcImportJob(started.job_id);
      if (!completed) return;
      setMessageTone("success");
      setMessage(
        `CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`,
      );
      toast.success("Hoàn tất import file CSV TQC.");
      setPendingCsv(null);
    } catch (error: unknown) {
      setMessageTone("danger");
      setMessage((error as Error)?.message || "Import CSV TQC thất bại.");
    } finally {
      setImporting(false);
    }
  };

  const retryCsvImport = async () => {
    if (failedImportJobId === null) return;
    setImporting(true);
    setFailedImportJobId(null);
    setMessageTone("info");
    setMessage(`Đang thử lại job CSV #${failedImportJobId}.`);
    try {
      await api.standards.retryTqcImportJob(failedImportJobId);
      const completed = await pollTqcImportJob(failedImportJobId);
      if (completed) {
        setMessageTone("success");
        setMessage(
          `CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`,
        );
        toast.success("Đã chạy lại tác vụ import CSV TQC thành công.");
      }
    } catch (error: unknown) {
      setMessageTone("danger");
      setMessage((error as Error)?.message || "Không thể thử lại import CSV TQC.");
    } finally {
      setImporting(false);
    }
  };

  const secondaryFilterCount =
    (statusFilter ? 1 : 0) + (validOn ? 1 : 0) + (refresh ? 1 : 0);
  const resetSecondaryFilters = () => {
    setStatusFilter("");
    setValidOn("");
    setRefresh(false);
  };

  const selectedSourceUrl = safeHttpUrl(selected?.provenance.source_url);
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;

  return (
    <div className="ui-stack--lg">
      <SectionCard
        eyebrow="TQC CNHQ Intelligence"
        title="Tra cứu chứng nhận theo model"
        subtitle="Exact lookup kiểm tra live với TQC; tìm model, hãng hoặc doanh nghiệp dùng chỉ mục các GCN đã xác minh. Chưa có trong index không có nghĩa là không tồn tại chứng nhận."
        icon="badge-check"
        actions={
          <StatusBadge tone={apiMode === "offline" ? "danger" : "brand"} dot>
            {apiMode || "đang kiểm tra API"}
          </StatusBadge>
        }
      >
        <div className="ui-stack">
          <FormGrid cols={3}>
            <FormField label="Từ khóa chung" htmlFor="tqc-query">
              <input
                id="tqc-query"
                className="ui-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="model, sản phẩm, hãng..."
              />
            </FormField>
            <FormField label="Model" htmlFor="tqc-model">
              <input
                id="tqc-model"
                className="ui-input ui-mono ui-wrap"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="T27G16"
              />
            </FormField>
            <FormField label="Hãng sản xuất" htmlFor="tqc-manufacturer">
              <input
                id="tqc-manufacturer"
                className="ui-input"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                placeholder="TOMKO"
              />
            </FormField>
            <FormField label="Doanh nghiệp nộp hồ sơ" htmlFor="tqc-applicant">
              <input
                id="tqc-applicant"
                className="ui-input"
                value={applicant}
                onChange={(event) => setApplicant(event.target.value)}
                placeholder="Tên doanh nghiệp"
              />
            </FormField>
            <FormField label="Số GCN" htmlFor="tqc-cert-no">
              <input
                id="tqc-cert-no"
                className="ui-input ui-mono ui-wrap"
                value={certificateNo}
                onChange={(event) => setCertificateNo(event.target.value)}
                placeholder="C0955191224AE15A3"
              />
            </FormField>
          </FormGrid>

          <FilterBar
            collapsibleMobile
            activeCount={secondaryFilterCount}
            onReset={resetSecondaryFilters}
            resetLabel="Xóa lọc"
            filters={
              <>
                <FormField label="Trạng thái" htmlFor="tqc-status">
                  <select
                    id="tqc-status"
                    className="ui-select"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">Tất cả</option>
                    <option value="active">Còn hiệu lực</option>
                    <option value="expired">Hết hiệu lực</option>
                    <option value="cancelled">Đã hủy</option>
                    <option value="unknown">Chưa xác định</option>
                  </select>
                </FormField>
                <FormField label="Có hiệu lực ngày" htmlFor="tqc-valid-on">
                  <input
                    id="tqc-valid-on"
                    className="ui-input"
                    aria-label="Có hiệu lực ngày"
                    type="date"
                    value={validOn}
                    onChange={(event) => setValidOn(event.target.value)}
                  />
                </FormField>
                <label className="ui-check-label">
                  <input
                    type="checkbox"
                    checked={refresh}
                    onChange={(event) => setRefresh(event.target.checked)}
                  />
                  <span>Làm mới cache</span>
                </label>
              </>
            }
            actions={
              <div className="ui-row">
                <AppButton
                  variant="primary"
                  size="md"
                  leftIcon="search"
                  loading={loading}
                  onClick={() => search(1)}
                >
                  Tìm trong index
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="md"
                  leftIcon="shield-check"
                  disabled={loading}
                  onClick={lookupExact}
                >
                  Kiểm tra số GCN live
                </AppButton>
              </div>
            }
          />
        </div>
      </SectionCard>

      {message && (
        <InlineAlert
          tone={messageTone}
          action={
            failedImportJobId !== null ? (
              <AppButton
                variant="danger"
                size="sm"
                leftIcon="refresh"
                loading={importing}
                onClick={retryCsvImport}
              >
                Thử lại import CSV
              </AppButton>
            ) : undefined
          }
        >
          {message}
        </InlineAlert>
      )}

      {loading && !result && !selected && (
        <SectionCard>
          <SkeletonBlock variant="title" />
          <SkeletonBlock variant="line" lines={3} />
        </SectionCard>
      )}

      {result && (
        <SectionCard
          title={`Kết quả tra cứu (${result.total} bản ghi trong local index)`}
          subtitle={
            result.index_last_updated_at
              ? `Cập nhật: ${result.index_last_updated_at}`
              : "Chưa có dữ liệu"
          }
          icon="file-search"
        >
          <div className="ui-stack">
            <DataView
              mobileMode="card"
              loading={loading}
              skeletonRows={4}
              skeletonCols={6}
              empty={
                result.items.length === 0 ? (
                  <EmptyState
                    icon="file-search"
                    title="Chưa có trong index"
                    description="Không tìm thấy chứng nhận khớp điều kiện trong chỉ mục nội bộ. Bạn có thể kiểm tra trực tiếp bằng Số GCN live hoặc nhập thêm dữ liệu vào index."
                    compact
                  />
                ) : undefined
              }
              desktop={
                <div className="ui-table-scroll-wrap" tabIndex={0}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Số GCN &amp; Model</th>
                        <th>Hãng &amp; Doanh nghiệp</th>
                        <th>Sản phẩm &amp; QCVN</th>
                        <th>Hiệu lực</th>
                        <th>Trạng thái &amp; Nguồn</th>
                        <th className="col-act">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((cert) => (
                        <tr key={cert.certificate_no}>
                          <td>
                            <div className="ui-mono ui-wrap ui-text-strong ui-wrap">{cert.certificate_no}</div>
                            <div className="ui-text-strong ui-wrap">{cert.model || "Chưa có model"}</div>
                          </td>
                          <td>
                            <div className="ui-text-strong ui-wrap">{cert.manufacturer || "-"}</div>
                            <div className="ui-muted">{cert.applicant_name || "-"}</div>
                          </td>
                          <td>
                            <div>{cert.product_name || "-"}</div>
                            <div className="ui-muted ui-mono ui-wrap">
                              {cert.technical_regulations.join(", ") || "-"}
                            </div>
                          </td>
                          <td className="ui-mono ui-wrap">
                            {cert.issue_date || "-"} - {cert.expiry_date || "-"}
                          </td>
                          <td>
                            <div className="ui-stack">
                              <StatusBadge tone={statusTone(cert.derived_status)} size="sm">
                                {statusLabel(cert.derived_status)}
                              </StatusBadge>
                              <StatusBadge
                                tone={provenanceTone(cert.provenance.verification_status)}
                                variant="outline"
                                size="sm"
                              >
                                {provenanceLabel(cert.provenance.verification_status)}
                              </StatusBadge>
                            </div>
                          </td>
                          <td className="col-act">
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="eye"
                              onClick={() => setSelected(cert)}
                            >
                              Xem chi tiết
                            </AppButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div className="ui-mobile-card-list">
                  {result.items.map((cert) => (
                    <MobileCard key={cert.certificate_no}>
                      <MobileCardHeader
                        title={cert.model || "Chưa có model"}
                        subtitle={<span className="ui-mono ui-wrap">{cert.certificate_no}</span>}
                        badge={
                          <StatusBadge tone={statusTone(cert.derived_status)} size="sm">
                            {statusLabel(cert.derived_status)}
                          </StatusBadge>
                        }
                      />
                      <MobileCardGrid cols={2}>
                        <MobileCardRow label="Hãng" value={cert.manufacturer || "-"} />
                        <MobileCardRow
                          label="Xác minh"
                          value={provenanceLabel(cert.provenance.verification_status)}
                        />
                        <MobileCardRow
                          label="Doanh nghiệp"
                          value={cert.applicant_name || "-"}
                          fullWidth
                        />
                        <MobileCardRow
                          label="Sản phẩm"
                          value={cert.product_name || "-"}
                          fullWidth
                        />
                        <MobileCardRow
                          label="QCVN"
                          value={cert.technical_regulations.join(", ") || "-"}
                          mono
                          fullWidth
                        />
                        <MobileCardRow
                          label="Hiệu lực"
                          value={`${cert.issue_date || "-"} - ${cert.expiry_date || "-"}`}
                          mono
                          fullWidth
                        />
                      </MobileCardGrid>
                      <MobileCardActions>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="eye"
                          onClick={() => setSelected(cert)}
                        >
                          Xem chi tiết
                        </AppButton>
                      </MobileCardActions>
                    </MobileCard>
                  ))}
                </div>
              }
            />

            {result.total > result.page_size && (
              <div className="ui-row-between ui-divider-top">
                <span className="ui-muted ui-mono ui-wrap">
                  Trang {page}/{totalPages}
                </span>
                <div className="ui-row">
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="arrow-left"
                    disabled={page <= 1 || loading}
                    onClick={() => search(page - 1)}
                  >
                    Trang trước
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    rightIcon="arrow-right"
                    disabled={page >= totalPages || loading}
                    onClick={() => search(page + 1)}
                  >
                    Trang sau
                  </AppButton>
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {selected && (
        <SectionCard
          className="std-card-active"
          title={`Chi tiết ${selected.certificate_no}`}
          subtitle={selected.model || "Chưa có model"}
          icon="badge-check"
          actions={
            <div className="ui-row">
              <StatusBadge tone={statusTone(selected.derived_status)} size="sm">
                {statusLabel(selected.derived_status)}
              </StatusBadge>
              <StatusBadge
                tone={provenanceTone(selected.provenance.verification_status)}
                variant="outline"
                size="sm"
              >
                {provenanceLabel(selected.provenance.verification_status)}
              </StatusBadge>
              <AppButton
                variant="ghost"
                size="sm"
                leftIcon="x"
                onClick={() => setSelected(null)}
              >
                Đóng
              </AppButton>
            </div>
          }
        >
          <div className="ui-stack">
            <FormGrid cols={2}>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Model / Hãng sản xuất</div>
                <div className="ui-text-strong ui-wrap">
                  {selected.model || "-"} · {selected.manufacturer || "-"}
                </div>
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Doanh nghiệp nộp hồ sơ</div>
                <div className="ui-text-strong ui-wrap">{selected.applicant_name || "-"}</div>
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Sản phẩm</div>
                <div className="ui-text-strong ui-wrap">{selected.product_name || "-"}</div>
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Hiệu lực chứng nhận</div>
                <div className="ui-text-strong ui-wrap ui-mono ui-wrap">
                  {selected.issue_date || "-"} - {selected.expiry_date || "-"}
                </div>
              </div>
            </FormGrid>

            <div className="ui-subpanel ui-subpanel--md">
              <div className="ui-muted">Quy chuẩn kỹ thuật (QCVN)</div>
              <div className="ui-text-strong ui-wrap ui-mono ui-wrap">
                {selected.technical_regulations.join(", ") || "-"}
              </div>
            </div>

            <div className="ui-muted">
              Nguồn:{" "}
              {selectedSourceUrl ? (
                <a
                  href={selectedSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-link ui-wrap"
                >
                  {selectedSourceUrl}
                </a>
              ) : (
                selected.provenance.source_url || "local index"
              )}
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Nhập dữ liệu hợp pháp để mở rộng index"
        subtitle="Dán mỗi dòng một số GCN hoặc QR URL chính thức của TQC, hoặc tải lên CSV có cột certificate_no / qr_url."
        icon="upload"
      >
        <div className="ui-stack">
          <FormField label="Danh sách GCN hoặc QR TQC" htmlFor="tqc-import-text">
            <textarea
              id="tqc-import-text"
              className="ui-textarea ui-mono ui-wrap"
              aria-label="Danh sách GCN hoặc QR TQC"
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setImportReady(false);
              }}
              rows={4}
              placeholder={"C0955191224AE15A3\nhttps://data-cnhq.tqc.gov.vn/?q=..."}
            />
          </FormField>

          {importReady && (
            <InlineAlert tone="info">
              Xem trước: {previewEntries.length} entry.{" "}
              {previewEntries
                .slice(0, 3)
                .map((entry) => entry.certificate_no || entry.qr_input)
                .join(" · ")}
              {previewEntries.length > 3 ? " · ..." : ""}
            </InlineAlert>
          )}

          {pendingCsv && (
            <InlineAlert tone="info">
              CSV chờ import: {pendingCsv.name} ({Math.ceil(pendingCsv.size / 1024)} KB)
            </InlineAlert>
          )}

          <div className="ui-row">
            {!importReady ? (
              <AppButton
                variant="secondary"
                leftIcon="eye"
                onClick={() => setImportReady(true)}
                disabled={importing || !previewEntries.length}
              >
                Xem trước dữ liệu dán
              </AppButton>
            ) : (
              <AppButton
                variant="primary"
                leftIcon="check-circle"
                loading={importing}
                onClick={importPastedEntries}
              >
                {importing ? "Đang import..." : `Xác nhận import ${previewEntries.length} entry`}
              </AppButton>
            )}

            <label className="ui-btn ui-btn--secondary ui-btn--md">
              <AppIcon name="upload" size={16} />
              <span>Chọn CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => setPendingCsv(event.target.files?.[0] || null)}
              />
            </label>

            {pendingCsv && (
              <AppButton
                variant="primary"
                leftIcon="check"
                loading={importing}
                onClick={() => importCsv(pendingCsv)}
              >
                Xác nhận import CSV
              </AppButton>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
