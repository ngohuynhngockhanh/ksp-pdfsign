import { useEffect, useState } from "react";
import { api, CustomsCheckLog, CustomsCheckTask } from "../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "./ui";

export function CustomsCheckManager() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [tasks, setTasks] = useState<CustomsCheckTask[]>([]);
  const [loading, setLoading] = useState(true);
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
      setTasks(Array.isArray(data) ? data : []);
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
      setTasks(Array.isArray(updated) ? updated : []);
      const msg = "Đã quét và đồng bộ các tờ khai Luồng Vàng / Luồng Đỏ vào danh sách theo dõi.";
      setMessage(msg);
      toast.success(msg);
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
      const teleStatus = result.telegram_sent ? " · Đã gửi Telegram" : "";
      const clearNotice = result.is_completed ? " · Đã hoàn thành xử lý & clear task!" : "";
      const msg = `TK ${task.so_to_khai}: ${result.trang_thai_xu_ly}${officer}${teleStatus}${clearNotice}`;
      setMessage(msg);
      toast.success(msg);
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
      const msg = `TK ${task.so_to_khai}: Đã đổi sang "${modeLabel}".`;
      setMessage(msg);
      toast.info(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(task: CustomsCheckTask) {
    const ok = await askConfirm({
      title: "Xóa task theo dõi tờ khai",
      message: `Xác nhận xóa theo dõi tờ khai ${task.so_to_khai}?`,
      confirmLabel: "Xóa task",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.customsCheckDeleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      toast.success(`Đã xóa task theo dõi tờ khai ${task.so_to_khai}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleViewLogs(task: CustomsCheckTask) {
    setActiveTaskForLogs(task);
    setLoadingLogs(true);
    try {
      const l = await api.customsCheckTaskLogs(task.id);
      setLogs(Array.isArray(l) ? l : []);
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
      const createdTk = newTk.trim();
      await api.customsCheckCreateTask({
        so_to_khai: createdTk,
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
      const msg = `Đã thêm task theo dõi tờ khai ${createdTk} thành công.`;
      setMessage(msg);
      toast.success(msg);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeCount = tasks.filter((t) => t.status === "active").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <SectionCard
      className="customs-check-manager"
      eyebrow="TỰ ĐỘNG HÓA HẢI QUAN · INTERVAL 1 TIẾNG"
      title="Quản lý Task Tra Cứu Tờ Khai (Luồng Vàng / Đỏ)"
      icon="clock"
      subtitle="Định kỳ tra cứu cổng customs.gov.vn mỗi 60 phút, gửi cảnh báo Telegram khi thay đổi trạng thái hoặc cán bộ kiểm tra, và tự clear task khi đã thông quan."
      actions={
        <>
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="refresh"
            disabled={loading}
            onClick={handleAutoSeed}
            title="Tự động thêm tờ khai Luồng Vàng/Đỏ từ hệ thống"
          >
            Quét tờ khai Vàng/Đỏ
          </AppButton>
          <AppButton variant="primary" size="sm" leftIcon="plus" onClick={() => setShowAddModal(true)}>
            Thêm task theo dõi
          </AppButton>
        </>
      }
    >
      <div className="ui-stack">
        {message && (
          <InlineAlert tone="success" onDismiss={() => setMessage("")}>
            {message}
          </InlineAlert>
        )}
        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError("")}>
            {error}
          </InlineAlert>
        )}

        <KpiStrip
          columns={3}
          items={[
            { label: "Tổng số task", value: tasks.length, icon: "list", tone: "neutral" },
            { label: "Đang theo dõi (1 tiếng/lần)", value: activeCount, icon: "activity", tone: "brand" },
            { label: "Đã xong / Thông quan (Clear)", value: completedCount, icon: "check-circle", tone: "info" },
          ]}
        />

        {loading && tasks.length === 0 ? (
          <TableSkeleton rows={3} cols={6} />
        ) : !tasks.length ? (
          <EmptyState
            compact
            icon="clock"
            title="Chưa có task theo dõi tờ khai"
            description='Bấm "Quét tờ khai Vàng/Đỏ" để tự động nạp các tờ khai luồng vàng/đỏ từ CSDL.'
            action={
              <AppButton variant="secondary" size="sm" leftIcon="refresh" onClick={handleAutoSeed}>
                Quét tờ khai Vàng/Đỏ
              </AppButton>
            }
          />
        ) : (
          <DataView
            mobileMode="card"
            desktop={
              <div className="ui-table-scroll-wrap" tabIndex={0}>
                <table className="ui-table">
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
                      <th className="col-act">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const isYellow = task.phan_luong.includes("Vàng") || task.phan_luong === "2";
                      const isRed = task.phan_luong.includes("Đỏ") || task.phan_luong === "3";
                      const isCompleted = task.status === "completed";

                      return (
                        <tr key={task.id}>
                          <td>
                            <strong className="ui-mono ui-text-strong">{task.so_to_khai}</strong>
                            {task.folder_name && (
                              <span className="ui-inline ui-muted ui-mt-1">
                                <AppIcon name="folder" size={12} />
                                <span>{task.folder_name}</span>
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge tone={isYellow ? "warning" : isRed ? "danger" : "neutral"} size="sm" dot>
                              {task.phan_luong || "Chưa rõ"}
                            </StatusBadge>
                          </td>
                          <td>
                            <div className="ui-stack--xs">
                              {isCompleted ? (
                                <StatusBadge tone="success" size="sm" icon="check-circle">
                                  {task.last_status_text || "Hoàn thành xử lý"}
                                </StatusBadge>
                              ) : task.last_status_text ? (
                                <StatusBadge tone="warning" size="sm" icon="clock">
                                  {task.last_status_text}
                                </StatusBadge>
                              ) : (
                                <StatusBadge tone="neutral" size="sm">
                                  Chưa tra cứu
                                </StatusBadge>
                              )}
                              {task.ngay_thong_quan && (
                                <small className="ui-text-xs ui-text-success">TQ: {task.ngay_thong_quan}</small>
                              )}
                            </div>
                          </td>
                          <td>
                            {task.last_officer ? (
                              <span className="ui-inline ui-text-semibold">
                                <AppIcon name="user" size={13} />
                                <span>{task.last_officer}</span>
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {task.interval_minutes} phút
                            </StatusBadge>
                          </td>
                          <td>
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon={task.notify_mode === "always" ? "bell" : "ban"}
                              onClick={() => handleToggleMode(task)}
                              title={
                                task.notify_mode === "always"
                                  ? "Đang chọn: Cứ 1 tiếng bắn báo cáo định kỳ. Bấm để chuyển sang 'Chỉ khi có đổi'."
                                  : "Đang chọn: Chỉ bắn khi có thay đổi trạng thái/cán bộ. Bấm để chuyển sang 'Luôn bắn mỗi tiếng'."
                              }
                            >
                              {task.notify_mode === "always" ? "Luôn bắn mỗi tiếng" : "Chỉ khi có đổi"}
                            </AppButton>
                          </td>
                          <td>
                            <div className="ui-stack--xs ui-muted">
                              <span>
                                {task.last_checked_at
                                  ? new Date(task.last_checked_at).toLocaleTimeString("vi-VN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      day: "2-digit",
                                      month: "2-digit",
                                    })
                                  : "Chưa check"}
                              </span>
                              {task.status === "active" && task.next_check_at && (
                                <span className="ui-text-brand">
                                  Kế tiếp:{" "}
                                  {new Date(task.next_check_at).toLocaleTimeString("vi-VN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <StatusBadge
                              tone={
                                task.status === "active"
                                  ? "success"
                                  : task.status === "completed"
                                    ? "info"
                                    : "neutral"
                              }
                              size="sm"
                              icon={
                                task.status === "active"
                                  ? "activity"
                                  : task.status === "completed"
                                    ? "check-circle"
                                    : "pause"
                              }
                            >
                              {task.status === "active" && "Đang chạy"}
                              {task.status === "completed" && "Đã xong (Clear)"}
                              {task.status === "paused" && "Tạm dừng"}
                            </StatusBadge>
                          </td>
                          <td className="col-act">
                            <div className="ui-row-end">
                              <AppButton
                                variant="primary"
                                size="sm"
                                leftIcon="search"
                                loading={runningId === task.id}
                                onClick={() => handleRunNow(task)}
                                title="Tra cứu ngay lập tức trên Cổng Hải quan và gửi Telegram nếu có cập nhật"
                              >
                                {runningId === task.id ? "Đang check…" : "Check ngay"}
                              </AppButton>
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon={task.status === "active" ? "pause" : "play"}
                                onClick={() => handleToggle(task)}
                                aria-label={task.status === "active" ? "Tạm dừng kiểm tra" : "Kích hoạt kiểm tra định kỳ"}
                                title={task.status === "active" ? "Tạm dừng kiểm tra" : "Kích hoạt kiểm tra định kỳ"}
                              />
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="file-text"
                                onClick={() => handleViewLogs(task)}
                                aria-label={`Xem lịch sử ${task.so_to_khai}`}
                                title="Xem lịch sử các lần check và tin nhắn Telegram"
                              />
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="trash"
                                onClick={() => handleDelete(task)}
                                aria-label={`Xóa task ${task.so_to_khai}`}
                                title="Xóa task theo dõi"
                              />
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
                {tasks.map((task) => {
                  const isYellow = task.phan_luong.includes("Vàng") || task.phan_luong === "2";
                  const isRed = task.phan_luong.includes("Đỏ") || task.phan_luong === "3";
                  return (
                    <MobileCard key={task.id}>
                      <MobileCardHeader
                        title={task.so_to_khai}
                        subtitle={task.folder_name || undefined}
                        badge={
                          <StatusBadge tone={isYellow ? "warning" : isRed ? "danger" : "neutral"} size="sm" dot>
                            {task.phan_luong || "Chưa rõ"}
                          </StatusBadge>
                        }
                      />
                      <MobileCardGrid>
                        <MobileCardRow
                          label="Trạng thái xử lý"
                          value={task.last_status_text || "Chưa tra cứu"}
                          fullWidth
                        />
                        <MobileCardRow label="Cán bộ" value={task.last_officer || "—"} />
                        <MobileCardRow label="Chu kỳ" value={`${task.interval_minutes} phút`} />
                      </MobileCardGrid>
                      <MobileCardActions>
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="search"
                          loading={runningId === task.id}
                          onClick={() => handleRunNow(task)}
                        >
                          {runningId === task.id ? "Đang check…" : "Check ngay"}
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon={task.notify_mode === "always" ? "bell" : "ban"}
                          onClick={() => handleToggleMode(task)}
                        >
                          {task.notify_mode === "always" ? "Mỗi tiếng" : "Khi đổi"}
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          leftIcon={task.status === "active" ? "pause" : "play"}
                          onClick={() => handleToggle(task)}
                          aria-label="Bật/tắt task"
                        />
                        <AppButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          leftIcon="file-text"
                          onClick={() => handleViewLogs(task)}
                          aria-label="Xem log"
                        />
                        <AppButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          leftIcon="trash"
                          onClick={() => handleDelete(task)}
                          aria-label="Xóa task"
                        />
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />
        )}
      </div>

      {/* Logs Modal */}
      <AppModal
        open={!!activeTaskForLogs}
        onClose={() => setActiveTaskForLogs(null)}
        title={activeTaskForLogs ? `Lịch sử kiểm tra: Tờ khai ${activeTaskForLogs.so_to_khai}` : "Lịch sử kiểm tra"}
        subtitle={
          activeTaskForLogs
            ? `Bộ hồ sơ: ${activeTaskForLogs.folder_name || "—"} · Phân luồng: ${activeTaskForLogs.phan_luong} · Trạng thái: ${activeTaskForLogs.status}`
            : undefined
        }
        size="md"
        footer={
          <AppButton variant="secondary" onClick={() => setActiveTaskForLogs(null)}>
            Đóng
          </AppButton>
        }
      >
        {activeTaskForLogs && (
          <>
            {loadingLogs ? (
              <SkeletonBlock variant="line" lines={4} />
            ) : !logs.length ? (
              <EmptyState compact icon="file-text" title="Chưa có bản ghi log nào" />
            ) : (
              <div className="ui-stack">
                {logs.map((l) => (
                  <div key={l.id} className={`ui-subpanel${l.is_completed ? " ui-subpanel--info" : ""}`}>
                    <div className="ui-muted ui-mb-2">{new Date(l.checked_at).toLocaleString("vi-VN")}</div>
                    <div className="ui-row ui-text-xs ui-text-strong">
                      <span>{l.trang_thai_xu_ly}</span>
                      {l.cong_chuc_kiem_tra && (
                        <StatusBadge tone="brand" size="sm" icon="user">
                          {l.cong_chuc_kiem_tra}
                        </StatusBadge>
                      )}
                      {l.telegram_sent && (
                        <StatusBadge tone="success" size="sm" icon="send">
                          Telegram đã gửi
                        </StatusBadge>
                      )}
                    </div>
                    {l.message && <pre className="ui-pre ui-pre--sans ui-mt-2">{l.message}</pre>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </AppModal>

      {/* Add Task Modal */}
      <AppModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Thêm task theo dõi tờ khai Hải quan"
        size="sm"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setShowAddModal(false)}>
              Hủy
            </AppButton>
            <AppButton type="submit" form="customs-add-task-form" variant="primary" leftIcon="plus">
              Lưu &amp; Bắt đầu theo dõi
            </AppButton>
          </>
        }
      >
        <form id="customs-add-task-form" onSubmit={handleCreateTask} className="ui-stack">
          <FormField label="Số tờ khai hải quan (12 chữ số)" htmlFor="customs-new-tk" required>
            <input
              id="customs-new-tk"
              className="ui-input"
              required
              pattern="[0-9]{11,12}"
              placeholder="Ví dụ: 108625440120"
              value={newTk}
              onChange={(e) => setNewTk(e.target.value)}
            />
          </FormField>
          <FormGrid cols={2}>
            <FormField label="Phân luồng" htmlFor="customs-new-luong">
              <select
                id="customs-new-luong"
                className="ui-select"
                value={newLuong}
                onChange={(e) => setNewLuong(e.target.value)}
              >
                <option value="Luồng Vàng">Luồng Vàng</option>
                <option value="Luồng Đỏ">Luồng Đỏ</option>
                <option value="Luồng Xanh">Luồng Xanh</option>
              </select>
            </FormField>
            <FormField label="Chu kỳ kiểm tra" htmlFor="customs-new-interval">
              <select
                id="customs-new-interval"
                className="ui-select"
                value={newInterval}
                onChange={(e) => setNewInterval(Number(e.target.value))}
              >
                <option value={15}>15 phút</option>
                <option value={30}>30 phút</option>
                <option value={60}>1 tiếng (Mặc định)</option>
                <option value={120}>2 tiếng</option>
              </select>
            </FormField>
          </FormGrid>
          <FormField label="Chế độ báo Telegram" htmlFor="customs-new-notify">
            <select
              id="customs-new-notify"
              className="ui-select"
              value={newNotifyMode}
              onChange={(e) => setNewNotifyMode(e.target.value as "always" | "on_change")}
            >
              <option value="always">Luôn bắn mỗi chu kỳ (1 tiếng/lần - để biết bot còn chạy)</option>
              <option value="on_change">Chỉ bắn khi có thay đổi trạng thái hoặc thông quan</option>
            </select>
          </FormField>
        </form>
      </AppModal>
    </SectionCard>
  );
}
