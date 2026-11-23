import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  dismissToast: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seqRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "info", durationMs = 4200) => {
      const id = ++seqRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      if (durationMs > 0) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, durationMs);
      }
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="ui-toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`ui-toast ui-toast-${t.tone}`}>
              <span className="ui-toast-msg">{t.message}</span>
              <button
                type="button"
                className="ui-toast-close"
                aria-label="Đóng thông báo"
                onClick={() => dismissToast(t.id)}
              >
                ×
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
