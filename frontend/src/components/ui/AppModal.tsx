import { useEffect, type ReactNode } from "react";

export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}

let activeModalLocks = 0;

export function AppModal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  footer,
  children,
  className = "",
  dismissible = true,
}: AppModalProps) {
  useEffect(() => {
    if (!open) return;
    activeModalLocks += 1;
    const prevOverflow = document.body.style.overflow;
    if (activeModalLocks === 1) {
      document.body.style.overflow = "hidden";
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && dismissible) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      activeModalLocks = Math.max(0, activeModalLocks - 1);
      if (activeModalLocks === 0) {
        document.body.style.overflow = prevOverflow || "";
      }
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop"
      onClick={() => {
        if (dismissible) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`ui-modal ui-modal-sheet ui-modal-${size}${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-handle" aria-hidden="true" />
        <header className="ui-modal-header">
          <div className="ui-modal-title-group">
            <h3 className="ui-modal-title">{title}</h3>
            {subtitle && <p className="ui-modal-subtitle">{subtitle}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              className="ui-modal-close"
              aria-label="Đóng hộp thoại"
              onClick={onClose}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
