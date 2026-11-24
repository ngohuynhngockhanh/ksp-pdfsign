import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppButton, type AppButtonVariant } from "./AppButton";
import { AppModal } from "./AppModal";
import { AppIcon, type IconName } from "./Icon";

export type ConfirmTone = "primary" | "danger" | "warning";

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const CONFIRM_BUTTON_VARIANT: Record<ConfirmTone, AppButtonVariant> = {
  primary: "primary",
  danger: "danger",
  warning: "gold",
};

const CONFIRM_ICON_BY_TONE: Record<ConfirmTone, IconName> = {
  primary: "help-circle",
  danger: "alert-triangle",
  warning: "alert-triangle",
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  tone = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <AppModal
      open={open}
      onClose={onCancel}
      dismissible={!loading}
      size="sm"
      title={title}
      className={`ui-confirm-dialog ui-confirm-dialog--${tone}`}
      initialFocusRef={tone === "danger" ? cancelBtnRef : confirmBtnRef}
      footer={
        <>
          <AppButton
            ref={cancelBtnRef}
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </AppButton>
          <AppButton
            ref={confirmBtnRef}
            variant={CONFIRM_BUTTON_VARIANT[tone]}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </AppButton>
        </>
      }
    >
      <div className="ui-confirm-body">
        <span
          className={`ui-confirm-icon ui-confirm-icon--${tone}`}
          aria-hidden="true"
        >
          <AppIcon name={CONFIRM_ICON_BY_TONE[tone]} size={20} />
        </span>
        <div className="ui-confirm-message">
          {message ?? "Bạn có chắc chắn muốn tiếp tục thao tác này không?"}
        </div>
      </div>
    </AppModal>
  );
}

interface QueuedConfirm {
  opts: ConfirmOptions;
  resolve: (accepted: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedConfirm[]>([]);
  const queueRef = useRef<QueuedConfirm[]>([]);
  queueRef.current = queue;

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setQueue((prev) => [...prev, { opts, resolve }]);
    });
  }, []);

  const settleCurrent = useCallback((accepted: boolean) => {
    setQueue((prev) => {
      if (prev.length === 0) return prev;
      const [current, ...rest] = prev;
      current.resolve(accepted);
      return rest;
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const item of queueRef.current) {
        item.resolve(false);
      }
    };
  }, []);

  const current = queue[0] ?? null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={current !== null}
        title={current?.opts.title ?? ""}
        message={current?.opts.message}
        confirmLabel={current?.opts.confirmLabel}
        cancelLabel={current?.opts.cancelLabel}
        tone={current?.opts.tone}
        onConfirm={() => settleCurrent(true)}
        onCancel={() => settleCurrent(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
