import { useEffect, useState } from "react";
import { api } from "../api";
import { AppModal, DataView, useToast } from "../components/ui";

type TrackedDoc = Awaited<ReturnType<typeof api.listTrackedDocs>>[number];
type ViewItem = Awaited<ReturnType<typeof api.getDocViews>>["views"][number];

export function DocTracking() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<TrackedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<{
    docPk: number;
    filename: string;
    views: ViewItem[];
    total: number;
    page: number;
  } | null>(null);

  async function load() {
    setLoading(true);
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

  const actionLabel: Record<string, string> = {
    view: "Xem",
    download: "Tải xuống",
    neac: "Thẩm định NEAC",
  };

  const totalPages = detail ? Math.max(1, Math.ceil(detail.total / 50)) : 1;

  return (
    <div className="docs-page document-vault">
      <section className="document-vault-hero">
        <div>
          <span>INUT · DOCUMENT TRACKING</span>
          <h1>Theo dõi lượt xem hồ sơ.</h1>
          <p>
            Danh sách hồ sơ đã gắn cờ theo dõi — thống kê lượt xem, tải xuống, thẩm định NEAC và
            cảnh báo Telegram.
          </p>
        </div>
        <div className="document-vault-metrics" aria-label="Tóm tắt theo dõi">
          <article>
            <strong>{rows.length} hồ sơ</strong>
            <small>đang/đã theo dõi</small>
          </article>
          <article>
            <strong>{rows.filter((r) => r.enabled).length} đang bật</strong>
            <small>cờ theo dõi</small>
          </article>
          <article>
            <strong>{rows.reduce((s, r) => s + r.total_views, 0)} lượt xem</strong>
            <small>tổng cộng</small>
          </article>
          <article>
            <strong>{rows.reduce((s, r) => s + r.downloads, 0)} lượt tải</strong>
            <small>tổng cộng</small>
          </article>
        </div>
      </section>

      {err && <div className="error" role="alert">{err}</div>}

      <DataView
        mobileMode="card"
        desktop={
          <div className="table-wrap document-vault-table-wrap">
            <table className="dt document-vault-table">
              <thead>
                <tr>
                  <th>Trạng thái</th>
                  <th>Tên file</th>
                  <th className="col-hide-sm">Khách hàng</th>
                  <th className="col-hide-sm">Ghi chú / Ngày mốc</th>
                  <th>Xem</th>
                  <th>Tải</th>
                  <th>NEAC</th>
                  <th className="col-hide-sm">Lần xem cuối</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.document_id}>
                    <td>
                      <span className={"chip sm " + (r.enabled ? "green" : "gray")}>
                        {r.enabled ? "Đang bật" : "Đã tắt"}
                      </span>
                    </td>
                    <td className="fname">
                      <button
                        type="button"
                        className="doc-fname-trigger ft"
                        onClick={() => openDetail(r.document_id, r.filename)}
                      >
                        {r.filename}
                      </button>
                    </td>
                    <td className="muted col-hide-sm">{r.customer_name || "—"}</td>
                    <td className="muted col-hide-sm">
                      {[r.milestone_date, r.note].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="num">
                      <b>{r.total_views}</b>
                    </td>
                    <td className="num">{r.downloads}</td>
                    <td className="num">{r.neac_checks}</td>
                    <td className="muted col-hide-sm nowrap">
                      {r.last_view_at ? new Date(r.last_view_at).toLocaleString("vi-VN") : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => openDetail(r.document_id, r.filename)}
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty">
                        <div className="empty-ic">◉</div>
                        <div>
                          Chưa có hồ sơ nào được gắn cờ theo dõi. Mở Kho hồ sơ để bật theo dõi lượt
                          xem.
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        }
        mobileCards={
          rows.length === 0 && !loading ? (
            <div className="empty">
              Chưa có hồ sơ nào được gắn cờ theo dõi. Mở Kho hồ sơ để bật theo dõi lượt xem.
            </div>
          ) : (
            <div className="ui-mobile-card-list">
              {rows.map((r) => (
                <article key={r.document_id} className="ui-mobile-card">
                  <div className="ui-mobile-card-head">
                    <button
                      type="button"
                      className="doc-fname-trigger ui-mobile-card-title"
                      onClick={() => openDetail(r.document_id, r.filename)}
                    >
                      {r.filename}
                    </button>
                    <span className={"chip sm " + (r.enabled ? "green" : "gray")}>
                      {r.enabled ? "Đang bật" : "Đã tắt"}
                    </span>
                  </div>
                  <div className="ui-mobile-card-grid">
                    <div className="ui-mobile-card-kv">
                      <span>Khách hàng</span>
                      <strong>{r.customer_name || "—"}</strong>
                    </div>
                    <div className="ui-mobile-card-kv">
                      <span>Xem / Tải / NEAC</span>
                      <strong className="num">
                        {r.total_views} / {r.downloads} / {r.neac_checks}
                      </strong>
                    </div>
                    <div className="ui-mobile-card-kv">
                      <span>Lần xem cuối</span>
                      <strong>
                        {r.last_view_at ? new Date(r.last_view_at).toLocaleString("vi-VN") : "—"}
                      </strong>
                    </div>
                    {(r.milestone_date || r.note) && (
                      <div className="ui-mobile-card-kv">
                        <span>Mốc / Ghi chú</span>
                        <strong>{[r.milestone_date, r.note].filter(Boolean).join(" · ")}</strong>
                      </div>
                    )}
                  </div>
                  <div className="ui-mobile-card-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => openDetail(r.document_id, r.filename)}
                    >
                      Xem lịch sử chi tiết
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      />

      {/* Opaque Bottom-Sheet Detail Modal (UI-MOB-03) */}
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
              <button
                type="button"
                disabled={detail.page <= 1}
                onClick={() => openDetail(detail.docPk, detail.filename, detail.page - 1)}
              >
                ‹ Trước
              </button>
              <button
                type="button"
                disabled={detail.page >= totalPages}
                onClick={() => openDetail(detail.docPk, detail.filename, detail.page + 1)}
              >
                Sau ›
              </button>
              <button type="button" className="primary" onClick={() => setDetail(null)}>
                Đóng
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => setDetail(null)}>
              Đóng
            </button>
          )
        }
      >
        {detail && (
          <DataView
            mobileMode="card"
            desktop={
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Hành động</th>
                      <th>IP</th>
                      <th>Vị trí</th>
                      <th>Thiết bị</th>
                      <th>Nguồn</th>
                      <th>TG</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.views.map((v) => (
                      <tr key={v.id}>
                        <td>{actionLabel[v.action] || v.action}</td>
                        <td>
                          <code>{v.ip || "—"}</code>
                        </td>
                        <td className="muted">
                          {[v.city, v.region, v.isp].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td>{v.device_type || "—"}</td>
                        <td className="muted">{v.source || "—"}</td>
                        <td>
                          {v.notified ? (
                            <span className="chip green sm">Đã báo</span>
                          ) : (
                            <span className="chip gray sm">—</span>
                          )}
                        </td>
                        <td className="nowrap">
                          {v.created_at ? new Date(v.created_at).toLocaleString("vi-VN") : "—"}
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
                  <article key={v.id} className="ui-mobile-card">
                    <div className="ui-mobile-card-head">
                      <h4 className="ui-mobile-card-title">
                        {actionLabel[v.action] || v.action}
                      </h4>
                      <span className={`chip sm ${v.notified ? "green" : "gray"}`}>
                        {v.notified ? "TG ✓" : "Chưa báo"}
                      </span>
                    </div>
                    <div className="ui-mobile-card-grid">
                      <div className="ui-mobile-card-kv">
                        <span>Thời gian</span>
                        <strong>
                          {v.created_at ? new Date(v.created_at).toLocaleString("vi-VN") : "—"}
                        </strong>
                      </div>
                      <div className="ui-mobile-card-kv">
                        <span>IP / Thiết bị</span>
                        <strong>
                          {v.ip || "—"} ({v.device_type || "—"})
                        </strong>
                      </div>
                      <div className="ui-mobile-card-kv">
                        <span>Vị trí / ISP</span>
                        <strong>
                          {[v.city, v.region, v.isp].filter(Boolean).join(" · ") || "—"}
                        </strong>
                      </div>
                      <div className="ui-mobile-card-kv">
                        <span>Nguồn</span>
                        <strong>{v.source || "—"}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            }
          />
        )}
      </AppModal>
    </div>
  );
}
