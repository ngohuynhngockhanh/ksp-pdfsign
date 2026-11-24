import { useEffect, useMemo, useState } from "react";
import { api, CustomsDriveFolder, CustomsDriveSource, InvCustomsDecl } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  InlineAlert,
  KpiStrip,
  SectionCard,
  StatusBadge,
  TableSkeleton,
} from "./ui";
import { safeHttpUrl } from "../utils/url";

const statusLabel: Record<string, string> = {
  linked: "Đã liên kết",
  waiting_declaration: "Chờ tờ khai",
  ambiguous: "Chờ gán thủ công",
  complete: "Đủ hồ sơ",
  needs_review: "Cần review",
  missing_documents: "Thiếu chứng từ",
};

const kindLabel: Record<string, string> = {
  customs_declaration: "Tờ khai",
  ci: "CI",
  pl: "PL",
  coo: "C/O",
  bill_of_lading: "Vận đơn",
  tax_receipt: "Giấy nộp thuế",
  payment: "Thanh toán",
  contract_po: "Hợp đồng/PO",
  datasheet: "Datasheet",
  arrival_notice: "AN · Arrival Notice",
  product_photo: "Hình chụp sản phẩm",
  other: "Khác",
};

const kindPurpose: Record<string, string> = {
  customs_declaration: "Nguồn chính để đối chiếu số tờ khai, luồng, trị giá và nghĩa vụ thuế.",
  ci: "Đối chiếu trị giá, người bán, điều kiện giao hàng và thanh toán.",
  pl: "Kiểm tra quy cách đóng gói, số kiện, số lượng và trọng lượng hàng.",
  coo: "Xác minh xuất xứ và căn cứ xem xét ưu đãi thuế nhập khẩu.",
  bill_of_lading: "Đối chiếu hành trình vận chuyển, người gửi, người nhận và số vận đơn.",
  tax_receipt: "Xác nhận các khoản thuế và lệ phí hải quan đã nộp.",
  payment: "Đối chiếu khoản thanh toán quốc tế, ngoại tệ và phí ngân hàng.",
  contract_po: "Đối chiếu điều khoản mua bán, đơn giá, số lượng và cam kết hai bên.",
  datasheet: "Đối chiếu thông số kỹ thuật, model, điện áp, vật liệu và tiêu chuẩn của hàng nhập.",
  arrival_notice: "Đối chiếu ngày tàu đến, cảng dỡ hàng, số vận đơn và thời hạn nhận hàng.",
  product_photo: "Đối chiếu hình dáng, nhãn, model và tình trạng thực tế; OCR nhãn để tìm thông tin xuất xứ.",
  other: "Chưa xác định vai trò; cần xét lại loại chứng từ.",
};

const checklistLabel: Record<string, string> = {
  declaration: "Tờ khai",
  ci: "CI",
  pl: "PL",
  origin: "Xuất xứ",
  bill_of_lading: "Vận đơn",
  tax_receipt: "Giấy nộp thuế",
  contract_po: "Hợp đồng/PO",
  payment: "Thanh toán",
};

const documentKinds = Object.keys(kindLabel);

