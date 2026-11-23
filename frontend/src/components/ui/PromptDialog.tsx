import { useEffect, useState, type ReactNode } from "react";
import { AppModal } from "./AppModal";

export interface PromptDialogProps {
  open: boolean;
  title: ReactNode;
  label?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (val: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  defaultValue = "",
  placeholder = "",
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
    }
  }, [open, defaultValue]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(value);
  }

  return (
    <AppModal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="submit" form="ui-prompt-dialog-form" className="primary">
            {confirmLabel}
          </button>
        </>
      }
    >
      <form id="ui-prompt-dialog-form" onSubmit={handleSubmit}>
        <label>
          {label}
          <input
            className="ui-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      </form>
    </AppModal>
  );
}
