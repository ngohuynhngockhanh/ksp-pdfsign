import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  StatusBadge,
  TableSkeleton,
  useToast,
  type KpiItem,
} from "../components/ui";

type TrackedDoc = Awaited<ReturnType<typeof api.listTrackedDocs>>[number];
type ViewItem = Awaited<ReturnType<typeof api.getDocViews>>["views"][number];

const ACTION_LABEL: Record<string, string> = {
  view: "Xem",
  download: "Tải xuống",
  neac: "Thẩm định NEAC",
};

export function DocTracking() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<TrackedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [detail, setDetail] = useState<{
    docPk: number;
    filename: string;
    views: ViewItem[];
    total: number;
    page: number;
  } | null>(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      setRows(await api.listTrackedDocs());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(docPk: number, filename: string, page = 1) {
    try {
      const r = await api.getDocViews(docPk, page);
      setDetail({ docPk, filename, views: r.views, total: r.total, page });
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "enabled" && !r.enabled) return false;
      if (statusFilter === "disabled" && r.enabled) return false;
      if (!q) return true;
      const hay = `${r.filename} ${r.customer_name || ""} ${r.note || ""} ${r.milestone_date || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter]);

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);
  const totalPages = detail ? Math.max(1, Math.ceil(detail.total / 50)) : 1;

  const kpiItems: KpiItem[] = [
    {
      label: "Hồ sơ theo dõi",
      value: rows.length,
      sub: "đang/đã gắn cờ",
      tone: "brand",
      icon: "file-text",
    },
    {
      label: "Đang bật",
      value: rows.filter((r) => r.enabled).length,
      sub: "cờ theo dõi hoạt động",
      tone: "success",
      icon: "activity",
    },
    {
      label: "Lượt xem",
      value: rows.reduce((s, r) => s + r.total_views, 0),
      sub: "tổng cộng",
      tone: "info",
      icon: "eye",
    },
    {
      label: "Lượt tải",
      value: rows.reduce((s, r) => s + r.downloads, 0),
      sub: "tổng cộng",
      tone: "neutral",
      icon: "download",
    },
  ];

  const emptyNode =
    !loading && filteredRows.length === 0 ? (
      <EmptyState
        icon="eye"
        title={
          rows.length === 0
            ? "Chưa có hồ sơ nào được gắn cờ theo dõi"
            : "Không có hồ sơ khớp bộ lọc"
        }
        description={
          rows.length === 0
            ? "Mở Kho hồ sơ để bật theo dõi lượt xem, tải xuống và cảnh báo Telegram."
            : "Thử xóa bộ lọc hoặc đổi từ khóa tìm kiếm."
        }
        action={
          activeFilterCount > 0 ? (
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="rotate-ccw"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Xóa bộ lọc
            </AppButton>
          ) : undefined
        }
      />
    ) : undefined;

  return (
    <PageShell data-page="doc-tracking">
      <PageHeader
        variant="compact"
        icon="eye"
        eyebrow="INUT · DOCUMENT TRACKING"
        title="Theo dõi lượt xem hồ sơ."
        subtitle="Danh sách hồ sơ đã gắn cờ theo dõi — thống kê lượt xem, tải xuống, thẩm định NEAC và cảnh báo Telegram."
        actions={
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="refresh"
            loading={loading}
            onClick={load}
          >
            Làm mới
          </AppButton>
        }
      />

      <KpiStrip items={kpiItems} loading={loading && rows.length === 0} columns={4} />

      <FilterBar
        collapsibleMobile
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm tên file, khách hàng, ghi chú…",
          ariaLabel: "Tìm hồ sơ đang theo dõi",
        }}
        filters={
          <select
            className="ui-select"
            aria-label="Lọc theo trạng thái theo dõi"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | "enabled" | "disabled")
            }
          >
            <option value="all">Mọi trạng thái</option>
            <option value="enabled">Đang bật</option>
            <option value="disabled">Đã tắt</option>
          </select>
        }
        activeCount={activeFilterCount}
        onReset={() => {
          setSearch("");
          setStatusFilter("all");
        }}
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {loading && rows.length === 0 ? (
        <TableSkeleton rows={5} cols={8} />
      ) : (
        <DataView
          mobileMode="card"
          empty={emptyNode}
          desktop={
            <div className="ui-table-scroll-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>Tên file</th>
                    <th className="col-hide-sm">Khách hàng</th>
                    <th className="col-hide-sm">Ghi chú / Ngày mốc</th>
                    <th className="col-num">Xem</th>
                    <th className="col-num">Tải</th>
                    <th className="col-num">NEAC</th>
                    <th className="col-hide-sm">Lần xem cuối</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.document_id}>
                      <td>
                        <StatusBadge
                          tone={r.enabled ? "success" : "neutral"}
                          size="sm"
                          dot
                        >
                          {r.enabled ? "Đang bật" : "Đã tắt"}
                        </StatusBadge>
                      </td>
                      <td className="doc-fname-cell">
                        <AppButton
                          variant="ghost"
                          size="sm"
                          className="doc-fname-trigger"
                          onClick={() => openDetail(r.document_id, r.filename)}
                        >
                          {r.filename}
                        </AppButton>
                      </td>
                      <td className="muted col-hide-sm">{r.customer_name || "—"}</td>
                      <td className="muted col-hide-sm">
                        {[r.milestone_date, r.note].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="num">
                        <strong>{r.total_views}</strong>
                      </td>
                      <td className="num">{r.downloads}</td>
                      <td className="num">{r.neac_checks}</td>
                      <td className="muted col-hide-sm nowrap">
                        {r.last_view_at
                          ? new Date(r.last_view_at).toLocaleString("vi-VN")
                          : "—"}
                      </td>
                      <td className="col-act">
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="eye"
                          onClick={() => openDetail(r.document_id, r.filename)}
                        >
                          Chi tiết
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
              {filteredRows.map((r) => (
                <MobileCard key={r.document_id}>
                  <MobileCardHeader
                    title={
                      <AppButton
                        variant="ghost"
                        size="sm"
                        className="doc-fname-trigger doc-fname-trigger--card"
                        onClick={() => openDetail(r.document_id, r.filename)}
                      >
                        {r.filename}
                      </AppButton>
                    }
                    badge={
                      <StatusBadge
                        tone={r.enabled ? "success" : "neutral"}
                        size="sm"
                        dot
                      >
                        {r.enabled ? "Đang bật" : "Đã tắt"}
                      </StatusBadge>
                    }
                  />
                  <MobileCardGrid cols={2}>
                    <MobileCardRow
                      label="Khách hàng"
                      value={r.customer_name || "—"}
                    />
                    <MobileCardRow
                      label="Xem / Tải / NEAC"
                      value={`${r.total_views} / ${r.downloads} / ${r.neac_checks}`}
                      mono
                    />
                    <MobileCardRow
                      label="Lần xem cuối"
                      value={
                        r.last_view_at
                          ? new Date(r.last_view_at).toLocaleString("vi-VN")
                          : "—"
                      }
                    />
                    {(r.milestone_date || r.note) && (
                      <MobileCardRow
                        label="Mốc / Ghi chú"
                        value={[r.milestone_date, r.note].filter(Boolean).join(" · ")}
                      />
                    )}
                  </MobileCardGrid>
                  <MobileCardActions>
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="eye"
                      onClick={() => openDetail(r.document_id, r.filename)}
                    >
                      Xem lịch sử chi tiết
                    </AppButton>
                  </MobileCardActions>
                </MobileCard>
              ))}
            </div>
          }
        />
      )}

      <AppModal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? `Lịch sử lượt xem — ${detail.filename}` : ""}
        subtitle={
          detail
            ? `Tổng: ${detail.total} lượt · Trang ${detail.page}/${totalPages}`
            : undefined
        }
        footer={
          detail && detail.total > 50 ? (
            <>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="chevron-left"
                disabled={detail.page <= 1}
                onClick={() =>
                  openDetail(detail.docPk, detail.filename, detail.page - 1)
                }
              >
                Trước
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                rightIcon="chevron-right"
                disabled={detail.page >= totalPages}
                onClick={() =>
                  openDetail(detail.docPk, detail.filename, detail.page + 1)
                }
              >
                Sau
              </AppButton>
              <AppButton variant="primary" onClick={() => setDetail(null)}>
                Đóng
              </AppButton>
            </>
          ) : (
            <AppButton variant="primary" onClick={() => setDetail(null)}>
              Đóng
            </AppButton>
          )
        }
      >
        {detail && (
          <DataView
            mobileMode="card"
            empty={
              detail.views.length === 0 ? (
                <EmptyState
                  compact
                  icon="clock"
                  title="Chưa ghi nhận lượt xem"
                  description="Lịch sử truy cập sẽ xuất hiện tại đây khi có người mở hoặc tải hồ sơ."
                />
              ) : undefined
            }
            desktop={
              <div className="ui-table-scroll-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Hành động</th>
                      <th>IP</th>
                      <th>Vị trí</th>
                      <th>Thiết bị</th>
                      <th>Nguồn</th>
                      <th>Telegram</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.views.map((v) => (
                      <tr key={v.id}>
                        <td>{ACTION_LABEL[v.action] || v.action}</td>
                        <td>
                          <code className="ui-mono">{v.ip || "—"}</code>
                        </td>
                        <td className="muted">
                          {[v.city, v.region, v.isp].filter(Boolean).join(" · ") ||
                            "—"}
                        </td>
                        <td>{v.device_type || "—"}</td>
                        <td className="muted">{v.source || "—"}</td>
                        <td>
                          <StatusBadge
                            tone={v.notified ? "success" : "neutral"}
                            size="sm"
                            icon={v.notified ? "check" : undefined}
                          >
                            {v.notified ? "Đã báo" : "Chưa báo"}
                          </StatusBadge>
                        </td>
                        <td className="nowrap">
                          {v.created_at
                            ? new Date(v.created_at).toLocaleString("vi-VN")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {detail.views.map((v) => (
                  <MobileCard key={v.id}>
                    <MobileCardHeader
                      title={ACTION_LABEL[v.action] || v.action}
                      badge={
                        <StatusBadge
                          tone={v.notified ? "success" : "neutral"}
                          size="sm"
                          icon={v.notified ? "check" : undefined}
                        >
                          {v.notified ? "Đã báo TG" : "Chưa báo"}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={2}>
                      <MobileCardRow
                        label="Thời gian"
                        value={
                          v.created_at
                            ? new Date(v.created_at).toLocaleString("vi-VN")
                            : "—"
                        }
                      />
                      <MobileCardRow
                        label="IP / Thiết bị"
                        value={`${v.ip || "—"} (${v.device_type || "—"})`}
                        mono
                      />
                      <MobileCardRow
                        label="Vị trí / ISP"
                        value={
                          [v.city, v.region, v.isp].filter(Boolean).join(" · ") ||
                          "—"
                        }
                      />
                      <MobileCardRow label="Nguồn" value={v.source || "—"} />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
              </div>
            }
          />
        )}
      </AppModal>
    </PageShell>
  );
}
