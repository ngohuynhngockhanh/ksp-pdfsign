import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  TaxFinding,
  TaxGrid,
  TaxPolicy,
  TaxReport,
  TaxReviewItem,
  TaxReviewSummary,
} from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SectionCard,
  SplitWorkspace,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";

function vnd(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("vi-VN");
}

const thisYear = new Date().getFullYear();
const KY_OPTS: string[] = [];
for (const y of [thisYear, thisYear - 1]) {
  for (const q of [4, 3, 2, 1]) KY_OPTS.push(`${y}-Q${q}`);
}
const curQuarter = Math.floor(new Date().getMonth() / 3) + 1;
const DEFAULT_KY = `${thisYear}-Q${curQuarter}`;

/** Mã chỉ tiêu bị đánh lỗi -> tô đỏ ô trong grid. */
function flaggedCodes(findings: TaxFinding[]): Set<string> {
  const s = new Set<string>();
  for (const f of findings) {
    for (const c of f.cells) {
      if (/^\d+[a-z]?$/.test(c)) s.add(c);
    }
  }
  return s;
}

function Findings({
  findings,
  active,
  onSelect,
}: {
  findings: TaxFinding[];
  active: number;
  onSelect: (index: number) => void;
}) {
  if (!findings.length) {
    return (
      <InlineAlert tone="success">
        Không phát hiện lỗi tự động. Vẫn nên soát lại chứng từ gốc.
      </InlineAlert>
    );
  }
  return (
    <div className="ui-stack--sm">
      {findings.map((f, i) => (
        <AppButton
          key={i}
          variant="ghost"
          className={`ui-list-btn tax-finding-btn ${f.level === "do" ? "is-danger" : "is-warning"}${active === i ? " is-active" : ""}`}
          onClick={() => onSelect(i)}
        >
          <span className="ui-row">
            <StatusBadge tone={f.level === "do" ? "danger" : "warning"} size="sm">
              {f.level === "do" ? "ĐỎ" : "VÀNG"}
            </StatusBadge>
            <strong className="ui-text-strong">{f.title}</strong>
          </span>
          <span className="ui-muted">{f.detail}</span>
          <span className="ui-row">
            <span className="ui-text-success">Xem vùng lỗi trong Excel</span>
            <AppIcon name="arrow-right" size={14} />
          </span>
        </AppButton>
      ))}
    </div>
  );
}

function Summary({ s }: { s: TaxReviewSummary }) {
  return (
    <KpiStrip
      columns={3}
      items={[
        { label: "Doanh thu bán ra", value: vnd(s.ban_ra_dt), tone: "brand" },
        { label: "Thuế bán ra [35]", value: vnd(s.ban_ra_thue), tone: "info" },
        { label: "Mua vào [23]", value: vnd(s.mua_vao_dt), tone: "neutral" },
        { label: "Thuế mua vào [25]", value: vnd(s.mua_vao_thue), tone: "info" },
        { label: "Khấu trừ kỳ trước [22]", value: vnd(s.khau_tru_ky_truoc), tone: "neutral" },
        { label: "Phát sinh [36]", value: vnd(s.ct_36), tone: "brand" },
        {
          label: "Phải nộp [40]",
          value: vnd(s.ct_40),
          tone: (s.ct_40 ?? 0) > 0 ? "warning" : "success",
        },
        { label: "Chuyển kỳ sau [43]", value: vnd(s.ct_43), tone: "success" },
        { label: "Số HĐ bán / mua", value: `${s.so_hd_ban} / ${s.so_hd_mua}`, tone: "neutral" },
      ]}
    />
  );
}

