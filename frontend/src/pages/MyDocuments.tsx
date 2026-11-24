import { useEffect, useMemo, useState } from "react";
import { api, DOC_TYPES, type CustomerInvoice, type DocRecord } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  StatusBadge,
  TableSkeleton,
  useToast,
  type StatusBadgeTone,
} from "../components/ui";
import { copyText } from "../util";

const DOC_TYPE_TONE: Record<string, StatusBadgeTone> = {
  hop_dong: "brand",
  bbbg: "info",
  bao_gia: "info",
  bbnt: "danger",
  de_nghi_tt: "success",
  hoa_don: "warning",
  khac: "neutral",
};

export function MyDocuments({ onVerify }: { onVerify: (docPk: number) => void }) {
  const toast = useToast();
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [tab, setTab] = useState<"invoices" | "documents">("invoices");
  const [filters, setFilters] = useState({ from: "", to: "", q: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(nextFilters = filters) {
    setErr("");
    setLoading(true);
    try {
      const [invoiceRows, documentRows] = await Promise.all([
        api.myInvoices(nextFilters),
        api.myDocuments(),
      ]);
      setInvoices(invoiceRows);
      setDocs(documentRows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownDocs = useMemo(
    () =>
      docs.filter((d) => {
        const day = d.created_at.slice(0, 10);
        const text = `${d.filename} ${d.signer_name}`.toLowerCase();
        return (
          (!filters.from || day >= filters.from) &&
          (!filters.to || day <= filters.to) &&
          (!filters.q || text.includes(filters.q.toLowerCase()))
        );
      }),
    [docs, filters],
  );

  const activeFilters =
    (filters.from ? 1 : 0) + (filters.to ? 1 : 0) + (filters.q.trim() ? 1 : 0);

  function resetFilters() {
    const empty = { from: "", to: "", q: "" };
    setFilters(empty);
    load(empty);
  }

  async function share(id: number, filename: string) {
    try {
      const s = await api.createShare(id, 7, false);
      const exp = new Date(s.expires_at).toLocaleString("vi-VN");
      const text = `${filename}\n${s.url}\n(hết hạn ${exp})`;
      await copyText(text);
      toast.success(`Đã tạo link chia sẻ và sao chép cho "${filename}" (hết hạn ${exp}).`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <PageShell data-page="my-documents">
      <PageHeader
        variant="compact"
        icon="file-check"
        eyebrow="TRUNG TÂM CHỨNG TỪ"
        title="Hóa đơn & hồ sơ của tôi"
        subtitle="Tải hóa đơn điện tử, hợp đồng và biên bản đã được INUT chia sẻ."
        actions={
          <a
            className="ui-btn ui-btn--gold ui-btn--md"
            href={api.myPortalZipUrl(filters.from, filters.to)}
          >
            <AppIcon name="download" size={16} />
            <span>Tải ZIP theo bộ lọc</span>
          </a>
        }
      />

      <FilterBar
        collapsibleMobile
        search={{
          value: filters.q,
          onChange: (q) => setFilters((prev) => ({ ...prev, q })),
          placeholder: "Số hóa đơn, ký hiệu, tên file…",
          ariaLabel: "Tìm hóa đơn hoặc hồ sơ",
        }}
        filters={
          <div className="audit-date-range">
            <input
              className="ui-input"
              type="date"
              aria-label="Từ ngày"
              title="Từ ngày"
              value={filters.from}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, from: e.target.value }))
              }
            />
            <span className="audit-date-sep" aria-hidden="true">
              <AppIcon name="arrow-right" size={14} />
            </span>
            <input
              className="ui-input"
              type="date"
              aria-label="Đến ngày"
              title="Đến ngày"
              value={filters.to}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, to: e.target.value }))
              }
            />
          </div>
        }
        actions={
          <AppButton
            variant="primary"
            size="sm"
            leftIcon="filter"
            loading={loading}
            onClick={() => load()}
          >
            Áp dụng
          </AppButton>
        }
        activeCount={activeFilters}
        onReset={resetFilters}
      />

      <ResponsiveTabs
        tabs={[
          { id: "invoices", label: "Hóa đơn", icon: "receipt", badge: invoices.length },
          { id: "documents", label: "Hồ sơ", icon: "file-text", badge: shownDocs.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id as "invoices" | "documents")}
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {tab === "invoices" ? (
        loading && invoices.length === 0 ? (
          <TableSkeleton rows={4} cols={4} />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="Chưa có hóa đơn nào khớp tài khoản của bạn."
            description="Thử mở rộng khoảng ngày hoặc xóa từ khóa tìm kiếm."
            action={
              activeFilters > 0 ? (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="rotate-ccw"
                  onClick={resetFilters}
                >
                  Xóa bộ lọc
                </AppButton>
              ) : undefined
            }
          />
        ) : (
          <div className="ui-stack">
            {invoices.map((inv) => (
              <article className="ui-ticket" key={inv.id}>
                <div className="ui-ticket-date">
                  <strong className="num">
                    {inv.invoice_date ? inv.invoice_date.slice(8, 10) : "--"}
                  </strong>
                  <span className="num">
                    {inv.invoice_date
                      ? `${inv.invoice_date.slice(5, 7)}/${inv.invoice_date.slice(0, 4)}`
                      : "Chưa rõ"}
                  </span>
                </div>
                <div className="ui-ticket-main">
                  <div className="ui-ticket-title">
                    <span className="eyebrow">Hóa đơn điện tử</span>
                    <strong className="num">
                      {inv.invoice_series || "--"} · {inv.invoice_number || "Chưa có số"}
                    </strong>
                  </div>
                  <p className="ui-ticket-sub">
                    {inv.buyer_name || "Khách hàng"}
                    {inv.buyer_tax_code && (
                      <small className="num">MST {inv.buyer_tax_code}</small>
                    )}
                  </p>
                  {inv.sync_error && (
                    <InlineAlert tone="warning" className="ui-mt-1">
                      File đang được đồng bộ lại: {inv.sync_error}
                    </InlineAlert>
                  )}
                </div>
                <div className="ui-ticket-total">
                  <span>Tổng thanh toán</span>
                  <strong className="num">
                    {inv.total_payment.toLocaleString("vi-VN")} đ
                  </strong>
                </div>
                <div className="ui-ticket-actions">
                  {inv.pdf_ready ? (
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={api.myInvoiceFileUrl(inv.id, "pdf")}
                    >
                      <AppIcon name="file-text" size={14} />
                      <span>PDF</span>
                    </a>
                  ) : (
                    <StatusBadge tone="neutral" size="sm">
                      PDF
                    </StatusBadge>
                  )}
                  {inv.xml_ready ? (
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={api.myInvoiceFileUrl(inv.id, "xml")}
                    >
                      <AppIcon name="download" size={14} />
                      <span>XML</span>
                    </a>
                  ) : (
                    <StatusBadge tone="neutral" size="sm">
                      XML
                    </StatusBadge>
                  )}
                </div>
              </article>
            ))}
          </div>
        )
      ) : loading && docs.length === 0 ? (
        <TableSkeleton rows={4} cols={5} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            !loading && shownDocs.length === 0 ? (
              <EmptyState
                icon="folder-open"
                title="Chưa có hồ sơ nào trong phạm vi đã lọc."
                description="Thử thay đổi khoảng ngày hoặc từ khóa để xem toàn bộ hồ sơ."
                action={
                  activeFilters > 0 ? (
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="rotate-ccw"
                      onClick={resetFilters}
                    >
                      Xóa bộ lọc
                    </AppButton>
                  ) : undefined
                }
              />
            ) : undefined
          }
          desktop={
            <div className="ui-table-scroll-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Tên file</th>
                    <th>Loại</th>
                    <th className="col-hide-sm">Người ký</th>
                    <th className="col-hide-sm">Thời gian</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {shownDocs.map((d) => {
                    const k = d.doc_type || "khac";
                    const canVerify =
                      !d.filename.toLowerCase().endsWith(".docx") &&
                      !d.filename.toLowerCase().endsWith(".md");
                    return (
                      <tr key={d.id}>
                        <td className="doc-fname-cell">
                          <div className="doc-fname-row">
                            <span className="ui-truncate">{d.filename}</span>
                            {d.signed_upload_name && (
                              <StatusBadge tone="brand" size="sm" icon="paperclip">
                                đã ký
                              </StatusBadge>
                            )}
                          </div>
                        </td>
                        <td>
                          <StatusBadge tone={DOC_TYPE_TONE[k] ?? "neutral"} size="sm">
                            {DOC_TYPES[k] || DOC_TYPES.khac}
                          </StatusBadge>
                        </td>
                        <td className="muted col-hide-sm">{d.signer_name || "—"}</td>
                        <td className="muted col-hide-sm nowrap">
                          {new Date(d.created_at).toLocaleString("vi-VN")}
                        </td>
                        <td className="col-act">
                          <div className="ui-inline ui-row--nowrap">
                            <a
                              className="ui-btn ui-btn--secondary ui-btn--sm"
                              href={d.view_url || api.documentViewUrl(d.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Xem trước trực tiếp"
                            >
                              <AppIcon name="eye" size={14} />
                              <span>Xem</span>
                            </a>
                            <a
                              className="ui-btn ui-btn--secondary ui-btn--sm"
                              href={d.download_url}
                              title="Tải xuống"
                            >
                              <AppIcon name="download" size={14} />
                              <span>Tải</span>
                            </a>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              leftIcon="link"
                              onClick={() => share(d.id, d.filename)}
                              title="Chia sẻ"
                            >
                              Link
                            </AppButton>
                            {canVerify && (
                              <AppButton
                                variant="ghost"
                                size="sm"
                                leftIcon="shield-check"
                                onClick={() => onVerify(d.id)}
                                title="Kiểm tra chữ ký"
                              >
                                Kiểm tra
                              </AppButton>
                            )}
                            {d.signed_upload_name && (
                              <a
                                className="ui-btn ui-btn--secondary ui-btn--sm"
                                href={api.signedFileUrl(d.id, true)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <AppIcon name="file-check" size={14} />
                                <span>Bản ký</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {shownDocs.map((d) => {
                const k = d.doc_type || "khac";
                const canVerify =
                  !d.filename.toLowerCase().endsWith(".docx") &&
                  !d.filename.toLowerCase().endsWith(".md");
                return (
                  <MobileCard key={d.id}>
                    <MobileCardHeader
                      title={d.filename}
                      badge={
                        <StatusBadge tone={DOC_TYPE_TONE[k] ?? "neutral"} size="sm">
                          {DOC_TYPES[k] || DOC_TYPES.khac}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={2}>
                      <MobileCardRow
                        label="Người ký"
                        value={d.signer_name || "INUT"}
                      />
                      <MobileCardRow
                        label="Thời gian"
                        value={new Date(d.created_at).toLocaleString("vi-VN")}
                      />
                      {d.signed_upload_name && (
                        <MobileCardRow
                          label="Trạng thái"
                          value={
                            <StatusBadge tone="brand" size="sm" icon="paperclip">
                              Đã có bản ký
                            </StatusBadge>
                          }
                          fullWidth
                        />
                      )}
                    </MobileCardGrid>
                    <MobileCardActions>
                      <a
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        href={d.view_url || api.documentViewUrl(d.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <AppIcon name="eye" size={14} />
                        <span>Xem</span>
                      </a>
                      <a
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        href={d.download_url}
                      >
                        <AppIcon name="download" size={14} />
                        <span>Tải</span>
                      </a>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="link"
                        onClick={() => share(d.id, d.filename)}
                      >
                        Link
                      </AppButton>
                      {canVerify && (
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="shield-check"
                          onClick={() => onVerify(d.id)}
                        >
                          Kiểm tra
                        </AppButton>
                      )}
                      {d.signed_upload_name && (
                        <a
                          className="ui-btn ui-btn--secondary ui-btn--sm"
                          href={api.signedFileUrl(d.id, true)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <AppIcon name="file-check" size={14} />
                          <span>Bản ký</span>
                        </a>
                      )}
                    </MobileCardActions>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}
    </PageShell>
  );
}
