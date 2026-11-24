import { useEffect, useState } from "react";
import {
  api,
  PayrollHrSummary,
  PayrollImportDetail,
  PayrollImportItem,
  PayrollNetTargetPlan,
  PayrollWorkbookChange,
  PayrollWorkbookDraft,
} from "../api";
import { PayrollForecastPlanner } from "../components/PayrollForecastPlanner";
import { PayrollHrOverview } from "../components/PayrollHrOverview";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SectionCard,
  StatusBadge,
  TableSkeleton,
  useToast,
} from "../components/ui";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);
const excelMoney = (value = "") => {
  const parsed = Number(String(value).replace(/[,.\s]/g, ""));
  return Number.isFinite(parsed) && parsed !== 0
    ? new Intl.NumberFormat("vi-VN").format(parsed)
    : value || "—";
};

type PayrollSectionTab = "all" | "hr" | "forecast" | "imports";

export function Payroll() {
  const toast = useToast();
  const [sectionTab, setSectionTab] = useState<PayrollSectionTab>("all");
  const [loadErr, setLoadErr] = useState("");
  const [loadingImports, setLoadingImports] = useState(true);
  const [syncJob, setSyncJob] =
    useState<Awaited<ReturnType<typeof api.payrollSyncStatus>>["job"]>(null);
  const [imports, setImports] = useState<PayrollImportItem[]>([]);
  const [importDetail, setImportDetail] = useState<PayrollImportDetail | null>(null);
  const [showRawMobile, setShowRawMobile] = useState(false);
  const [focusedCell, setFocusedCell] = useState("");
  const [draft, setDraft] = useState<PayrollWorkbookDraft | null>(null);
  const [editRow, setEditRow] = useState<number | null>(null);
  const [draftChanges, setDraftChanges] = useState<Record<number, PayrollWorkbookChange>>({});
  const [draftBusy, setDraftBusy] = useState(false);
  const [targetNet, setTargetNet] = useState("");
  const [allowTaxableBonus, setAllowTaxableBonus] = useState(false);
  const [netPlan, setNetPlan] = useState<PayrollNetTargetPlan | null>(null);
  const [hrSummary, setHrSummary] = useState<PayrollHrSummary | null>(null);
  const hrYear = 2026;

  function notify(text: string, tone: "info" | "success" | "warning" | "error" = "success") {
    if (!text) return;
    toast.showToast(text, tone, 6000);
  }

  function openFinding(cell = "") {
    if (!cell || !importDetail) return;
    setShowRawMobile(true);
    setFocusedCell(cell);
    window.setTimeout(
      () =>
        document
          .getElementById(`payroll-cell-${importDetail.id}-${cell}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }),
      50,
    );
  }

  function cellName(row: number, col: number) {
    let name = "";
    for (let value = col + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return `${name}${row + 1}`;
  }

  function numberValue(value = "") {
    const parsed = Number(String(value).replace(/[,.\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateDraftChange(row: number, patch: Partial<PayrollWorkbookChange>) {
    setDraftChanges((current) => ({
      ...current,
      [row]: {
        ...current[row],
        ...patch,
        row,
        reason:
          patch.reason ?? current[row]?.reason ?? "Điều chỉnh theo tình hình công việc trong tháng",
      },
    }));
  }

  async function calculateTargetNet() {
    if (!importDetail || !editRow) return;
    if (!targetNet || Number(targetNet) <= 0) {
      notify("Vui lòng nhập số thực lĩnh mục tiêu hợp lệ.", "warning");
      return;
    }
    try {
      setDraftBusy(true);
      setNetPlan(
        await api.payrollNetTarget(importDetail.id, {
          row: editRow,
          target_net: Number(targetNet),
          allow_taxable_bonus: allowTaxableBonus,
        }),
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setDraftBusy(false);
    }
  }

  async function applyTargetNetPlan() {
    if (!editRow || !netPlan || !importDetail) return;
    const nextChange: PayrollWorkbookChange = {
      ...draftChanges[editRow],
      row: editRow,
      meal_allowance: netPlan.proposed.meal_allowance,
      overtime_weekday_hours: netPlan.proposed.overtime_weekday_hours,
      overtime_weekend_hours: netPlan.proposed.overtime_weekend_hours,
      attendance_bonus: netPlan.proposed.attendance_bonus ?? draftChanges[editRow]?.attendance_bonus,
      reason: "Điều chỉnh theo thực lĩnh mục tiêu, giờ làm thêm thực tế và hồ sơ hợp lệ",
    };
    const nextChanges = { ...draftChanges, [editRow]: nextChange };
    setDraftChanges(nextChanges);
    try {
      setDraftBusy(true);
      const saved = await api.payrollSaveDraft(importDetail.id, Object.values(nextChanges));
      setDraft(saved);
      notify(
        "Đã áp dụng và lưu bản nháp. Hãy chạy review trước khi cập nhật file gốc trên Drive.",
        "success",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setDraftBusy(false);
    }
  }

  async function saveWorkbookDraft() {
    if (!importDetail) return;
    const changes = Object.values(draftChanges);
    if (!changes.length) {
      notify("Bạn chưa thay đổi dữ liệu nhân viên nào.", "warning");
      return;
    }
    try {
      setDraftBusy(true);
      const saved = await api.payrollSaveDraft(importDetail.id, changes);
      setDraft(saved);
      notify("Đã lưu bản nháp. Hãy chạy review trước khi gửi lên Drive.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setDraftBusy(false);
    }
  }

  async function reviewWorkbookDraft() {
    if (!draft) return;
    try {
      setDraftBusy(true);
      const reviewed = await api.payrollReviewDraft(draft.id);
      setDraft(reviewed);
      notify(`Review xong: ${reviewed.findings.length} cảnh báo.`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setDraftBusy(false);
    }
  }

  async function uploadWorkbookDraft() {
    if (!draft) return;
    try {
      setDraftBusy(true);
      const uploaded = await api.payrollUploadDraft(draft.id);
      setDraft(uploaded);
      notify(`Đã gửi lên Google Drive: ${uploaded.drive_filename}`, "success");
      await loadHr();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setDraftBusy(false);
    }
  }

  async function load() {
    setLoadingImports(true);
    try {
      setImports(await api.payrollImports());
    } finally {
      setLoadingImports(false);
    }
  }

  async function loadHr() {
    setHrSummary(await api.payrollHrSummary(hrYear));
  }

  useEffect(() => {
    Promise.all([load(), loadHr()]).catch((e) => setLoadErr((e as Error).message));
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api.payrollSyncStatus();
        if (stopped) return;
        setSyncJob(result.job);
        if (result.job?.status === "running") timer = window.setTimeout(poll, 700);
      } catch (error) {
        if (!stopped) notify((error as Error).message, "error");
      }
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  async function syncDrive() {
    try {
      await api.payrollSyncDrive();
      const poll = async () => {
        const result = await api.payrollSyncStatus();
        setSyncJob(result.job);
        if (result.job?.status === "running") {
          window.setTimeout(poll, 700);
        } else if (result.job?.status === "success") {
          notify(
            `Đã đồng bộ ${result.job.stats.files?.length ?? 0} file, thêm mới ${result.job.stats.imported ?? 0}.`,
            "success",
          );
          await Promise.all([load(), loadHr()]);
        } else if (result.job?.status === "failed") {
          notify(result.job.error || "Đồng bộ thất bại.", "error");
        }
      };
      await poll();
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  const showHr = sectionTab === "all" || sectionTab === "hr";
  const showForecast = sectionTab === "all" || sectionTab === "forecast";
  const showImports = sectionTab === "all" || sectionTab === "imports";

  return (
    <PageShell className="payroll-page" data-page="payroll">
      <div className="ui-stack--lg">
        <PageHeader
          variant="compact"
          icon="users"
          eyebrow={`NHÂN SỰ · ${hrYear}`}
          title="Bảng lương & kiểm soát tuân thủ"
          subtitle="Nguồn chuẩn là file Excel đã sync và parse từ Google Drive."
          actions={
            <AppButton
              variant="primary"
              leftIcon="refresh"
              loading={syncJob?.status === "running"}
              onClick={syncDrive}
            >
              {syncJob?.status === "running" ? "Đang sync…" : "Sync Drive"}
            </AppButton>
          }
        />

        {loadErr && (
          <InlineAlert tone="danger" onDismiss={() => setLoadErr("")}>
            {loadErr}
          </InlineAlert>
        )}

        {syncJob && (
          <SectionCard padding="compact">
            <div className="ui-stack--lg" aria-live="polite">
              <div className="ui-row-between">
                <strong className="ui-text-strong">
                  {syncJob.stats.message || "Đồng bộ Drive"}
                </strong>
                <StatusBadge
                  tone={
                    syncJob.status === "success"
                      ? "success"
                      : syncJob.status === "failed"
                        ? "danger"
                        : "info"
                  }
                  size="sm"
                >
                  {syncJob.stats.progress ?? 0}%
                </StatusBadge>
              </div>
              <div
                className="payroll-progress"
                role="progressbar"
                aria-label="Tiến độ đồng bộ Drive"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={syncJob.stats.progress ?? 0}
              >
                <span
                  /* ds-dynamic */
                  style={{ width: `${syncJob.stats.progress ?? 0}%` }}
                />
              </div>
              {syncJob.status === "success" && (
                <div className="ui-muted">
                  {syncJob.stats.files?.length ?? 0} file · {syncJob.stats.imported ?? 0} file mới
                </div>
              )}
              {syncJob.status === "failed" && (
                <div className="ui-text-danger">{syncJob.error}</div>
              )}
            </div>
          </SectionCard>
        )}

        <ResponsiveTabs<PayrollSectionTab>
          variant="segmented"
          ariaLabel="Phân khu bảng lương"
          active={sectionTab}
          onChange={setSectionTab}
          tabs={[
            { id: "all", label: "Tất cả", icon: "layout-dashboard" },
            { id: "hr", label: "Tổng quan HR", icon: "users" },
            { id: "forecast", label: "Dự báo & Thưởng", icon: "trending-up" },
            {
              id: "imports",
              label: "Bảng lương Drive",
              icon: "file-spreadsheet",
              badge: imports.length,
            },
          ]}
        />

        {showHr && (
          <PayrollHrOverview
            year={hrYear}
            summary={hrSummary}
            reload={loadHr}
            setMessage={(msg) => notify(msg, "info")}
          />
        )}

        {showForecast && <PayrollForecastPlanner year={hrYear} />}

        {showImports && (
          <SectionCard
            eyebrow="EXCEL ĐÃ SYNC"
            title="Bảng lương từ Google Drive"
            icon="file-spreadsheet"
            actions={
              <StatusBadge tone="brand" size="sm">
                {imports.length} file
              </StatusBadge>
            }
          >
            {loadingImports ? (
              <TableSkeleton rows={3} cols={4} />
            ) : !imports.length ? (
              <EmptyState
                compact
                icon="file-spreadsheet"
                title="Chưa có file bảng lương"
                description="Chưa có file. Bấm Sync Drive để tải danh sách."
              />
            ) : (
              <div className="ui-select-grid">
                {imports.map((item) => (
                  <AppButton
                    key={item.id}
                    variant="ghost"
                    className={`ui-list-btn payroll-select-btn${importDetail?.id === item.id ? " is-active" : ""}`}
                    onClick={async () => {
                      try {
                        const [detail, latest] = await Promise.all([
                          api.payrollImportDetail(item.id),
                          api.payrollLatestDraft(item.id),
                        ]);
                        setImportDetail(detail);
                        setDraft(latest.draft);
                        setDraftChanges({});
                        setEditRow(null);
                        setNetPlan(null);
                        setShowRawMobile(false);
                        setFocusedCell("");
                      } catch (error) {
                        notify((error as Error).message, "error");
                      }
                    }}
                  >
                    <span className="ui-row-between ui-w-full">
                      <strong className="ui-text-strong">{item.month || "Chưa rõ tháng"}</strong>
                      <StatusBadge
                        tone={item.findings.length ? "warning" : "success"}
                        size="sm"
                      >
                        {item.findings.length} cảnh báo
                      </StatusBadge>
                    </span>
                    <span className="ui-select-meta">{item.filename}</span>
                    <span className="ui-row">
                      <span className="ui-muted">Xem bảng</span>
                      <AppIcon name="arrow-right" size={13} />
                    </span>
                  </AppButton>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {importDetail && (
          <SectionCard
            eyebrow={importDetail.snapshot.sheet}
            title={importDetail.filename}
            icon="file-spreadsheet"
            actions={
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="x"
                onClick={() => setImportDetail(null)}
              >
                Đóng
              </AppButton>
            }
          >
            <div className="ui-stack--lg">
              {importDetail.findings.length > 0 && (
                <div className="ui-stack--sm">
                  {importDetail.findings.map((finding, index) => (
                    <AppButton
                      key={index}
                      variant="ghost"
                      className={`ui-list-btn tax-finding-btn ${finding.level === "do" ? "is-danger" : "is-warning"}`}
                      onClick={() => openFinding(finding.cells?.[0])}
                    >
                      <span className="ui-row-between ui-w-full">
                        <span>{finding.message}</span>
                        {finding.cells?.length ? (
                          <strong className="ui-text-strong">
                            Xem ô {finding.cells[0]}
                          </strong>
                        ) : null}
                      </span>
                    </AppButton>
                  ))}
                </div>
              )}

              <SectionCard tone="subtle" padding="compact">
                <div className="ui-stack--lg">
                  <div className="ui-row-between">
                    <div>
                      <h3 className="ui-text-strong">Điều chỉnh và lưu nháp</h3>
                      <p className="ui-muted">
                        Chọn nhân viên, nhập khoản cần sửa. Ô làm thêm giờ để trống sẽ giữ nguyên
                        công thức cũ.
                      </p>
                    </div>
                    {draft && (
                      <StatusBadge
                        tone={
                          draft.status === "uploaded"
                            ? "success"
                            : draft.status === "reviewed"
                              ? "info"
                              : "warning"
                        }
                      >
                        {draft.status === "draft"
                          ? "Bản nháp"
                          : draft.status === "reviewed"
                            ? "Đã review"
                            : "Đã gửi Drive"}
                      </StatusBadge>
                    )}
                  </div>

                  <div className="ui-select-strip">
                    {importDetail.snapshot.grid
                      .slice(14)
                      .map((row, index) => ({ row, excelRow: index + 15 }))
                      .filter(({ row }) => row[1] || row[2])
                      .map(({ row, excelRow }) => (
                        <AppButton
                          key={excelRow}
                          variant="ghost"
                          className={`ui-list-btn payroll-select-btn${editRow === excelRow ? " is-active" : ""}`}
                          onClick={() => {
                            setEditRow(excelRow);
                            setNetPlan(null);
                            setTargetNet(row[35] || "");
                            setAllowTaxableBonus(false);
                            if (!draftChanges[excelRow]) {
                              updateDraftChange(excelRow, {
                                meal_allowance: numberValue(row[8]),
                                attendance_bonus: numberValue(row[12]),
                              });
                            }
                          }}
                        >
                          <strong className="ui-text-strong">{row[1]}</strong>
                          <span className="ui-select-meta">{row[2]}</span>
                        </AppButton>
                      ))}
                  </div>

                  {editRow &&
                    (() => {
                      const source = importDetail.snapshot.grid[editRow - 1] || [];
                      const change = draftChanges[editRow] || { row: editRow, reason: "" };
                      return (
                        <div className="ui-stack--lg">
                          <FormGrid cols={2}>
                            <FormField
                              label="Tiền ăn"
                              htmlFor="payroll-meal"
                              hint="Mức miễn thuế từ 01/07/2026: tối đa 1.200.000 đồng."
                            >
                              <input
                                id="payroll-meal"
                                className="ui-input"
                                aria-label="Tiền ăn"
                                type="number"
                                min="0"
                                value={change.meal_allowance ?? numberValue(source[8])}
                                onChange={(e) =>
                                  updateDraftChange(editRow, {
                                    meal_allowance: Number(e.target.value),
                                  })
                                }
                              />
                            </FormField>

                            <FormField label="Chuyên cần / thưởng" htmlFor="payroll-bonus">
                              <input
                                id="payroll-bonus"
                                className="ui-input"
                                aria-label="Chuyên cần hoặc thưởng"
                                type="number"
                                min="0"
                                value={change.attendance_bonus ?? numberValue(source[12])}
                                onChange={(e) =>
                                  updateDraftChange(editRow, {
                                    attendance_bonus: Number(e.target.value),
                                  })
                                }
                              />
                            </FormField>

                            <FormField label="Giờ làm thêm trong tuần" htmlFor="payroll-ot-week">
                              <input
                                id="payroll-ot-week"
                                className="ui-input"
                                aria-label="Giờ làm thêm trong tuần"
                                type="number"
                                min="0"
                                max="400"
                                placeholder="Để trống nếu giữ nguyên"
                                value={change.overtime_weekday_hours ?? ""}
                                onChange={(e) =>
                                  updateDraftChange(editRow, {
                                    overtime_weekday_hours:
                                      e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </FormField>

                            <FormField label="Giờ làm thêm cuối tuần" htmlFor="payroll-ot-weekend">
                              <input
                                id="payroll-ot-weekend"
                                className="ui-input"
                                aria-label="Giờ làm thêm cuối tuần"
                                type="number"
                                min="0"
                                max="400"
                                placeholder="Để trống nếu giữ nguyên"
                                value={change.overtime_weekend_hours ?? ""}
                                onChange={(e) =>
                                  updateDraftChange(editRow, {
                                    overtime_weekend_hours:
                                      e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </FormField>

                            <FormField
                              label="Lý do điều chỉnh"
                              htmlFor="payroll-reason"
                              fullWidth
                            >
                              <textarea
                                id="payroll-reason"
                                className="ui-textarea"
                                aria-label="Lý do điều chỉnh"
                                value={change.reason || ""}
                                onChange={(e) =>
                                  updateDraftChange(editRow, { reason: e.target.value })
                                }
                              />
                            </FormField>
                          </FormGrid>

                          <aside
                            className="payroll-legal-guide"
                            aria-label="Quy định ghi nhận lương và làm thêm từ 01/07/2026"
                          >
                            <SectionCard padding="compact">
                              <div className="ui-stack--lg">
                                <div className="ui-row-between">
                                  <div>
                                    <div className="ui-section-card-eyebrow">
                                      CĂN CỨ &amp; CÁCH GHI
                                    </div>
                                    <h4 className="ui-text-strong">
                                      Kiểm tra trước khi lưu lương
                                    </h4>
                                  </div>
                                  <StatusBadge tone="brand" size="sm">
                                    Điều 98, 107 · BLLĐ 2019
                                  </StatusBadge>
                                </div>

                                <div className="ui-grid-2">
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">
                                      12 giờ/ngày không phải 12 giờ tăng ca
                                    </b>
                                    <p>
                                      Thông thường là 8 giờ làm việc + tối đa 4 giờ làm thêm. Không
                                      quá 40 giờ làm thêm trong tháng.
                                    </p>
                                  </article>
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">Đúng hệ số trả lương</b>
                                    <p>
                                      Ngày thường 150% · Ngày nghỉ hằng tuần 200% · Ngày lễ, Tết
                                      300%; làm ban đêm có phần cộng thêm.
                                    </p>
                                  </article>
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">Ghi đúng giờ đã làm</b>
                                    <p>
                                      Không sửa giảm giờ đã làm thực tế để làm đẹp hồ sơ. Giờ vượt
                                      giới hạn vẫn phải trả đủ và được cảnh báo tuân thủ.
                                    </p>
                                  </article>
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">Thưởng hiệu quả kinh doanh</b>
                                    <p>
                                      Thưởng hiệu quả kinh doanh chịu thuế TNCN. Khoản biến động
                                      theo KPI thường không vào nền BHXH khi có quy chế và quyết
                                      định riêng.
                                    </p>
                                  </article>
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">Quyết toán TNCN cuối năm</b>
                                    <p>
                                      Thuế khấu trừ từng tháng là tạm tính. Công ty quyết toán thay
                                      khi người lao động đủ điều kiện và có ủy quyền; cuối năm đối
                                      chiếu để nộp thêm hoặc xử lý số nộp thừa.
                                    </p>
                                  </article>
                                  <article className="ui-subpanel ui-subpanel--1">
                                    <b className="ui-text-strong">Giảm trừ giáo dục</b>
                                    <p>
                                      Tối đa 24 triệu đồng/năm theo chi phí thực tế có hóa đơn tại
                                      cơ sở trong nước. Cá nhân tự quyết toán nếu yêu cầu khoản này;
                                      công ty không tự trừ vào thuế tháng.
                                    </p>
                                  </article>
                                </div>

                                <InlineAlert tone="warning">
                                  <strong>Từ 01/07/2026:</strong> tiền ăn tối đa 1.200.000
                                  đồng/tháng theo chính sách đang cấu hình. Hoàn chi điện thoại,
                                  xăng xe, công tác chỉ ghi khi có quy chế và chứng từ thật.
                                </InlineAlert>
                              </div>
                            </SectionCard>
                          </aside>

                          <SectionCard padding="compact">
                            <div className="ui-stack--lg">
                              <div>
                                <div className="ui-section-card-eyebrow">TÍNH NHANH HỢP PHÁP</div>
                                <h4 className="ui-text-strong">Thực lĩnh mục tiêu</h4>
                                <p className="ui-muted">
                                  Chỉ cần nhập thực lĩnh. Hệ thống tự sửa tiền ăn đúng trần và tự
                                  tính dư địa làm thêm trong giới hạn tháng.
                                </p>
                              </div>

                              <div className="ui-row ui-row--md ui-row--bottom">
                                <FormField
                                  label="Thực lĩnh muốn nhận"
                                  htmlFor="payroll-target-net"
                                  className="ui-grow"
                                >
                                  <input
                                    id="payroll-target-net"
                                    className="ui-input"
                                    aria-label="Thực lĩnh muốn nhận"
                                    type="number"
                                    min="1"
                                    value={targetNet}
                                    onChange={(e) => setTargetNet(e.target.value)}
                                  />
                                </FormField>
                                <AppButton
                                  variant="secondary"
                                  leftIcon="calculator"
                                  disabled={draftBusy}
                                  onClick={calculateTargetNet}
                                >
                                  Tự tính phương án
                                </AppButton>
                              </div>

                              <label className="ui-check-label">
                                <input
                                  type="checkbox"
                                  checked={allowTaxableBonus}
                                  onChange={(e) => {
                                    setAllowTaxableBonus(e.target.checked);
                                    setNetPlan(null);
                                  }}
                                />
                                <span>
                                  <strong className="ui-text-strong">
                                    Khớp thực lĩnh bằng thưởng hiệu quả chịu thuế
                                  </strong>
                                  <div className="ui-muted">
                                    Chỉ bật khi chấp nhận TNCN tăng; BHXH giữ nguyên nếu thưởng biến
                                    động có KPI và quyết định riêng.
                                  </div>
                                </span>
                              </label>

                              {netPlan && (
                                <div className="ui-stack--lg" aria-live="polite">
                                  <InlineAlert
                                    tone={netPlan.feasible ? "success" : "warning"}
                                    title={
                                      netPlan.feasible
                                        ? "Đủ dư địa hợp pháp"
                                        : `Còn thiếu ${money(netPlan.shortfall)} đồng`
                                    }
                                  >
                                    {netPlan.proposed_pit === netPlan.current_pit
                                      ? "Thuế TNCN và BHXH người lao động đều giữ nguyên."
                                      : `Thuế TNCN tăng ${money(netPlan.proposed_pit - netPlan.current_pit)} đồng; BHXH giữ nguyên.`}
                                  </InlineAlert>

                                  <div
                                    className="cashflow-table"
                                    aria-label="So sánh dòng tiền với file đã submit"
                                  >
                                    <div className="cashflow-head">
                                      <span>Khoản</span>
                                      <span>File submit</span>
                                      <span>Đề xuất</span>
                                      <span>Chênh lệch</span>
                                    </div>
                                    {netPlan.cashflows.map((row) => {
                                      const employeeIncome =
                                        row.key === "net" ||
                                        row.key === "meal" ||
                                        row.key === "overtime";
                                      const companyOutflow = row.key === "employer_cost";
                                      const better = employeeIncome
                                        ? row.delta > 0
                                        : companyOutflow
                                          ? row.delta < 0
                                          : row.delta < 0;
                                      const tone =
                                        row.delta === 0 ? "same" : better ? "better" : "worse";
                                      return (
                                        <div className={`cashflow-row ${tone}`} key={row.key}>
                                          <strong>{row.label}</strong>
                                          <span>{money(row.current)}</span>
                                          <span>{money(row.proposed)}</span>
                                          <b>
                                            {row.delta > 0 ? "+" : ""}
                                            {money(row.delta)}
                                          </b>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {netPlan.warnings.map((warning) => (
                                    <InlineAlert tone="danger" key={warning}>
                                      {warning}
                                    </InlineAlert>
                                  ))}

                                  <InlineAlert tone="warning" title="Hồ sơ phụ thuộc">
                                    {netPlan.dependencies.map((item) => (
                                      <div key={item}>• {item}</div>
                                    ))}
                                  </InlineAlert>

                                  <div>
                                    <AppButton
                                      variant="primary"
                                      leftIcon="save"
                                      disabled={draftBusy}
                                      onClick={applyTargetNetPlan}
                                    >
                                      {netPlan.feasible
                                        ? "Áp dụng và lưu bản nháp"
                                        : "Lưu phần điều chỉnh hợp lệ"}
                                    </AppButton>
                                  </div>
                                </div>
                              )}
                            </div>
                          </SectionCard>
                        </div>
                      );
                    })()}

                  <div className="ui-row">
                    <AppButton
                      variant="primary"
                      leftIcon="save"
                      loading={draftBusy}
                      disabled={!Object.keys(draftChanges).length}
                      onClick={saveWorkbookDraft}
                    >
                      {draftBusy ? "Đang xử lý…" : "Lưu bản nháp"}
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      leftIcon="shield-check"
                      disabled={draftBusy || !draft || draft.status !== "draft"}
                      onClick={reviewWorkbookDraft}
                    >
                      Chạy lại review
                    </AppButton>
                    <AppButton
                      variant="gold"
                      leftIcon="cloud-upload"
                      disabled={
                        draftBusy ||
                        !draft ||
                        draft.status !== "reviewed" ||
                        draft.findings.some((finding) => finding.level === "do")
                      }
                      onClick={uploadWorkbookDraft}
                    >
                      Cập nhật file gốc trên Drive
                    </AppButton>
                  </div>

                  {draft?.findings.map((finding, index) => (
                    <InlineAlert
                      key={index}
                      tone={finding.level === "do" ? "danger" : "warning"}
                    >
                      {finding.message}
                    </InlineAlert>
                  ))}
                </div>
              </SectionCard>

              <div
                className="payroll-mobile-excel"
                aria-label={`Tóm tắt bảng lương ${importDetail.month}`}
              >
                {importDetail.snapshot.grid
                  .slice(14)
                  .filter((row) => row[1] || row[2])
                  .map((row, index) => (
                    <MobileCard key={index}>
                      <MobileCardHeader
                        title={row[1] || `Dòng ${index + 15}`}
                        subtitle={row[2] || "Chưa có tên"}
                        badge={
                          <StatusBadge tone="brand" size="sm">
                            {excelMoney(row[35])} · Thực lĩnh
                          </StatusBadge>
                        }
                      />
                      <MobileCardGrid cols={2}>
                        <MobileCardRow label="Lương cơ bản" value={excelMoney(row[3])} mono />
                        <MobileCardRow label="Ngày công" value={row[5] || "—"} mono />
                        <MobileCardRow label="Gross" value={excelMoney(row[16])} mono />
                        <MobileCardRow label="Nền BHXH" value={excelMoney(row[17])} mono />
                        <MobileCardRow label="TNCN" value={excelMoney(row[32])} mono />
                        <MobileCardRow label="Chi phí DN" value={excelMoney(row[36])} mono />
                      </MobileCardGrid>
                    </MobileCard>
                  ))}
                <AppButton
                  variant="secondary"
                  fullWidth
                  leftIcon={showRawMobile ? "eye-off" : "eye"}
                  onClick={() => setShowRawMobile((value) => !value)}
                >
                  {showRawMobile ? "Ẩn bảng gốc" : "Xem bảng Excel gốc"}
                </AppButton>
              </div>

              <div
                className={`ui-sheet-wrap excel-grid${showRawMobile ? " mobile-open" : ""}`}
                tabIndex={0}
                aria-label={`Nội dung bảng lương ${importDetail.month}`}
              >
                <table>
                  <tbody>
                    {importDetail.snapshot.grid.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, colIndex) => {
                          const coordinate = cellName(rowIndex, colIndex);
                          return (
                            <td
                              id={`payroll-cell-${importDetail.id}-${coordinate}`}
                              key={colIndex}
                              className={[
                                rowIndex >= 14 && colIndex >= 1 ? "payroll-data" : "",
                                focusedCell === coordinate ? "cell-focus" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={coordinate}
                            >
                              {cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>
        )}
      </div>
    </PageShell>
  );
}