function GridView({
  grid,
  flags,
  focusCode,
}: {
  grid: TaxGrid;
  flags: Set<string>;
  focusCode: string;
}) {
  const covered = new Set<string>();
  const anchor = new Map<string, { rs: number; cs: number }>();
  for (const [r1, c1, r2, c2] of grid.merges) {
    anchor.set(`${r1},${c1}`, { rs: r2 - r1 + 1, cs: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (!(r === r1 && c === c1)) covered.add(`${r},${c}`);
      }
    }
  }
  return (
    <DataView
      mobileMode="scroll"
      desktop={
        <div className="ui-sheet-wrap">
          <table className="ui-sheet-table">
            <tbody>
              {grid.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    if (covered.has(`${r},${c}`)) return null;
                    const a = anchor.get(`${r},${c}`);
                    const code = cell.trim().replace(/^\[|\]$/g, "");
                    const flagged = /^\[\d+[a-z]?\]$/.test(cell.trim()) && flags.has(code);
                    const prev = c > 0 ? row[c - 1].trim() : "";
                    const prevFlag =
                      /^\[\d+[a-z]?\]$/.test(prev) && flags.has(prev.replace(/^\[|\]$/g, ""));
                    const num = /^[\d.,\-]+$/.test(cell.trim()) && cell.trim() !== "";
                    return (
                      <td
                        key={c}
                        id={/^\[\d+[a-z]?\]$/.test(cell.trim()) ? `tax-cell-${code}` : undefined}
                        rowSpan={a?.rs}
                        colSpan={a?.cs}
                        className={[
                          flagged || (prevFlag && cell.trim()) ? "flag" : "",
                          focusCode === code ? "focus-cell" : "",
                          num ? "num" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
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
      }
    />
  );
}

function FindingSnapshot({ grid, code }: { grid: TaxGrid; code: string }) {
  const hit = grid.rows.findIndex((row) => row.some((cell) => cell.trim() === `[${code}]`));
  if (hit < 0) return null;
  const from = Math.max(0, hit - 2);
  return (
    <div className="ui-subpanel ui-stack--sm">
      <div className="ui-row-between">
        <StatusBadge tone="brand" size="sm" icon="scan-line">
          Ảnh chụp vùng Excel liên quan · [{code}]
        </StatusBadge>
      </div>
      <DataView
        mobileMode="scroll"
        desktop={
          <div className="ui-sheet-wrap">
            <table className="ui-sheet-table">
              <tbody>
                {grid.rows.slice(from, hit + 3).map((row, i) => (
                  <tr key={from + i}>
                    {row.map((cell, c) => (
                      <td key={c} className={cell.trim() === `[${code}]` ? "focus-cell" : ""}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />
    </div>
  );
}

export function TaxReview() {
  const askConfirm = useConfirm();
  const toast = useToast();
  const [kyFilter, setKyFilter] = useState("");
  const [list, setList] = useState<TaxReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<{
    id: number;
    ky: string;
    ten_file: string;
    note: string;
    findings: TaxFinding[];
    summary: TaxReviewSummary;
    grids: TaxGrid[];
  } | null>(null);
  const [sheet, setSheet] = useState(0);
  const [ky, setKy] = useState(DEFAULT_KY);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState("");
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [diffs, setDiffs] = useState<
    { indicator: string; crm: number; accountant: number; difference: number; match: boolean }[]
  >([]);
  const [activeFinding, setActiveFinding] = useState(-1);
  const [focusCode, setFocusCode] = useState("");
  const [policy, setPolicy] = useState<TaxPolicy | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    setLoading(true);
    try {
      const [uploads, reportRows] = await Promise.all([
        api.taxReviewList(kyFilter),
        api.taxReports(),
      ]);
      setList(uploads);
      setReports(reportRows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    api
      .taxPolicy()
      .then(setPolicy)
      .catch(() => undefined);
  }, [kyFilter]);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.taxReviewUpload(files[0], ky, note);
      setNote("");
      toast.success("Đã tải lên và rà soát file tờ khai.");
      await reload();
      await open(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(id: number) {
    setErr("");
    try {
      const d = await api.taxReviewDetail(id);
      setSel(d);
      setSheet(0);
      setActiveFinding(-1);
      setFocusCode("");
      setDiffs([]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function del(id: number) {
    const ok = await askConfirm({
      title: "Xóa phiên bản tờ khai?",
      message: "Phiên bản BCT này sẽ bị xóa khỏi danh sách đối chiếu.",
      confirmLabel: "Xóa phiên bản",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.taxReviewDelete(id);
      if (sel?.id === id) setSel(null);
      toast.success("Đã xóa phiên bản tờ khai.");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const flags = useMemo(() => (sel ? flaggedCodes(sel.findings) : new Set<string>()), [sel]);
  const matchingReport = sel ? reports.find((r) => r.ky === sel.ky) : undefined;

  async function compare() {
    if (!sel || !matchingReport) return;
    setErr("");
    try {
      const res = await api.compareTaxReport(matchingReport.id, sel.id);
      setDiffs(res.differences);
      const mismatched = res.differences.filter((d) => !d.match).length;
      toast.info(
        mismatched
          ? `Phát hiện ${mismatched} chỉ tiêu lệch giữa CRM và file kế toán.`
          : "Tất cả chỉ tiêu CRM và file kế toán đều khớp.",
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function lockReport() {
    if (!matchingReport) return;
    const ok = await askConfirm({
      title: `Khóa bản đối chiếu ${matchingReport.ky}?`,
      message: "Job tự động sẽ không sửa bản này sau khi khóa.",
      confirmLabel: "Khóa bản CRM",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await api.lockTaxReport(matchingReport.id);
      toast.success(`Đã khóa bản đối chiếu CRM ${matchingReport.ky}.`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function generateReport() {
    setErr("");
    try {
      await api.generateTaxReport(ky);
      toast.success(`Đã sinh / cập nhật bản tính CRM cho ${ky}.`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function selectFinding(index: number) {
    if (!sel) return;
    const code = sel.findings[index].cells.find((c) => /^\d+[a-z]?$/.test(c)) || "";
    setActiveFinding(index);
    setFocusCode(code);
    if (!code) return;
    const gridIndex = sel.grids.findIndex((g) =>
      g.rows.some((row) => row.some((cell) => cell.trim() === `[${code}]`)),
    );
    if (gridIndex >= 0) setSheet(gridIndex);
    window.setTimeout(() => {
      document
        .getElementById(`tax-cell-${code}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 100);
  }

  const currentReport = reports.find((r) => r.ky === ky);

  return (
    <PageShell data-page="tax-review">
      <div className="ui-stack--lg">
        <PageHeader
          variant="compact"
          icon="calculator"
          eyebrow="VAT CONTROL ROOM"
          title="Review tờ khai quý"
          subtitle="Đối chiếu file kế toán với XML hóa đơn, chính sách theo ngày và dữ liệu CRM."
          badges={
            <>
              <StatusBadge tone="brand" icon="calendar">
                Kỳ đang làm: {ky}
              </StatusBadge>
              <StatusBadge tone={policy?.reduction_active ? "success" : "info"}>
                {policy?.reduction_active
                  ? "Checkpoint giảm thuế 8% đang hiệu lực"
                  : "Áp chính sách theo ngày hóa đơn"}
              </StatusBadge>
            </>
          }
        />

        <InlineAlert
          tone="warning"
          title="Phần mềm KCT → [26]"
          action={
            policy ? (
              <StatusBadge tone="warning" size="sm" className="ui-wrap">
                {policy.legal_basis.join(" · ")}
              </StatusBadge>
            ) : undefined
          }
        >
          Không đưa vào 0% [29]. Nhóm đủ điều kiện giảm còn 8% đến 31/12/2026; nhóm loại trừ vẫn
          10%.
        </InlineAlert>

        <FormGrid cols={2}>
          <SectionCard
            title="Nhận file kế toán"
            subtitle="Upload và lưu từng phiên bản (.xlsx)"
            icon="file-up"
            padding="compact"
          >
            <div className="ui-stack--lg">
              <FormGrid cols={2}>
                <FormField label="Kỳ tờ khai" htmlFor="tax-rev-ky">
                  <select
                    id="tax-rev-ky"
                    className="ui-select"
                    value={ky}
                    onChange={(e) => setKy(e.target.value)}
                  >
                    {KY_OPTS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Ghi chú phiên bản" htmlFor="tax-rev-note">
                  <input
                    id="tax-rev-note"
                    className="ui-input"
                    placeholder="Ghi chú phiên bản"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </FormField>
              </FormGrid>

              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => upload(e.target.files)}
              />
              <div
                className={`ui-dropzone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => !busy && fileRef.current?.click()}
                onKeyDown={(e) =>
                  !busy && (e.key === "Enter" || e.key === " ") && fileRef.current?.click()
                }
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragging(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) upload(e.dataTransfer.files);
                }}
              >
                <span className="ui-dropzone-icon ui-dropzone-icon--solid" aria-hidden="true">
                  <AppIcon name={busy ? "loader" : "file-spreadsheet"} size={20} />
                </span>
                <div>
                  <div className="ui-text-strong">
                    {busy ? "Đang rà soát…" : "Thả file XLSX vào đây"}
                  </div>
                  <div className="ui-muted">hoặc bấm để chọn từ máy</div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Bản tính từ CRM"
            subtitle="Tách KCT · 8% · 10% theo hóa đơn"
            icon="database"
            padding="compact"
            actions={
              <StatusBadge tone={currentReport?.status === "locked" ? "success" : "info"}>
                {currentReport?.status === "locked" ? "Đã khóa" : "Bản nháp tự cập nhật"}
              </StatusBadge>
            }
          >
            <div className="ui-stack--lg">
              <div className="ui-row-between">
                <div>
                  <div className="ui-muted">Phiên bản hiện tại</div>
                  <strong className="ui-text-strong">
                    {currentReport ? `v${currentReport.version}` : "Chưa sinh"}
                  </strong>
                </div>
                <div className="ui-row">
                  <AppButton variant="primary" leftIcon="sparkles" onClick={generateReport}>
                    Sinh / cập nhật {ky}
                  </AppButton>
                  {currentReport && (
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--md"
                      href={api.taxReportFileUrl(currentReport.id)}
                    >
                      <AppIcon name="download" size={16} />
                      <span>Tải XLSX</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>
        </FormGrid>

        {err && (
          <InlineAlert tone="danger" onDismiss={() => setErr("")}>
            {err}
          </InlineAlert>
        )}

        <SplitWorkspace
          variant="sidebar-left"
          mobileTabs={["Phiên bản & Lỗi", "Bảng tính Excel"]}
          primary={
            <div className="ui-stack--lg">
              <SectionCard
                eyebrow="PHIÊN BẢN"
                title="File kế toán"
                icon="folder"
                padding="compact"
                actions={
                  <select
                    aria-label="Lọc theo kỳ"
                    className="ui-select"
                    value={kyFilter}
                    onChange={(e) => setKyFilter(e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {KY_OPTS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                }
              >
                {loading ? (
                  <TableSkeleton rows={4} cols={2} />
                ) : list.length === 0 ? (
                  <EmptyState
                    compact
                    icon="file-spreadsheet"
                    title="Chưa có file BCT"
                    description="Tải file Excel (.xlsx) từ khung Nhận file kế toán để bắt đầu."
                  />
                ) : (
                  <div className="ui-stack--sm">
                    {list.map((r) => (
                      <div
                        key={r.id}
                        className={`ui-subpanel ui-subpanel--1 ui-clickable tax-version-card${sel?.id === r.id ? " is-active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => open(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(r.id);
                          }
                        }}
                      >
                        <div className="ui-row-between">
                          <strong className="ui-text-strong">{r.ky || "Chưa rõ kỳ"}</strong>
                          <StatusBadge
                            tone={r.n_do ? "danger" : r.n_vang ? "warning" : "success"}
                            size="sm"
                          >
                            {r.n_do ? `${r.n_do} đỏ` : r.n_vang ? `${r.n_vang} vàng` : "OK"}
                          </StatusBadge>
                        </div>
                        <b className="tax-version-file">{r.ten_file}</b>
                        <div className="ui-muted">{r.note || "Không có ghi chú"}</div>
                        <div className="ui-row-between">
                          <span className="ui-muted">
                            {r.uploaded_at?.slice(0, 16).replace("T", " ")}
                          </span>
                          <span
                            className="ui-row"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <a
                              className="ui-btn ui-btn--ghost ui-btn--sm"
                              href={api.taxReviewFileUrl(r.id)}
                            >
                              Tải
                            </a>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              onClick={() => del(r.id)}
                            >
                              Xóa
                            </AppButton>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {sel && (
                <SectionCard
                  eyebrow="KẾT QUẢ RÀ SOÁT"
                  title="Cảnh báo tự động"
                  icon="shield-alert"
                  padding="compact"
                  actions={
                    <StatusBadge
                      tone={sel.findings.length ? "danger" : "success"}
                      size="sm"
                    >
                      {sel.findings.length}
                    </StatusBadge>
                  }
                >
                  <Findings
                    findings={sel.findings}
                    active={activeFinding}
                    onSelect={selectFinding}
                  />
                </SectionCard>
              )}
            </div>
          }
          secondary={
            !sel ? (
              <SectionCard>
                <EmptyState
                  icon="file-search"
                  title="Chọn một phiên bản để bắt đầu"
                  description="Hoặc tải file Excel mới ở khu vực phía trên. CRM sẽ dò sai nhóm thuế, công thức và chỉ tiêu."
                />
              </SectionCard>
            ) : (
              <div className="ui-stack--lg">
                <SectionCard
                  eyebrow={`ĐANG REVIEW · ${sel.ky}`}
                  title={sel.ten_file}
                  icon="file-spreadsheet"
                  actions={
                    <div className="ui-row">
                      <StatusBadge tone={sel.summary.do ? "danger" : "success"}>
                        {sel.summary.do ? `${sel.summary.do} lỗi cần sửa` : "Không có lỗi đỏ"}
                      </StatusBadge>
                      <StatusBadge tone={sel.summary.vang ? "warning" : "neutral"} size="sm">
                        {sel.summary.vang} điểm cần xác nhận
                      </StatusBadge>
                    </div>
                  }
                >
                  <div className="ui-stack--lg">
                    <Summary s={sel.summary} />

                    {matchingReport && (
                      <div className="ui-row-between">
                        <div className="ui-row">
                          <StatusBadge tone="brand">CRM v{matchingReport.version}</StatusBadge>
                          <AppIcon name="arrow-right" size={14} />
                          <strong className="ui-text-strong">File kế toán</strong>
                        </div>
                        <div className="ui-row">
                          <AppButton
                            variant="primary"
                            size="sm"
                            leftIcon="scale"
                            onClick={compare}
                          >
                            So sánh chỉ tiêu
                          </AppButton>
                          {matchingReport.status === "draft" && (
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="lock"
                              onClick={lockReport}
                            >
                              Khóa bản CRM
                            </AppButton>
                          )}
                        </div>
                      </div>
                    )}

                    {diffs.length > 0 && (
                      <DataView
                        mobileMode="scroll"
                        desktop={
                          <table className="dt ui-table ui-table-sticky-col">
                            <thead>
                              <tr>
                                <th>Chỉ tiêu</th>
                                <th className="num">CRM</th>
                                <th className="num">Kế toán</th>
                                <th>Kết quả</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diffs.map((d) => (
                                <tr key={d.indicator} className={d.match ? "" : "row-neg"}>
                                  <td>[{d.indicator}]</td>
                                  <td className="num">{vnd(d.crm)}</td>
                                  <td className="num">{vnd(d.accountant)}</td>
                                  <td>
                                    <StatusBadge
                                      tone={d.match ? "success" : "danger"}
                                      size="sm"
                                    >
                                      {d.match ? "Khớp" : `Lệch ${vnd(d.difference)}`}
                                    </StatusBadge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        }
                      />
                    )}

                    {activeFinding >= 0 && focusCode && sel.grids[sheet] && (
                      <FindingSnapshot grid={sel.grids[sheet]} code={focusCode} />
                    )}

                    <div className="ui-row-between">
                      <ResponsiveTabs
                        variant="segmented"
                        ariaLabel="Chọn sheet Excel"
                        active={String(sheet)}
                        onChange={(id) => setSheet(Number(id))}
                        tabs={sel.grids.map((g, i) => ({
                          id: String(i),
                          label: g.name,
                        }))}
                      />
                      <span className="ui-muted">
                        {focusCode
                          ? `Đang xem chỉ tiêu [${focusCode}]`
                          : "Bấm cảnh báo để nhảy tới ô liên quan"}
                      </span>
                    </div>

                    {sel.grids[sheet] && (
                      <GridView grid={sel.grids[sheet]} flags={flags} focusCode={focusCode} />
                    )}
                  </div>
                </SectionCard>
              </div>
            )
          }
        />
      </div>
    </PageShell>
  );
}
