import { useEffect, useState } from "react";
import { api, PayrollImportDetail, PayrollImportItem, PayrollNetTargetPlan, PayrollPeriod, PayrollWorkbookChange, PayrollWorkbookDraft } from "../api";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);
const excelMoney = (value = "") => {
  const parsed = Number(String(value).replace(/[,.\s]/g, ""));
  return Number.isFinite(parsed) && parsed !== 0 ? new Intl.NumberFormat("vi-VN").format(parsed) : value || "—";
};

export function Payroll() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selected, setSelected] = useState<PayrollPeriod | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState("");
  const [syncJob, setSyncJob] = useState<Awaited<ReturnType<typeof api.payrollSyncStatus>>["job"]>(null);
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

  function openFinding(cell = "") {
    if (!cell || !importDetail) return;
    setShowRawMobile(true);
    setFocusedCell(cell);
    window.setTimeout(() => document.getElementById(`payroll-cell-${importDetail.id}-${cell}`)?.scrollIntoView({
      behavior: "smooth", block: "center", inline: "center",
    }), 50);
  }

  function cellName(row: number, col: number) {
    let name = "";
    for (let value = col + 1; value > 0; value = Math.floor((value - 1) / 26))
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    return `${name}${row + 1}`;
  }

  function numberValue(value = "") {
    const parsed = Number(String(value).replace(/[,.\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateDraftChange(row: number, patch: Partial<PayrollWorkbookChange>) {
    setDraftChanges((current) => ({ ...current, [row]: {
      ...current[row], ...patch, row,
      reason: patch.reason ?? current[row]?.reason ?? "Điều chỉnh theo tình hình công việc trong tháng",
    }}));
  }

  async function calculateTargetNet() {
    if (!importDetail || !editRow) return;
    if (!targetNet || Number(targetNet) <= 0) { setMessage("Vui lòng nhập số thực lĩnh mục tiêu hợp lệ."); return; }
    try {
      setDraftBusy(true); setMessage("");
      setNetPlan(await api.payrollNetTarget(importDetail.id, {
        row: editRow, target_net: Number(targetNet), allow_taxable_bonus: allowTaxableBonus,
      }));
    } catch (error) { setMessage((error as Error).message); }
    finally { setDraftBusy(false); }
  }

  async function applyTargetNetPlan() {
    if (!editRow || !netPlan || !importDetail) return;
    const nextChange: PayrollWorkbookChange = {
      ...draftChanges[editRow], row: editRow,
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
      setMessage("Đã áp dụng và lưu bản nháp. Hãy chạy review trước khi cập nhật file gốc trên Drive.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setDraftBusy(false); }
  }

  async function saveWorkbookDraft() {
    if (!importDetail) return;
    const changes = Object.values(draftChanges);
    if (!changes.length) { setMessage("Bạn chưa thay đổi dữ liệu nhân viên nào."); return; }
    try {
      setDraftBusy(true);
      const saved = await api.payrollSaveDraft(importDetail.id, changes);
      setDraft(saved); setMessage("Đã lưu bản nháp. Hãy chạy review trước khi gửi lên Drive.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setDraftBusy(false); }
  }

  async function reviewWorkbookDraft() {
    if (!draft) return;
    try { setDraftBusy(true); const reviewed = await api.payrollReviewDraft(draft.id); setDraft(reviewed); setMessage(`Review xong: ${reviewed.findings.length} cảnh báo.`); }
    catch (error) { setMessage((error as Error).message); } finally { setDraftBusy(false); }
  }

  async function uploadWorkbookDraft() {
    if (!draft) return;
    try { setDraftBusy(true); const uploaded = await api.payrollUploadDraft(draft.id); setDraft(uploaded); setMessage(`Đã gửi lên Google Drive: ${uploaded.drive_filename}`); }
    catch (error) { setMessage((error as Error).message); } finally { setDraftBusy(false); }
  }

  async function load(preferred?: number) {
    const [rows, imported] = await Promise.all([api.payrollPeriods(), api.payrollImports()]);
    setPeriods(rows);
    setImports(imported);
    setSelected(rows.find((row) => row.id === preferred) ?? rows[0] ?? null);
  }

  useEffect(() => { load().catch((e) => setMessage((e as Error).message)); }, []);
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api.payrollSyncStatus();
        if (stopped) return;
        setSyncJob(result.job);
        if (result.job?.status === "running") timer = window.setTimeout(poll, 700);
      } catch (error) { if (!stopped) setMessage((error as Error).message); }
    };
    poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  async function syncDrive() {
    try {
      await api.payrollSyncDrive();
      setMessage("");
      const poll = async () => {
        const result = await api.payrollSyncStatus();
        setSyncJob(result.job);
        if (result.job?.status === "running") window.setTimeout(poll, 700);
        else if (result.job?.status === "success") {
          setMessage(`Đã đồng bộ ${result.job.stats.files?.length ?? 0} file, thêm mới ${result.job.stats.imported ?? 0}.`);
          await load(selected?.id);
        }
        else if (result.job?.status === "failed") setMessage(result.job.error || "Đồng bộ thất bại.");
      };
      await poll();
    } catch (error) { setMessage((error as Error).message); }
  }

  async function act(action: () => Promise<PayrollPeriod>) {
    try {
      const row = await action();
      setMessage("Đã cập nhật kỳ lương.");
      await load(row.id);
    } catch (error) { setMessage((error as Error).message); }
  }

  return <div className="payroll-page">
    <section className="payroll-hero">
      <div><p className="eyebrow">NHÂN SỰ · 2026</p><h1>Bảng lương & kiểm soát tuân thủ</h1>
        <p>Tính chuẩn từ dữ liệu CRM, review Excel cũ và khóa sổ theo tháng.</p></div>
      <div className="payroll-actions">
        <input aria-label="Tháng lương" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button onClick={() => act(() => api.payrollCreatePeriod(month))}>Tạo tháng</button>
        <button className="secondary" disabled={syncJob?.status === "running"} onClick={syncDrive}>
          {syncJob?.status === "running" ? "Đang sync…" : "Sync Drive"}
        </button>
      </div>
    </section>
    {syncJob && <section className={`payroll-sync ${syncJob.status}`} aria-live="polite">
      <div className="payroll-sync-head"><strong>{syncJob.stats.message || "Đồng bộ Drive"}</strong><span>{syncJob.stats.progress ?? 0}%</span></div>
      <div className="payroll-progress" role="progressbar" aria-label="Tiến độ đồng bộ Drive" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncJob.stats.progress ?? 0}>
        <span style={{ width: `${syncJob.stats.progress ?? 0}%` }} />
      </div>
      {syncJob.status === "success" && <small>{syncJob.stats.files?.length ?? 0} file · {syncJob.stats.imported ?? 0} file mới</small>}
      {syncJob.status === "failed" && <small>{syncJob.error}</small>}
    </section>}
    {message && <div className="payroll-message">{message}</div>}
    <section className="payroll-imports">
      <header><div><p className="eyebrow">EXCEL ĐÃ SYNC</p><h2>Bảng lương từ Google Drive</h2></div><span>{imports.length} file</span></header>
      {!imports.length ? <p className="muted">Chưa có file. Bấm Sync Drive để tải danh sách.</p> :
        <div className="payroll-import-list">{imports.map((item) => <button key={item.id} onClick={async () => {
          try {
            const [detail, latest] = await Promise.all([api.payrollImportDetail(item.id), api.payrollLatestDraft(item.id)]);
            setImportDetail(detail); setDraft(latest.draft); setDraftChanges({}); setEditRow(null); setNetPlan(null);
            setShowRawMobile(false); setFocusedCell("");
          } catch (error) { setMessage((error as Error).message); }
        }}><strong>{item.month || "Chưa rõ tháng"}</strong><span>{item.filename}</span><small>{item.findings.length} cảnh báo · Xem bảng →</small></button>)}</div>}
    </section>
    {importDetail && <section className="payroll-import-view">
      <header><div><p className="eyebrow">{importDetail.snapshot.sheet}</p><h2>{importDetail.filename}</h2></div><button className="secondary" onClick={() => setImportDetail(null)}>Đóng</button></header>
      {importDetail.findings.map((finding, index) => <button className={`finding finding-jump ${finding.level}`} key={index} onClick={() => openFinding(finding.cells?.[0])}>
        <span>{finding.message}</span>{finding.cells?.length ? <strong>Xem ô {finding.cells[0]} →</strong> : null}
      </button>)}
      <section className="payroll-edit-panel">
        <div className="payroll-edit-intro"><div><h3>Điều chỉnh và lưu nháp</h3><p>Chọn nhân viên, nhập khoản cần sửa. Ô làm thêm giờ để trống sẽ giữ nguyên công thức cũ.</p></div>
          {draft && <span className={`draft-state ${draft.status}`}>{draft.status === "draft" ? "Bản nháp" : draft.status === "reviewed" ? "Đã review" : "Đã gửi Drive"}</span>}
        </div>
        <div className="payroll-edit-people">{importDetail.snapshot.grid.slice(14).map((row, index) => ({ row, excelRow: index + 15 })).filter(({ row }) => row[1] || row[2]).map(({ row, excelRow }) =>
          <button key={excelRow} className={editRow === excelRow ? "active" : ""} onClick={() => {
            setEditRow(excelRow);
            setNetPlan(null); setTargetNet(row[35] || ""); setAllowTaxableBonus(false);
            if (!draftChanges[excelRow]) updateDraftChange(excelRow, { meal_allowance: numberValue(row[8]), attendance_bonus: numberValue(row[12]) });
          }}><strong>{row[1]}</strong><span>{row[2]}</span></button>)}</div>
        {editRow && (() => {
          const source = importDetail.snapshot.grid[editRow - 1] || [];
          const change = draftChanges[editRow] || { row: editRow, reason: "" };
          return <div className="payroll-edit-form">
            <label>Tiền ăn<input aria-label="Tiền ăn" type="number" min="0" value={change.meal_allowance ?? numberValue(source[8])} onChange={(e) => updateDraftChange(editRow, { meal_allowance: Number(e.target.value) })} /><small>Mức miễn thuế từ 01/07/2026: tối đa 1.200.000 đồng.</small></label>
            <label>Chuyên cần / thưởng<input aria-label="Chuyên cần hoặc thưởng" type="number" min="0" value={change.attendance_bonus ?? numberValue(source[12])} onChange={(e) => updateDraftChange(editRow, { attendance_bonus: Number(e.target.value) })} /></label>
            <label>Giờ làm thêm trong tuần<input aria-label="Giờ làm thêm trong tuần" type="number" min="0" max="400" placeholder="Để trống nếu giữ nguyên" value={change.overtime_weekday_hours ?? ""} onChange={(e) => updateDraftChange(editRow, { overtime_weekday_hours: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
            <label>Giờ làm thêm cuối tuần<input aria-label="Giờ làm thêm cuối tuần" type="number" min="0" max="400" placeholder="Để trống nếu giữ nguyên" value={change.overtime_weekend_hours ?? ""} onChange={(e) => updateDraftChange(editRow, { overtime_weekend_hours: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
            <label className="edit-reason">Lý do điều chỉnh<textarea aria-label="Lý do điều chỉnh" value={change.reason || ""} onChange={(e) => updateDraftChange(editRow, { reason: e.target.value })} /></label>
            <aside className="payroll-legal-guide" aria-label="Quy định ghi nhận lương và làm thêm từ 01/07/2026">
              <header><div><p className="eyebrow">CĂN CỨ & CÁCH GHI</p><h4>Kiểm tra trước khi lưu lương</h4></div><span>Điều 98, 107 · BLLĐ 2019</span></header>
              <div className="payroll-rule-grid">
                <article><b>12 giờ/ngày không phải 12 giờ tăng ca</b><p>Thông thường là 8 giờ làm việc + tối đa 4 giờ làm thêm. Không quá 40 giờ làm thêm trong tháng.</p></article>
                <article><b>Đúng hệ số trả lương</b><p>Ngày thường 150% · Ngày nghỉ hằng tuần 200% · Ngày lễ, Tết 300%; làm ban đêm có phần cộng thêm.</p></article>
                <article><b>Ghi đúng giờ đã làm</b><p>Không sửa giảm giờ đã làm thực tế để làm đẹp hồ sơ. Giờ vượt giới hạn vẫn phải trả đủ và được cảnh báo tuân thủ.</p></article>
                <article><b>Thưởng hiệu quả kinh doanh</b><p>Thưởng hiệu quả kinh doanh chịu thuế TNCN. Khoản biến động theo KPI thường không vào nền BHXH khi có quy chế và quyết định riêng.</p></article>
                <article><b>Quyết toán TNCN cuối năm</b><p>Thuế khấu trừ từng tháng là tạm tính. Công ty quyết toán thay khi người lao động đủ điều kiện và có ủy quyền; cuối năm đối chiếu để nộp thêm hoặc xử lý số nộp thừa.</p></article>
                <article><b>Giảm trừ giáo dục</b><p>Tối đa 24 triệu đồng/năm theo chi phí thực tế có hóa đơn tại cơ sở trong nước. Cá nhân tự quyết toán nếu yêu cầu khoản này; công ty không tự trừ vào thuế tháng.</p></article>
              </div>
              <footer><strong>Từ 01/07/2026:</strong> tiền ăn tối đa 1.200.000 đồng/tháng theo chính sách đang cấu hình. Hoàn chi điện thoại, xăng xe, công tác chỉ ghi khi có quy chế và chứng từ thật.</footer>
            </aside>
            <section className="net-target-panel">
              <div><p className="eyebrow">TÍNH NHANH HỢP PHÁP</p><h4>Thực lĩnh mục tiêu</h4>
                <p>Chỉ cần nhập thực lĩnh. Hệ thống tự sửa tiền ăn đúng trần và tự tính dư địa làm thêm trong giới hạn tháng.</p></div>
              <div className="net-target-inputs">
                <label>Thực lĩnh muốn nhận<input aria-label="Thực lĩnh muốn nhận" type="number" min="1" value={targetNet} onChange={(e) => setTargetNet(e.target.value)} /></label>
                <button type="button" disabled={draftBusy} onClick={calculateTargetNet}>Tự tính phương án</button>
              </div>
              <label className="taxable-bonus-toggle"><input type="checkbox" checked={allowTaxableBonus} onChange={(e) => { setAllowTaxableBonus(e.target.checked); setNetPlan(null); }} />
                <span><b>Khớp thực lĩnh bằng thưởng hiệu quả chịu thuế</b><small>Chỉ bật khi chấp nhận TNCN tăng; BHXH giữ nguyên nếu thưởng biến động có KPI và quyết định riêng.</small></span>
              </label>
              {netPlan && <div className="net-target-result" aria-live="polite">
                <div className={`net-target-status ${netPlan.feasible ? "ok" : "short"}`}>
                  <strong>{netPlan.feasible ? "Đủ dư địa hợp pháp" : `Còn thiếu ${money(netPlan.shortfall)} đồng`}</strong>
                  <span>{netPlan.proposed_pit === netPlan.current_pit ? "Thuế TNCN và BHXH người lao động đều giữ nguyên." : `Thuế TNCN tăng ${money(netPlan.proposed_pit - netPlan.current_pit)} đồng; BHXH giữ nguyên.`}</span>
                </div>
                <div className="cashflow-table" aria-label="So sánh dòng tiền với file đã submit">
                  <div className="cashflow-head"><span>Khoản</span><span>File submit</span><span>Đề xuất</span><span>Chênh lệch</span></div>
                  {netPlan.cashflows.map((row) => {
                    const employeeIncome = row.key === "net" || row.key === "meal" || row.key === "overtime";
                    const companyOutflow = row.key === "employer_cost";
                    const better = employeeIncome ? row.delta > 0 : companyOutflow ? row.delta < 0 : row.delta < 0;
                    const tone = row.delta === 0 ? "same" : better ? "better" : "worse";
                    return <div className={`cashflow-row ${tone}`} key={row.key}>
                      <strong>{row.label}</strong><span>{money(row.current)}</span><span>{money(row.proposed)}</span>
                      <b>{row.delta > 0 ? "+" : ""}{money(row.delta)}</b>
                    </div>;
                  })}
                </div>
                {netPlan.warnings.map((warning) => <div className="net-target-warning" key={warning}>{warning}</div>)}
                <div className="net-dependencies"><strong>Hồ sơ phụ thuộc</strong>{netPlan.dependencies.map((item) => <p key={item}>• {item}</p>)}</div>
                <button type="button" disabled={draftBusy} onClick={applyTargetNetPlan}>{netPlan.feasible ? "Áp dụng và lưu bản nháp" : "Lưu phần điều chỉnh hợp lệ"}</button>
              </div>}
            </section>
          </div>;
        })()}
        <div className="payroll-draft-actions">
          <button disabled={draftBusy || !Object.keys(draftChanges).length} onClick={saveWorkbookDraft}>{draftBusy ? "Đang xử lý…" : "Lưu bản nháp"}</button>
          <button className="secondary" disabled={draftBusy || !draft || draft.status !== "draft"} onClick={reviewWorkbookDraft}>Chạy lại review</button>
          <button className="drive-upload" disabled={draftBusy || !draft || draft.status !== "reviewed" || draft.findings.some((finding) => finding.level === "do")} onClick={uploadWorkbookDraft}>Cập nhật file gốc trên Drive</button>
        </div>
        {draft?.findings.map((finding, index) => <div key={index} className={`finding ${finding.level}`}>{finding.message}</div>)}
      </section>
      <div className="payroll-mobile-excel" aria-label={`Tóm tắt bảng lương ${importDetail.month}`}>
        {importDetail.snapshot.grid.slice(14).filter((row) => row[1] || row[2]).map((row, index) => <article key={index}>
          <header><div><strong>{row[1] || `Dòng ${index + 15}`}</strong><span>{row[2] || "Chưa có tên"}</span></div><b>{excelMoney(row[35])}<small>Thực lĩnh</small></b></header>
          <div className="mobile-salary-grid">
            <span><small>Lương cơ bản</small><strong>{excelMoney(row[3])}</strong></span>
            <span><small>Ngày công</small><strong>{row[5] || "—"}</strong></span>
            <span><small>Gross</small><strong>{excelMoney(row[16])}</strong></span>
            <span><small>Nền BHXH</small><strong>{excelMoney(row[17])}</strong></span>
            <span><small>TNCN</small><strong>{excelMoney(row[32])}</strong></span>
            <span><small>Chi phí DN</small><strong>{excelMoney(row[36])}</strong></span>
          </div>
        </article>)}
        <button className="secondary raw-excel-toggle" onClick={() => setShowRawMobile((value) => !value)}>{showRawMobile ? "Ẩn bảng gốc" : "Xem bảng Excel gốc"}</button>
      </div>
      <div className={`excel-grid${showRawMobile ? " mobile-open" : ""}`} tabIndex={0} aria-label={`Nội dung bảng lương ${importDetail.month}`}>
        <table><tbody>{importDetail.snapshot.grid.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, colIndex) => {
          const coordinate = cellName(rowIndex, colIndex);
          return <td id={`payroll-cell-${importDetail.id}-${coordinate}`} key={colIndex} className={`${rowIndex >= 14 && colIndex >= 1 ? "payroll-data " : ""}${focusedCell === coordinate ? "cell-focus" : ""}`} title={coordinate}>{cell}</td>;
        })}</tr>)}</tbody></table>
      </div>
    </section>}
    <div className="payroll-layout">
      <aside className="payroll-periods"><h3>Các kỳ lương</h3>{periods.map((row) =>
        <button key={row.id} className={selected?.id === row.id ? "active" : ""} onClick={() => setSelected(row)}>
          <strong>{row.month}</strong><span>v{row.version} · {row.status}</span>
        </button>)}</aside>
      <section className="payroll-sheet">
        {!selected ? <div className="empty">Chưa có kỳ lương. Tạo tháng đầu tiên để bắt đầu.</div> : <>
          <header><div><h2>Tháng {selected.month}</h2><span className={`status ${selected.status}`}>{selected.status}</span></div>
            <div className="payroll-actions">
              <button disabled={selected.status === "locked"} onClick={() => act(() => api.payrollReview(selected.id))}>Review</button>
              <button disabled={selected.status !== "reviewed"} onClick={() => act(() => api.payrollLock(selected.id))}>Khóa sổ</button>
              <a className="button secondary" href={api.payrollExportUrl(selected.id)}>Xuất Excel</a>
            </div></header>
          {selected.findings.map((finding, i) => <div className={`finding ${finding.level}`} key={i}>{finding.message}</div>)}
          <div className="table-scroll" tabIndex={0} aria-label="Bảng chi tiết lương, có thể cuộn ngang"><table><thead><tr><th>Nhân viên</th><th>Ngày chuẩn</th><th>Ngày công</th><th>Gross</th><th>BH NV</th><th>TNCN</th><th>Thực lĩnh</th><th>Chi phí DN</th></tr></thead>
            <tbody>{selected.lines.map((line) => <tr key={line.id}><td data-label="Nhân viên"><strong>{line.employee.code}</strong><small>{line.employee.name}</small></td>
              <td data-label="Ngày chuẩn">{line.standard_days}</td><td data-label="Ngày công"><input aria-label={`Ngày công ${line.employee.code}`} type="number" disabled={selected.status === "locked"} defaultValue={line.actual_days}
                onBlur={(e) => act(() => api.payrollUpdateLine(selected.id, line.id, { actual_days: Number(e.target.value), standard_days: line.standard_days }))} /></td>
              <td data-label="Gross">{money(line.computed.gross_income)}</td><td data-label="BH NV">{money(line.computed.employee_insurance)}</td><td data-label="TNCN">{money(line.computed.pit)}</td>
              <td data-label="Thực lĩnh" className="net">{money(line.computed.net_income)}</td><td data-label="Chi phí DN">{money(line.computed.total_employer_cost)}</td></tr>)}</tbody></table></div>
          <p className="legal-note">Chính sách 2026: giảm trừ 15,5/6,2 triệu; BH người lao động 10,5%; BH doanh nghiệp 21,5%; KPCĐ 2%; tiền ăn tối đa 1,2 triệu từ 01/07/2026. Kết quả cần kế toán review trước khi khóa.</p>
        </>}
      </section>
    </div>
  </div>;
}
