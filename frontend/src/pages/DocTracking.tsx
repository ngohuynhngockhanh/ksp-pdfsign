import { useEffect, useState } from "react";
import { api } from "../api";

type TrackedDoc = Awaited<ReturnType<typeof api.listTrackedDocs>>[number];
type ViewItem = Awaited<ReturnType<typeof api.getDocViews>>["views"][number];

export function DocTracking() {
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
      alert((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const actionIcon: Record<string, string> = {
    view: "👁",
    download: "⬇️",
    neac: "🏛️",
  };

  return (
    <div className="docs-page document-vault">
      <section className="document-vault-hero">
        <div>
          <span>INUT · DOCUMENT TRACKING</span>
          <h1>Theo dõi lượt xem hồ sơ.</h1>
          <p>
            Danh sách hồ sơ đã gắn cờ theo dõi — thống kê lượt xem, tải
            xuống, thẩm định NEAC và cảnh báo Telegram.
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
            <strong>
              {rows.reduce((s, r) => s + r.total_views, 0)} lượt xem
            </strong>
            <small>tổng cộng</small>
          </article>
          <article>
            <strong>
              {rows.reduce((s, r) => s + r.downloads, 0)} lượt tải
            </strong>
            <small>tổng cộng</small>
          </article>
        </div>
      </section>

      {err && <div className="error">{err}</div>}

      <div className="table-wrap document-vault-table-wrap">
        <table className="dt document-vault-table">
          <thead>
            <tr>
              <th>Trạng thái</th>
              <th>Tên file</th>
              <th className="col-hide-sm">Khách hàng</th>
              <th className="col-hide-sm">Ghi chú / Ngày mốc</th>
              <th>👁 Xem</th>
              <th>⬇️ Tải</th>
              <th>🏛️ NEAC</th>
              <th className="col-hide-sm">Lần xem cuối</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.document_id}>
                <td>
                  <span
                    className={
                      "chip sm " + (r.enabled ? "green" : "gray")
                    }
                  >
                    {r.enabled ? "🟢 Bật" : "⚪ Tắt"}
                  </span>
                </td>
                <td className="fname">
                  <span className="ft">{r.filename}</span>
                </td>
                <td className="muted col-hide-sm">
                  {r.customer_name || "—"}
                </td>
                <td className="muted col-hide-sm">
                  {[r.milestone_date, r.note].filter(Boolean).join(" · ") ||
                    "—"}
                </td>
                <td>
                  <b>{r.total_views}</b>
                </td>
                <td>{r.downloads}</td>
                <td>{r.neac_checks}</td>
                <td className="muted col-hide-sm nowrap">
                  {r.last_view_at
                    ? new Date(r.last_view_at).toLocaleString("vi-VN")
                    : "—"}
                </td>
                <td>
                  <button
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
                    <div className="empty-ic">👁</div>
                    <div>
                      Chưa có hồ sơ nào được gắn cờ theo dõi. Bấm 👁 trên
                      trang Kho hồ sơ để bắt đầu.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {detail && (
        <div
          className="modal-backdrop"
          onClick={() => setDetail(null)}
        >
          <div
            className="modal-body"
            style={{ maxWidth: 800, maxHeight: "85vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>
                📊 Lịch sử lượt xem — {detail.filename}
              </h3>
              <button
                className="btn-sm ghost"
                onClick={() => setDetail(null)}
              >
                ✕ Đóng
              </button>
            </div>
            <p className="muted" style={{ fontSize: ".85rem" }}>
              Tổng: <b>{detail.total}</b> lượt · Trang {detail.page}/
              {Math.max(1, Math.ceil(detail.total / 50))}
            </p>
            <table className="dt" style={{ fontSize: ".85rem" }}>
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
                    <td>
                      {actionIcon[v.action] || "📄"} {v.action}
                    </td>
                    <td>
                      <code>{v.ip || "—"}</code>
                    </td>
                    <td className="muted">
                      {[v.city, v.region, v.isp]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td>
                      {v.device_type === "mobile" ? "📱" : "🖥️"}{" "}
                      {v.device_type || "—"}
                    </td>
                    <td className="muted">{v.source || "—"}</td>
                    <td>
                      {v.notified ? (
                        <span className="chip green sm">✓</span>
                      ) : (
                        <span className="chip gray sm">—</span>
                      )}
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
            {detail.total > 50 && (
              <div className="pager" style={{ marginTop: 8 }}>
                <button
                  className="btn-sm"
                  disabled={detail.page <= 1}
                  onClick={() =>
                    openDetail(detail.docPk, detail.filename, detail.page - 1)
                  }
                >
                  ‹ Trước
                </button>
                <span className="muted">
                  Trang {detail.page}/{Math.ceil(detail.total / 50)}
                </span>
                <button
                  className="btn-sm"
                  disabled={detail.page >= Math.ceil(detail.total / 50)}
                  onClick={() =>
                    openDetail(detail.docPk, detail.filename, detail.page + 1)
                  }
                >
                  Sau ›
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