function formatSize(bytes: number): string {
  if (bytes < 0) return "Google native";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const supplierNote = `CONSIGNEE
Company: INUT TECHNOLOGY DEVELOPMENT AND INVESTMENT JOINT STOCK COMPANY
Tax code: 4401053694
Address: 161 Truong Chinh Street, Tuy Hoa Ward, Dak Lak Province, Vietnam 56122
Contact: Ngo Huynh Ngoc Khanh
Phone number: +84 97 276 8491

LABEL REQUIREMENT - PLEASE ATTACH THIS LABEL TO THE PRODUCT / PACKAGE
<Your company> / <Product Model>
COO: China
Quantity: 1`;

export function CustomsDriveDossiers() {
  const [year, setYear] = useState(2026);
  const [source, setSource] = useState<CustomsDriveSource | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [folders, setFolders] = useState<CustomsDriveFolder[]>([]);
  const [declarations, setDeclarations] = useState<InvCustomsDecl[]>([]);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingDocumentId, setSavingDocumentId] = useState<number | null>(null);
  const [savedDocumentId, setSavedDocumentId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [sources, rows, decls] = await Promise.all([
        api.customsDriveSources(),
        api.customsDriveFolders(year),
        api.invCustomsList(),
      ]);
      const safeSources = Array.isArray(sources) ? sources : [];
      const safeRows = Array.isArray(rows) ? rows : [];
      const safeDecls = Array.isArray(decls) ? decls : [];
      const current = safeSources.find((item) => item.year === year) ?? null;
      setSource(current);
      setSourceId(current?.folder_id ?? "");
      setFolders(safeRows);
      setDeclarations(safeDecls);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage((error as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function sync() {
    try {
      setBusy(true);
      setMessage("");
      const result = await api.customsDriveSync(year);
      setMessage(
        `Đã đồng bộ ${result.stats.folders ?? 0} folder; liên kết ${result.stats.linked ?? 0}; chờ xử lý ${result.stats.waiting ?? 0}.`,
      );
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSource() {
    try {
      setBusy(true);
      await api.customsDriveSaveSource({ year, folder_id: sourceId.trim() });
      setMessage("Đã lưu nguồn Drive theo năm.");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(folderId: number, value: string) {
    if (!value) return;
    try {
      setBusy(true);
      await api.customsDriveAssign(folderId, Number(value));
      setMessage("Đã gán folder vào tờ khai.");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(folderId: number) {
    try {
      setBusy(true);
      await api.customsDriveReview(folderId);
      await load();
      setMessage("Đã đọc lại file và OCR nhãn sản phẩm để cập nhật checklist.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setDocumentKind(documentId: number, kind: string) {
    const previousFolders = folders;
    setSavingDocumentId(documentId);
    setSavedDocumentId(null);
    setMessage("");
    setFolders((current) =>
      current.map((row) => ({
        ...row,
        documents: row.documents.map((doc) =>
          doc.id === documentId ? { ...doc, kind, kind_manual: true } : doc,
        ),
      })),
    );
    try {
      const updated = await api.customsDriveSetDocumentKind(documentId, kind);
      setFolders((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setSavedDocumentId(documentId);
      setMessage("Đã lưu tự động loại chứng từ và tính lại checklist hồ sơ.");
    } catch (error) {
      setFolders(previousFolders);
      setMessage(`Không thể tự lưu; đã trả về loại cũ. ${(error as Error).message}`);
    } finally {
      setSavingDocumentId(null);
    }
  }

  async function copySupplierNote() {
    try {
      await navigator.clipboard.writeText(supplierNote);
      setMessage("Đã sao chép ghi chú gửi nhà cung cấp.");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = supplierNote;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setMessage(
        copied
          ? "Đã sao chép ghi chú gửi nhà cung cấp."
          : "Không thể sao chép tự động. Hãy chọn nội dung ghi chú và sao chép thủ công.",
      );
    }
  }

  const counts = useMemo(
    () =>
      folders.reduce<Record<string, number>>((all, row) => {
        all[row.link_status] = (all[row.link_status] ?? 0) + 1;
        all[row.dossier_status] = (all[row.dossier_status] ?? 0) + 1;
        return all;
      }, {}),
    [folders],
  );

  const declMap = useMemo(() => new Map(declarations.map((item) => [item.id, item])), [declarations]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return folders.filter((row) => {
      const matchesFilter = filter === "all" || row.link_status === filter || row.dossier_status === filter;
      if (!matchesFilter) return false;
      if (!q) return true;

      if (row.name?.toLowerCase().includes(q)) return true;
      if (row.path?.toLowerCase().includes(q)) return true;
      if (row.match_reason?.toLowerCase().includes(q)) return true;
      if (row.documents?.some((doc) => doc.name?.toLowerCase().includes(q))) return true;

      if (row.customs_id) {
        const decl = declMap.get(row.customs_id);
        if (decl) {
          if (decl.so_to_khai?.toLowerCase().includes(q)) return true;
          if (decl.so_van_don?.toLowerCase().includes(q)) return true;
        }
      }

      return false;
    });
  }, [folders, filter, searchQuery, declMap]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedIds(new Set(visible.map((r) => r.id)));
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  const rootDriveHref = source
    ? safeHttpUrl(`https://drive.google.com/drive/folders/${encodeURIComponent(source.folder_id)}`)
    : undefined;

  return (
    <SectionCard
      className="customs-drive-dossiers"
      eyebrow="HỒ SƠ NHẬP KHẨU · DRIVE"
      title="Bộ hồ sơ theo tờ khai"
      icon="folder-open"
      subtitle="Đồng bộ chỉ đọc, tự ghép theo số tờ khai và đưa hồ sơ thiếu vào hàng chờ."
      actions={
        <div className="ui-row">
          <select
            aria-label="Năm hồ sơ nhập khẩu"
            className="ui-select customs-drive-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            <option value={2026}>Năm 2026</option>
            <option value={2027}>Năm 2027</option>
            <option value={2028}>Năm 2028</option>
          </select>
          <AppButton
            variant="primary"
            size="sm"
            leftIcon="refresh"
            loading={busy}
            disabled={busy || !source}
            onClick={sync}
          >
            {busy ? "Đang đồng bộ…" : "Đồng bộ Drive"}
          </AppButton>
        </div>
      }
    >
      <div className="ui-stack">
        {message && (
          <InlineAlert tone="info" onDismiss={() => setMessage("")}>
            {message}
          </InlineAlert>
        )}

        <div className="customs-drive-source">
          <FormField
            label={`Folder Drive năm ${year}`}
            htmlFor={`drive-source-id-${year}`}
            className="ui-grow"
          >
            <input
              id={`drive-source-id-${year}`}
              className="ui-input"
              aria-label={`Folder Drive năm ${year}`}
              value={sourceId}
              placeholder="Dán folder ID Google Drive"
              onChange={(e) => setSourceId(e.target.value)}
            />
          </FormField>
          <AppButton
            variant="secondary"
            size="md"
            leftIcon="save"
            disabled={busy || !sourceId.trim()}
            onClick={saveSource}
          >
            Lưu nguồn
          </AppButton>
          {rootDriveHref && (
            <a className="ui-link ui-nowrap" href={rootDriveHref} target="_blank" rel="noopener noreferrer">
              <span>Mở folder Drive</span>
              <AppIcon name="external-link" size={13} />
            </a>
          )}
        </div>

        <details className="ui-collapsible ui-collapsible--subtle" open>
          <summary>Ghi chú gửi nhà cung cấp và mẫu nhãn hàng</summary>
          <div className="customs-supplier-note-body">
            <div>
              <strong>CONSIGNEE</strong>
              <b>INUT TECHNOLOGY DEVELOPMENT AND INVESTMENT JOINT STOCK COMPANY</b>
              <span>Tax code: 4401053694</span>
              <span>161 Truong Chinh Street, Tuy Hoa Ward, Dak Lak Province, Vietnam 56122</span>
              <span>Contact: Ngo Huynh Ngoc Khanh</span>
              <span>Phone number: +84 97 276 8491</span>
            </div>
            <div className="ui-subpanel ui-subpanel--gold ui-mono">
              <span>&lt;Your company&gt; / &lt;Product Model&gt;</span>
              <span>COO: China</span>
              <span>Quantity: 1</span>
            </div>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="copy"
              aria-label="Sao chép ghi chú nhà cung cấp"
              onClick={copySupplierNote}
            >
              Sao chép để gửi NCC
            </AppButton>
          </div>
        </details>

        <KpiStrip
          className="customs-drive-stats"
          columns={5}
          items={[
            {
              label: "Tổng folder",
              value: folders.length,
              icon: "folder",
              tone: "neutral",
              active: filter === "all",
              onClick: () => setFilter("all"),
            },
            {
              label: "Đã liên kết",
              value: counts.linked ?? 0,
              icon: "link",
              tone: "success",
              active: filter === "linked",
              onClick: () => setFilter("linked"),
            },
            {
              label: "Chờ tờ khai",
              value: counts.waiting_declaration ?? 0,
              icon: "clock",
              tone: "warning",
              active: filter === "waiting_declaration",
              onClick: () => setFilter("waiting_declaration"),
            },
            {
              label: "Chờ gán",
              value: counts.ambiguous ?? 0,
              icon: "alert-triangle",
              tone: "info",
              active: filter === "ambiguous",
              onClick: () => setFilter("ambiguous"),
            },
            {
              label: "Thiếu chứng từ",
              value: counts.missing_documents ?? 0,
              icon: "file-warning",
              tone: "danger",
              active: filter === "missing_documents",
              onClick: () => setFilter("missing_documents"),
            },
          ]}
        />

        <FilterBar
          collapsibleMobile={false}
          search={{
            value: searchQuery,
            onChange: setSearchQuery,
            placeholder: "Tìm nhanh tên bộ hồ sơ, tên file, số tờ khai, mã AWB...",
            ariaLabel: "Tìm nhanh bộ hồ sơ",
          }}
          actions={
            <>
              <StatusBadge tone="brand" size="sm">
                {searchQuery ? `Tìm thấy ${visible.length}/${folders.length} hồ sơ` : `${visible.length} hồ sơ`}
              </StatusBadge>
              <AppButton
                variant="secondary"
                size="sm"
                onClick={expandAll}
                title="Mở rộng tất cả thẻ hồ sơ"
              >
                Mở rộng tất cả
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                onClick={collapseAll}
                title="Thu gọn tất cả thẻ hồ sơ"
              >
                Thu gọn tất cả
              </AppButton>
            </>
          }
        />

        {loading && folders.length === 0 ? (
          <TableSkeleton rows={3} cols={4} />
        ) : !folders.length ? (
          <EmptyState
            compact
            icon="folder-open"
            title="Chưa có dữ liệu bộ hồ sơ Drive"
            description="Hãy kiểm tra folder ID rồi bấm Đồng bộ Drive."
          />
        ) : !visible.length ? (
          <EmptyState
            compact
            icon="search"
            title="Không tìm thấy bộ hồ sơ phù hợp"
            description={
              <>
                Không khớp với từ khóa <strong>&ldquo;{searchQuery}&rdquo;</strong>
                {filter !== "all" ? ` trong bộ lọc "${statusLabel[filter] ?? filter}"` : ""}.
              </>
            }
            action={
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="rotate-ccw"
                onClick={() => {
                  setSearchQuery("");
                  setFilter("all");
                }}
              >
                Xóa bộ lọc &amp; tìm kiếm
              </AppButton>
            }
          />
        ) : (
          <div className="ui-stack">
            {visible.map((row) => {
              const isExpanded = expandedIds.has(row.id);
              const present = Object.entries(row.checklist)
                .filter(([, value]) => value.state === "ok")
                .map(([key]) => checklistLabel[key] ?? key);
              const missing = Object.entries(row.checklist)
                .filter(([, value]) => value.state === "missing")
                .map(([key]) => checklistLabel[key] ?? key);
              const q = searchQuery.trim().toLowerCase();
              const matchedDocs = q
                ? row.documents.filter((doc) => doc.name.toLowerCase().includes(q))
                : [];
              const rowDriveHref = safeHttpUrl(row.drive_url);

              return (
                <article
                  key={row.id}
                  className={`ui-accordion-card ${row.link_status} ${isExpanded ? "is-expanded" : "is-collapsed"}`}
                  role="region"
                  aria-label={`Bộ hồ sơ ${row.name}`}
                >
                  <div
                    className="ui-accordion-head"
                    onClick={() => toggleExpand(row.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(row.id);
                      }
                    }}
                  >
                    <div className="ui-grow customs-drive-card-title">
                      <div className="ui-row ui-text-strong">
                        <span className={`ui-accordion-chevron ${isExpanded ? "expanded" : ""}`} aria-hidden="true">
                          <AppIcon name="chevron-right" size={16} />
                        </span>
                        <strong>{row.name}</strong>
                      </div>
                      <small>{row.path}</small>
                    </div>
                    <div className="ui-row">
                      <StatusBadge tone="neutral" size="sm">
                        {row.documents.length} chứng từ
                      </StatusBadge>
                      <StatusBadge tone={row.link_status === "linked" ? "success" : "warning"} size="sm">
                        {statusLabel[row.link_status] ?? row.link_status}
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          row.dossier_status === "complete"
                            ? "success"
                            : row.dossier_status === "missing_documents"
                              ? "danger"
                              : "warning"
                        }
                        size="sm"
                      >
                        {statusLabel[row.dossier_status] ?? row.dossier_status}
                      </StatusBadge>
                      <span className="ui-badge ui-badge--sm ui-badge--neutral ui-badge--soft" aria-hidden="true">
                        <span>{isExpanded ? "Thu gọn" : "Chi tiết"}</span>
                        <AppIcon name={isExpanded ? "chevron-up" : "chevron-down"} size={13} />
                      </span>
                    </div>
                  </div>

                  {q && matchedDocs.length > 0 && (
                    <div className="ui-subpanel ui-subpanel--warning ui-row ui-text-xs">
                      <AppIcon name="search" size={14} />
                      <span>
                        Khớp {matchedDocs.length} file: <strong>{matchedDocs.map((d) => d.name).join(", ")}</strong>
                      </span>
                    </div>
                  )}

                  <p className="ui-muted">{row.match_reason}</p>

                  <div className="customs-drive-coverage">
                    <span>
                      <b>Đã có</b>
                      {present.length ? present.join(" · ") : "Chưa xác nhận"}
                    </span>
                    <span className={missing.length ? "missing" : "complete"}>
                      <b>Còn thiếu</b>
                      {missing.length ? missing.join(" · ") : "Không có mục bắt buộc"}
                    </span>
                  </div>

                  <div className="ui-row">
                    {Object.entries(row.checklist).map(([key, value]) => (
                      <StatusBadge
                        key={key}
                        size="sm"
                        tone={value.state === "ok" ? "success" : value.state === "missing" ? "danger" : "neutral"}
                        icon={
                          value.state === "ok"
                            ? "check"
                            : value.state === "missing"
                              ? "alert-circle"
                              : "circle-dot"
                        }
                      >
                        {checklistLabel[key] ?? key}
                      </StatusBadge>
                    ))}
                  </div>

                  {isExpanded && (
                    <div className="ui-stack--sm">
                      <DataView
                        mobileMode="scroll"
                        desktop={
                          <div className="table-wrap" tabIndex={0}>
                            <table className="ui-table customs-drive-table">
                              <thead>
                                <tr>
                                  <th>Chứng từ</th>
                                  <th>Loại chứng từ</th>
                                  <th>Liên quan / dùng để làm gì</th>
                                  <th>Trạng thái đọc file</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.documents.map((doc) => {
                                  const docHref = safeHttpUrl(doc.file_url || row.drive_url);
                                  return (
                                    <tr key={doc.id} className={`customs-doc-row kind-${doc.kind}`}>
                                      <td>
                                        <strong>{doc.name}</strong>
                                        <small>
                                          {formatSize(doc.size)} · {doc.mime_type || "Không rõ định dạng"}
                                        </small>
                                      </td>
                                      <td>
                                        <div className={`customs-kind-control kind-${doc.kind}`}>
                                          <span className="customs-kind-swatch" aria-hidden="true" />
                                          <select
                                            aria-label={`Loại chứng từ của ${doc.name}`}
                                            value={doc.kind}
                                            disabled={busy || savingDocumentId !== null}
                                            onChange={(e) => setDocumentKind(doc.id, e.target.value)}
                                          >
                                            {documentKinds.map((kind) => (
                                              <option key={kind} value={kind}>
                                                {kindLabel[kind]}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                        <small>
                                          {savingDocumentId === doc.id
                                            ? "Đang tự lưu…"
                                            : savedDocumentId === doc.id
                                              ? "Đã lưu tự động"
                                              : doc.kind_manual
                                                ? "Đã xét thủ công"
                                                : "AI tự phân loại"}
                                        </small>
                                      </td>
                                      <td>{kindPurpose[doc.kind] ?? kindPurpose.other}</td>
                                      <td>
                                        {doc.parse_error ? (
                                          <StatusBadge tone="danger" size="sm" icon="alert-circle">
                                            {doc.parse_error}
                                          </StatusBadge>
                                        ) : (
                                          <StatusBadge tone="success" size="sm" icon="check">
                                            Đã đọc nội dung
                                          </StatusBadge>
                                        )}
                                      </td>
                                      <td>
                                        {docHref && (
                                          <a className="ui-link ui-nowrap" href={docHref} target="_blank" rel="noopener noreferrer">
                                            <span>Mở file</span>
                                            <AppIcon name="external-link" size={13} />
                                          </a>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        }
                      />

                      {row.findings.map((finding) => (
                        <InlineAlert
                          key={finding.code}
                          tone={finding.level === "do" ? "danger" : finding.level === "vang" ? "warning" : "info"}
                        >
                          {finding.message}
                        </InlineAlert>
                      ))}
                    </div>
                  )}

                  <footer>
                    {rowDriveHref && (
                      <a className="ui-link ui-nowrap" href={rowDriveHref} target="_blank" rel="noopener noreferrer">
                        <span>Mở folder Drive</span>
                        <AppIcon name="external-link" size={13} />
                      </a>
                    )}
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="refresh"
                      disabled={busy}
                      onClick={() => review(row.id)}
                    >
                      Kiểm tra lại
                    </AppButton>
                    {row.link_status !== "linked" && (
                      <select
                        className="ui-select customs-drive-assign-select"
                        aria-label={`Gán tờ khai cho ${row.name}`}
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => assign(row.id, e.target.value)}
                      >
                        <option value="">Gán vào tờ khai…</option>
                        {declarations.map((decl) => (
                          <option key={decl.id} value={decl.id}>
                            {decl.so_to_khai}
                          </option>
                        ))}
                      </select>
                    )}
                    <AppButton
                      variant="secondary"
                      size="sm"
                      rightIcon={isExpanded ? "chevron-up" : "chevron-down"}
                      className="ui-ml-auto"
                      onClick={() => toggleExpand(row.id)}
                    >
                      {isExpanded ? "Thu gọn bảng chứng từ" : `Xem bảng chứng từ (${row.documents.length})`}
                    </AppButton>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
