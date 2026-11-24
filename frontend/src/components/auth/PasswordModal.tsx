import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AppButton } from "../ui/AppButton";
import { AppModal } from "../ui/AppModal";
import { FormField } from "../ui/FormGrid";
import { InlineAlert } from "../ui/InlineAlert";

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

  const formId = useId();
  const curId = useId();
  const nextId = useId();
  const confirmId = useId();
  const curInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setCur("");
      setNext("");
      setConfirm("");
      setErr("");
      setBusy(false);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
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
      dismissible={!forced && !busy}
      onClose={() => {
        if (!forced && !busy) onClose?.();
      }}
      size="sm"
      initialFocusRef={curInputRef}
      title={forced ? "Bắt buộc đổi mật khẩu" : "Đổi mật khẩu tài khoản"}
      subtitle={
        forced
          ? "Tài khoản đang sử dụng mật khẩu tạm thời. Vui lòng đặt mật khẩu riêng trước khi tiếp tục."
          : "Sau khi đổi mật khẩu, các phiên đăng nhập cũ trên thiết bị khác sẽ tự động thu hồi."
      }
      footer={
        <>
          {!forced && (
            <AppButton
              variant="secondary"
              onClick={() => onClose?.()}
              disabled={busy}
            >
              Hủy
            </AppButton>
          )}
          <AppButton
            type="submit"
            form={formId}
            variant="primary"
            leftIcon="key"
            loading={busy}
          >
            {busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
          </AppButton>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="ui-password-form">
        {forced && (
          <InlineAlert tone="warning">
            Để bảo vệ dữ liệu chứng từ, tài khoản mới cấp bắt buộc phải đổi mật
            khẩu trước khi sử dụng.
          </InlineAlert>
        )}

        <FormField label="Mật khẩu hiện tại" htmlFor={curId} required>
          <input
            id={curId}
            ref={curInputRef}
            className="ui-input"
            type="password"
            name="current_password"
            autoComplete="current-password"
            required
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            disabled={busy}
          />
        </FormField>

        <FormField
          label="Mật khẩu mới"
          htmlFor={nextId}
          required
          hint="Tối thiểu 8 ký tự và khác mật khẩu hiện tại."
        >
          <input
            id={nextId}
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
        </FormField>

        <FormField label="Nhập lại mật khẩu mới" htmlFor={confirmId} required>
          <input
            id={confirmId}
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
        </FormField>

        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      </form>
    </AppModal>
  );
}
