import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppIcon, type IconName } from "./Icon";

export type ToastTone = "info" | "success" | "warning" | "error";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
  dismissToast: (id: number) => void;
  push: (message: string, tone?: ToastTone, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
}

const TOAST_ICON_BY_TONE: Record<ToastTone, IconName> = {
  success: "check-circle",
  error: "alert-circle",
  info: "info",
  warning: "alert-triangle",
};

const noop = () => {};

const ToastContext = createContext<ToastContextValue>({
  showToast: noop,
  dismissToast: noop,
  push: noop,
  success: noop,
  error: noop,
  info: noop,
  warning: noop,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seqRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "info", durationMs = 4200) => {
      const id = ++seqRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      if (durationMs > 0) {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, durationMs);
        timersRef.current.set(id, timer);
      }
    },
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      showToast,
      dismissToast,
      push: showToast,
      success: (message, durationMs) => showToast(message, "success", durationMs),
      error: (message, durationMs) => showToast(message, "error", durationMs),
      info: (message, durationMs) => showToast(message, "info", durationMs),
      warning: (message, durationMs) => showToast(message, "warning", durationMs),
    }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <div className="ui-toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`ui-toast ui-toast-${t.tone} ui-toast--${t.tone}`}
            >
              <span className="ui-toast-icon" aria-hidden="true">
                <AppIcon name={TOAST_ICON_BY_TONE[t.tone]} size={16} />
              </span>
              <span className="ui-toast-msg">{t.message}</span>
              <button
                type="button"
                className="ui-toast-close"
                aria-label="Đóng thông báo"
                onClick={() => dismissToast(t.id)}
              >
                <AppIcon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
