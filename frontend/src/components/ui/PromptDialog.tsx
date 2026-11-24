import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AppButton } from "./AppButton";
import { AppModal } from "./AppModal";
import { FormField } from "./FormGrid";

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
  const formId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
    }
  }, [open, defaultValue]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onConfirm(value);
  }

  return (
    <AppModal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      initialFocusRef={inputRef}
      footer={
        <>
          <AppButton variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </AppButton>
          <AppButton type="submit" form={formId} variant="primary">
            {confirmLabel}
          </AppButton>
        </>
      }
    >
      <form id={formId} className="ui-prompt-form" onSubmit={handleSubmit}>
        <FormField label={label} htmlFor={inputId}>
          <input
            id={inputId}
            ref={inputRef}
            className="ui-input"
            value={value}
            placeholder={placeholder}
            aria-label={label ? undefined : placeholder || "Nhập nội dung"}
            onChange={(e) => setValue(e.target.value)}
          />
        </FormField>
      </form>
    </AppModal>
  );
}
