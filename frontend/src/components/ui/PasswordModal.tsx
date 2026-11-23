import { useEffect, useState } from "react";
import { AppModal } from "./AppModal";

export interface PasswordModalProps {
  open: boolean;
  forced?: boolean;
  onClose?: () => void;
  onSubmit: (cur: string, next: string) => Promise<void>;
}

export function PasswordModal({
  open,
  forced = false,
  onClose,
  onSubmit,
}: PasswordModalProps) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setCur("");
      setNext("");
      setConfirm("");
      setErr("");
      setBusy(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!cur) {
      setErr("Vui lòng nhập mật khẩu hiện tại.");
      return;
    }
    if (!next || next.length < 8) {
      setErr("Mật khẩu mới phải dài tối thiểu 8 ký tự.");
      return;
    }
    if (next === cur) {
      setErr("Mật khẩu mới phải khác mật khẩu hiện tại.");
      return;
    }
    if (next !== confirm) {
      setErr("Mật khẩu xác nhận không khớp.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(cur, next);
      setCur("");
      setNext("");
      setConfirm("");
    } catch (ex) {
      setErr((ex as Error).message || "Không thể đổi mật khẩu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppModal
      open={open}
      dismissible={!forced}
      onClose={() => {
        if (!forced) onClose?.();
      }}
      size="sm"
      title={forced ? "Bắt buộc đổi mật khẩu" : "Đổi mật khẩu tài khoản"}
      subtitle={
        forced
          ? "Tài khoản đang sử dụng mật khẩu tạm thời. Vui lòng đặt mật khẩu riêng trước khi tiếp tục."
          : "Sau khi đổi mật khẩu, các phiên đăng nhập cũ trên thiết bị khác sẽ tự động thu hồi."
      }
      footer={
        <>
          {!forced && (
            <button type="button" onClick={() => onClose?.()} disabled={busy}>
              Hủy
            </button>
          )}
          <button
            type="submit"
            form="ui-password-modal-form"
            className="primary"
            disabled={busy}
          >
            {busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
          </button>
        </>
      }
    >
      <form id="ui-password-modal-form" onSubmit={handleSubmit} className="ui-password-form">
        {forced && (
          <div className="warn-banner" role="alert">
            Để bảo vệ dữ liệu chứng từ, tài khoản mới cấp bắt buộc phải đổi mật khẩu trước khi sử dụng.
          </div>
        )}
        <label>
          Mật khẩu hiện tại
          <input
            className="ui-input"
            type="password"
            name="current_password"
            autoComplete="current-password"
            required
            autoFocus
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Mật khẩu mới (tối thiểu 8 ký tự)
          <input
            className="ui-input"
            type="password"
            name="new_password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Nhập lại mật khẩu mới
          <input
            className="ui-input"
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
        </label>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
      </form>
    </AppModal>
  );
}
