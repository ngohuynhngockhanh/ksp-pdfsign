import { useEffect, useState } from "react";
import { api } from "../api";

type Row = Awaited<ReturnType<typeof api.auditLog>>["items"][number];

const ACTION_CHIP: Record<string, string> = {
  login: "green",
  login_fail: "red",
  login_locked: "red",
  sign: "indigo",
  bbbg_generate: "indigo",
  quote_generate: "indigo",
  ai_narrative: "indigo",
  delete_doc: "red",
  customer_delete: "red",
  bulk_delete: "red",
  password_change: "amber",
  password_reset: "amber",
};

// Nhan loc thao tac (khop ACTION_LABELS backend)
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
  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd (local)
  const [dateTo, setDateTo] = useState("");
  const [err, setErr] = useState("");
  const pages = Math.max(1, Math.ceil(total / perPage));

  async function load(p = page) {
    setErr("");
    try {
      // Ngay local -> khoang thoi gian UTC (dau ngay / cuoi ngay)
      const tsFrom = dateFrom ? new Date(dateFrom + "T00:00:00").toISOString() : "";
      const tsTo = dateTo ? new Date(dateTo + "T23:59:59.999").toISOString() : "";
      const r = await api.auditLog({ search, action, tsFrom, tsTo, page: p, perPage });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Doi filter -> ve trang 1 (search co debounce go phim)
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

  function Pager() {
    if (pages <= 1) return null;
    return (
      <div className="pager">
        <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(1)}>
          « Đầu
        </button>
        <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ‹ Trước
        </button>
        <span className="muted">
          Trang {page}/{pages} · {total} dòng
        </span>
        <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Sau ›
        </button>
        <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(pages)}>
          Cuối »
        </button>
      </div>
    );
  }

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Nhật ký thao tác <span className="count">{total}</span>
        </h3>
        <div className="tb-group audit-filters">
          <input
            className="search"
            placeholder="🔍 Tìm user / đối tượng…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="tb-select"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {ACTION_OPTIONS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label className="date-f" title="Từ ngày">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <span className="muted">→</span>
          <label className="date-f" title="Đến ngày">
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <select
            className="tb-select pp"
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            title="Số dòng mỗi trang"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}/trang
              </option>
            ))}
          </select>
          {(search || action || dateFrom || dateTo) && (
            <button
              className="btn-sm"
              onClick={() => {
                setSearch("");
                setAction("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              ✕ Xoá lọc
            </button>
          )}
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="dt">
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
                <td className="muted nowrap">{new Date(r.ts).toLocaleString("vi-VN")}</td>
                <td>
                  {r.username}
                  {r.role === "admin" && <span className="chip gray sm"> admin</span>}
                </td>
                <td>
                  <span className={"chip sm " + (ACTION_CHIP[r.action] || "gray")}>
                    {r.action_label}
                  </span>
                </td>
                <td className="fname">
                  <span className="ft">{r.target}</span>
                </td>
                <td className="muted col-hide-sm">{r.detail}</td>
                <td className="muted col-hide-sm nowrap">{r.ip}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <div className="empty-ic">📜</div>
                    <div>Không có nhật ký khớp bộ lọc.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager />
    </div>
  );
}
