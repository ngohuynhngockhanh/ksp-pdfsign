import { useEffect, useState } from "react";
import { api, CustomsCheckLog, CustomsCheckTask } from "../api";

export function CustomsCheckManager() {
  const [tasks, setTasks] = useState<CustomsCheckTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Logs modal
  const [activeTaskForLogs, setActiveTaskForLogs] = useState<CustomsCheckTask | null>(null);
  const [logs, setLogs] = useState<CustomsCheckLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // New task modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTk, setNewTk] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [newLuong, setNewLuong] = useState("Luồng Vàng");
  const [newNotifyMode, setNewNotifyMode] = useState<"always" | "on_change">("always");
  const [newInterval, setNewInterval] = useState(60);

  async function loadTasks() {
    setLoading(true);
    try {
      const data = await api.customsCheckTasks();
      setTasks(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function handleAutoSeed() {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const updated = await api.customsCheckAutoSeed();
      setTasks(updated);
      setMessage(`Đã quét và đồng bộ các tờ khai Luồng Vàng / Luồng Đỏ vào danh sách theo dõi.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunNow(task: CustomsCheckTask) {
    setRunningId(task.id);
    setMessage("");
    setError("");
    try {
      const { result, task: updated } = await api.customsCheckRunTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      const officer = result.cong_chuc_kiem_tra ? ` · Cán bộ: ${result.cong_chuc_kiem_tra}` : "";
      const teleStatus = result.telegram_sent ? " · Đã bắn Telegram 📲" : "";
      const clearNotice = result.is_completed ? " · 🎯 Đã hoàn thành xử lý & clear task!" : "";
      setMessage(`TK ${task.so_to_khai}: ${result.trang_thai_xu_ly}${officer}${teleStatus}${clearNotice}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunningId(null);
    }
  }

  async function handleToggle(task: CustomsCheckTask) {
    try {
      const updated = await api.customsCheckToggleTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function handleToggleMode(task: CustomsCheckTask) {
    try {
      const updated = await api.customsCheckToggleMode(task.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      const modeLabel =
        updated.notify_mode === "always"
          ? "Luôn bắn mỗi chu kỳ (1 tiếng/lần)"
          : "Chỉ bắn khi có đổi trạng thái";
      setMessage(`TK ${task.so_to_khai}: Đã đổi sang "${modeLabel}".`);
    } catch (e) {
      setError((e as Error).message);
    }
  }


  async function handleDelete(task: CustomsCheckTask) {
    if (!window.confirm(`Xác nhận xóa theo dõi tờ khai ${task.so_to_khai}?`)) return;
    try {
      await api.customsCheckDeleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleViewLogs(task: CustomsCheckTask) {
    setActiveTaskForLogs(task);
    setLoadingLogs(true);
    try {
      const l = await api.customsCheckTaskLogs(task.id);
      setLogs(l);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTk.trim()) return;
    try {
      await api.customsCheckCreateTask({
        so_to_khai: newTk.trim(),
        folder_name: newFolder.trim(),
        phan_luong: newLuong,
        interval_minutes: newInterval,
        telegram_notify: true,
        notify_mode: newNotifyMode,
      });
      setShowAddModal(false);
      setNewTk("");
      setNewFolder("");
      await loadTasks();
      setMessage(`Đã thêm task theo dõi tờ khai ${newTk.trim()} thành công.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeCount = tasks.filter((t) => t.status === "active").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <section className="customs-check-manager">
      <header className="customs-check-header">
        <div className="customs-check-title-group">
          <div className="eyebrow">TỰ ĐỘNG HÓA HẢI QUAN · INTERVAL 1 TIẾNG</div>
          <h2>⏱️ Quản lý Task Tra Cứu Tờ Khai (Luồng Vàng / Đỏ)</h2>
          <p>
            Hệ thống định kỳ tra cứu cổng <code>customs.gov.vn</code> mỗi 1 tiếng (60 phút), gửi cảnh báo qua Telegram khi có thay đổi trạng thái hoặc cán bộ kiểm tra, và tự động clear task khi đã hoàn thành thông quan.
          </p>
        </div>
        <div className="customs-check-actions">
          <button className="secondary btn-sm" disabled={loading} onClick={handleAutoSeed} title="Tự động thêm tờ khai Luồng Vàng/Đỏ từ hệ thống">
            🔄 Quét tờ khai Vàng/Đỏ
          </button>
          <button className="primary btn-sm" onClick={() => setShowAddModal(true)}>
            ➕ Thêm task theo dõi
          </button>
        </div>
      </header>

      {message && <div className="payroll-message" style={{ margin: "12px 0" }}>{message}</div>}
      {error && <div className="error" style={{ margin: "12px 0" }}>{error}</div>}

      <div className="customs-check-stats">
        <div className="stat-card">
          <b>{tasks.length}</b>
          <span>Tổng số task</span>
        </div>
        <div className="stat-card active-stat">
          <b>{activeCount}</b>
          <span>Đang theo dõi (1 tiếng/lần)</span>
        </div>
        <div className="stat-card completed-stat">
          <b>{completedCount}</b>
          <span>Đã xong / Thông quan (Clear)</span>
        </div>
      </div>

      <div className="customs-check-table-wrap">
        {!tasks.length ? (
          <p className="muted" style={{ padding: "20px", textAlign: "center" }}>
            Chưa có task theo dõi nào. Bấm <b>"🔄 Quét tờ khai Vàng/Đỏ"</b> để tự động nạp các tờ khai luồng vàng/đỏ từ CSDL.
          </p>
        ) : (
          <table className="customs-check-table">
            <thead>
              <tr>
                <th>Số tờ khai / Bộ hồ sơ</th>
                <th>Phân luồng</th>
                <th>Trạng thái xử lý</th>
                <th>Cán bộ kiểm tra</th>
                <th>Chu kỳ</th>
                <th>Báo Telegram</th>
                <th>Lần check cuối</th>
                <th>Tình trạng task</th>
                <th style={{ textAlign: "right" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const isYellow = task.phan_luong.includes("Vàng") || task.phan_luong === "2";
                const isRed = task.phan_luong.includes("Đỏ") || task.phan_luong === "3";
                const isCompleted = task.status === "completed";

                return (
                  <tr key={task.id} className={`customs-task-row ${task.status}`}>
                    <td>
                      <div className="task-decl-code">
                        <strong>{task.so_to_khai}</strong>
                        {task.folder_name && <small className="task-folder-chip">📁 {task.folder_name}</small>}
                      </div>
                    </td>
                    <td>
                      <span className={`chip sm ${isYellow ? "amber" : isRed ? "red" : "default"}`}>
                        {task.phan_luong || "Chưa rõ"}
                      </span>
                    </td>
                    <td>
                      <div className="task-status-cell">
                        {isCompleted ? (
                          <span className="status-badge completed">
                            ✅ {task.last_status_text || "Hoàn thành xử lý"}
                          </span>
                        ) : task.last_status_text ? (
                          <span className="status-badge processing">
                            ⏳ {task.last_status_text}
                          </span>
                        ) : (
                          <span className="status-badge waiting">Chưa tra cứu</span>
                        )}
                        {task.ngay_thong_quan && (
                          <small className="tq-date">TQ: {task.ngay_thong_quan}</small>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="officer-name">
                        {task.last_officer ? `👮 ${task.last_officer}` : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="interval-tag">{task.interval_minutes} phút</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`notify-mode-btn ${task.notify_mode === "always" ? "mode-always" : "mode-on-change"}`}
                        onClick={() => handleToggleMode(task)}
                        title={
                          task.notify_mode === "always"
                            ? "Đang chọn: Cứ 1 tiếng bắn báo cáo định kỳ. Bấm để chuyển sang 'Chỉ khi có đổi'."
                            : "Đang chọn: Chỉ bắn khi có thay đổi trạng thái/cán bộ. Bấm để chuyển sang 'Luôn bắn mỗi tiếng'."
                        }
                      >
                        {task.notify_mode === "always" ? "🔔 Luôn bắn mỗi tiếng" : "🔕 Chỉ khi có đổi"}
                      </button>
                    </td>
                    <td>
                      <div className="check-times">
                        <small>{task.last_checked_at ? new Date(task.last_checked_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "Chưa check"}</small>
                        {task.status === "active" && task.next_check_at && (
                          <small className="next-time">
                            Kế tiếp: {new Date(task.next_check_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`task-badge ${task.status}`}>
                        {task.status === "active" && "🟢 Đang chạy"}
                        {task.status === "completed" && "🎯 Đã xong (Clear)"}
                        {task.status === "paused" && "⏸️ Tạm dừng"}
                      </span>
                    </td>
                    <td>
                      <div className="task-btn-group">
                        <button
                          className="btn-xs primary"
                          disabled={runningId === task.id}
                          onClick={() => handleRunNow(task)}
                          title="Tra cứu ngay lập tức trên Cổng Hải quan và gửi Telegram nếu có cập nhật"
                        >
                          {runningId === task.id ? "Đang check…" : "🔍 Check ngay"}
                        </button>
                        <button
                          className="btn-xs ghost"
                          onClick={() => handleToggle(task)}
                          title={task.status === "active" ? "Tạm dừng kiểm tra" : "Kích hoạt kiểm tra định kỳ"}
                        >
                          {task.status === "active" ? "⏸️" : "▶️"}
                        </button>
                        <button
                          className="btn-xs ghost"
                          onClick={() => handleViewLogs(task)}
                          title="Xem lịch sử các lần check và tin nhắn Telegram"
                        >
                          📜
                        </button>
                        <button
                          className="btn-xs ghost text-danger"
                          onClick={() => handleDelete(task)}
                          title="Xóa task theo dõi"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Logs Modal */}
      {activeTaskForLogs && (
        <div className="customs-modal-backdrop" onClick={() => setActiveTaskForLogs(null)}>
          <div className="customs-modal-content" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3>📜 Lịch sử kiểm tra: Tờ khai {activeTaskForLogs.so_to_khai}</h3>
              <button className="close-btn" onClick={() => setActiveTaskForLogs(null)}>✕</button>
            </header>
            <div className="modal-body">
              <p className="muted" style={{ marginBottom: "12px" }}>
                Bộ hồ sơ: <b>{activeTaskForLogs.folder_name || "—"}</b> · Phân luồng: <b>{activeTaskForLogs.phan_luong}</b> · Trạng thái hiện tại: <b>{activeTaskForLogs.status}</b>
              </p>
              {loadingLogs ? (
                <p>Đang tải lịch sử…</p>
              ) : !logs.length ? (
                <p className="muted">Chưa có bản ghi log nào.</p>
              ) : (
                <div className="logs-timeline">
                  {logs.map((l) => (
                    <div key={l.id} className={`log-entry ${l.is_completed ? "completed-log" : ""}`}>
                      <div className="log-time">
                        {new Date(l.checked_at).toLocaleString("vi-VN")}
                      </div>
                      <div className="log-details">
                        <div className="log-header">
                          <span className="log-status">{l.trang_thai_xu_ly}</span>
                          {l.cong_chuc_kiem_tra && <span className="log-officer">👮 {l.cong_chuc_kiem_tra}</span>}
                          {l.telegram_sent && <span className="log-telegram">📲 Telegram đã gửi</span>}
                        </div>
                        {l.message && <pre className="log-message">{l.message}</pre>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="customs-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="customs-modal-content small-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3>➕ Thêm task theo dõi tờ khai Hải quan</h3>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>✕</button>
            </header>
            <form onSubmit={handleCreateTask} className="modal-form">
              <label>
                Số tờ khai hải quan (12 chữ số) <span className="text-danger">*</span>
                <input
                  required
                  pattern="[0-9]{11,12}"
                  placeholder="Ví dụ: 108625440120"
                  value={newTk}
                  onChange={(e) => setNewTk(e.target.value)}
                />
              </label>
              <div className="form-row">
                <label>
                  Phân luồng
                  <select value={newLuong} onChange={(e) => setNewLuong(e.target.value)}>
                    <option value="Luồng Vàng">Luồng Vàng</option>
                    <option value="Luồng Đỏ">Luồng Đỏ</option>
                    <option value="Luồng Xanh">Luồng Xanh</option>
                  </select>
                </label>
                <label>
                  Chu kỳ kiểm tra
                  <select value={newInterval} onChange={(e) => setNewInterval(Number(e.target.value))}>
                    <option value={15}>15 phút</option>
                    <option value={30}>30 phút</option>
                    <option value={60}>1 tiếng (Mặc định)</option>
                    <option value={120}>2 tiếng</option>
                  </select>
                </label>
              </div>
              <label>
                Chế độ bắn Telegram
                <select
                  value={newNotifyMode}
                  onChange={(e) => setNewNotifyMode(e.target.value as "always" | "on_change")}
                >
                  <option value="always">🔔 Luôn bắn mỗi chu kỳ (1 tiếng/lần - để biết bot còn chạy)</option>
                  <option value="on_change">🔕 Chỉ bắn khi có thay đổi trạng thái hoặc thông quan</option>
                </select>
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary btn-sm" onClick={() => setShowAddModal(false)}>
                  Hủy
                </button>
                <button type="submit" className="primary btn-sm">
                  Lưu & Bắt đầu theo dõi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
