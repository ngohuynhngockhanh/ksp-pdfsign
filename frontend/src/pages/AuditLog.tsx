import { useEffect, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  InlineAlert,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  StatusBadge,
  TableSkeleton,
  type StatusBadgeTone,
} from "../components/ui";

type Row = Awaited<ReturnType<typeof api.auditLog>>["items"][number];

const ACTION_TONE: Record<string, StatusBadgeTone> = {
  login: "success",
  login_fail: "danger",
  login_locked: "danger",
  sign: "brand",
  bbbg_generate: "brand",
  quote_generate: "brand",
  ai_narrative: "brand",
  delete_doc: "danger",
  customer_delete: "danger",
  bulk_delete: "danger",
  password_change: "warning",
  password_reset: "warning",
};

const ACTION_OPTIONS: [string, string][] = [
  ["", "Tất cả thao tác"],
  ["login", "Đăng nhập"],
  ["login_fail", "Đăng nhập thất bại"],
  ["login_locked", "Bị chặn (khóa IP 30p)"],
  ["sign", "Ký số"],
  ["bbbg_generate", "Sinh BBBG"],
  ["quote_generate", "Sinh báo giá/đề nghị TT"],
  ["ai_narrative", "Sinh thuyết minh AI"],
  ["upload_signed", "Tải bản đã ký"],
  ["rename_doc", "Đổi tên hồ sơ"],
  ["delete_doc", "Xoá hồ sơ"],
  ["assign", "Gán khách hàng"],
  ["set_type", "Đổi loại"],
  ["share", "Chia sẻ"],
  ["bulk_delete", "Xoá hàng loạt"],
  ["bulk_assign", "Gán hàng loạt"],
  ["customer_create", "Tạo khách hàng"],
  ["customer_delete", "Xoá khách hàng"],
  ["account_set", "Cấp/đổi tài khoản KH"],
  ["password_change", "Đổi mật khẩu"],
  ["password_reset", "Reset mật khẩu"],
  ["nas_sync_all", "Đồng bộ NAS"],
];

const PER_PAGE_OPTIONS = [25, 50, 100, 200];

export function AuditLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const pages = Math.max(1, Math.ceil(total / perPage));

  async function load(p = page) {
    setErr("");
    setLoading(true);
    try {
      const tsFrom = dateFrom ? new Date(dateFrom + "T00:00:00").toISOString() : "";
      const tsTo = dateTo ? new Date(dateTo + "T23:59:59.999").toISOString() : "";
      const r = await api.auditLog({ search, action, tsFrom, tsTo, page: p, perPage });
      const items = Array.isArray(r?.items)
        ? r.items
        : Array.isArray(r)
          ? (r as unknown as Row[])
          : [];
      setRows(items);
      setTotal(typeof r?.total === "number" ? r.total : items.length);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const t = setTimeout(
      () => {
        setPage(1);
        load(1);
      },
      search ? 350 : 0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, action, dateFrom, dateTo, perPage]);

  const activeFilters =
    (action ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (search.trim() ? 1 : 0);

  function resetFilters() {
    setSearch("");
    setAction("");
    setDateFrom("");
    setDateTo("");
  }

  const emptyNode =
    !loading && rows.length === 0 ? (
      <EmptyState
        icon="clipboard-list"
        title="Không có nhật ký khớp bộ lọc."
        description="Thử mở rộng khoảng thời gian, đổi loại thao tác hoặc xóa từ khóa tìm kiếm."
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
    ) : undefined;

  return (
    <PageShell data-page="audit-log">
      <PageHeader
        variant="compact"
        icon="shield-check"
        eyebrow="INUT · AUDIT TRAIL"
        title="Nhật ký thao tác"
        subtitle="Theo dõi lịch sử đăng nhập, ký số, phân loại hồ sơ và thay đổi quản trị."
        badges={
          <StatusBadge tone="brand" size="sm">
            {total} dòng
          </StatusBadge>
        }
        actions={
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="refresh"
            loading={loading}
            onClick={() => load(page)}
          >
            Làm mới
          </AppButton>
        }
      />

      <FilterBar
        collapsibleMobile
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm user / đối tượng…",
          ariaLabel: "Tìm người dùng hoặc đối tượng",
        }}
        filters={
          <>
            <select
              className="ui-select"
              aria-label="Lọc theo loại thao tác"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              {ACTION_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <div className="audit-date-range">
              <input
                className="ui-input"
                type="date"
                aria-label="Từ ngày"
                title="Từ ngày"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="audit-date-sep" aria-hidden="true">
                <AppIcon name="arrow-right" size={14} />
              </span>
              <input
                className="ui-input"
                type="date"
                aria-label="Đến ngày"
                title="Đến ngày"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <select
              className="ui-select audit-per-page"
              aria-label="Số dòng mỗi trang"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}/trang
                </option>
              ))}
            </select>
          </>
        }
        activeCount={activeFilters}
        onReset={resetFilters}
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {loading && rows.length === 0 ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataView
          mobileMode="card"
          empty={emptyNode}
          desktop={
            <div className="ui-table-scroll-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th className="nowrap">Thời gian</th>
                    <th>Người dùng</th>
                    <th>Thao tác</th>
                    <th>Đối tượng</th>
                    <th className="col-hide-sm">Chi tiết</th>
                    <th className="col-hide-sm">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="muted nowrap">
                        {new Date(r.ts).toLocaleString("vi-VN")}
                      </td>
                      <td>
                        <span className="ui-inline ui-inline--md ui-inline--wrap">
                          <strong>{r.username}</strong>
                          {r.role === "admin" && (
                            <StatusBadge tone="neutral" size="sm">
                              admin
                            </StatusBadge>
                          )}
                        </span>
                      </td>
                      <td>
                        <StatusBadge
                          tone={ACTION_TONE[r.action] ?? "neutral"}
                          size="sm"
                        >
                          {r.action_label}
                        </StatusBadge>
                      </td>
                      <td className="doc-fname-cell">
                        <span className="ui-truncate">{r.target}</span>
                      </td>
                      <td className="muted col-hide-sm">{r.detail}</td>
                      <td className="muted col-hide-sm nowrap">
                        <span className="ui-mono">{r.ip}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {rows.map((r) => (
                <MobileCard key={r.id}>
                  <MobileCardHeader
                    title={
                      <span className="ui-inline ui-inline--md ui-inline--wrap">
                        <span>{r.username}</span>
                        {r.role === "admin" && (
                          <StatusBadge tone="neutral" size="sm">
                            admin
                          </StatusBadge>
                        )}
                      </span>
                    }
                    subtitle={new Date(r.ts).toLocaleString("vi-VN")}
                    badge={
                      <StatusBadge
                        tone={ACTION_TONE[r.action] ?? "neutral"}
                        size="sm"
                      >
                        {r.action_label}
                      </StatusBadge>
                    }
                  />
                  <MobileCardGrid cols={1}>
                    {r.target && (
                      <MobileCardRow label="Đối tượng" value={r.target} fullWidth />
                    )}
                    {r.detail && (
                      <MobileCardRow label="Chi tiết" value={r.detail} fullWidth />
                    )}
                    {r.ip && (
                      <MobileCardRow label="Địa chỉ IP" value={r.ip} mono />
                    )}
                  </MobileCardGrid>
                </MobileCard>
              ))}
            </div>
          }
        />
      )}

      {pages > 1 && (
        <nav className="ui-pager" aria-label="Phân trang nhật ký">
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevrons-left"
            disabled={page <= 1}
            onClick={() => setPage(1)}
          >
            Đầu
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevron-left"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Trước
          </AppButton>
          <span className="muted num">
            Trang {page}/{pages} · {total} dòng
          </span>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevron-right"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevrons-right"
            disabled={page >= pages}
            onClick={() => setPage(pages)}
          >
            Cuối
          </AppButton>
        </nav>
      )}
    </PageShell>
  );
}
