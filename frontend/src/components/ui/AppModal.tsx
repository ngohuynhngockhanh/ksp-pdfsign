import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { AppIcon } from "./Icon";

export type AppModalSize = "sm" | "md" | "lg" | "full";

export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: AppModalSize;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

let activeOverlayLocks = 0;
let savedBodyOverflow = "";
const openOverlayStack: string[] = [];

export function acquireBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  activeOverlayLocks += 1;
  if (activeOverlayLocks === 1) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

export function releaseBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  activeOverlayLocks = Math.max(0, activeOverlayLocks - 1);
  if (activeOverlayLocks === 0) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = "";
  }
}

export function pushOverlayId(id: string): void {
  const idx = openOverlayStack.indexOf(id);
  if (idx !== -1) openOverlayStack.splice(idx, 1);
  openOverlayStack.push(id);
}

export function removeOverlayId(id: string): void {
  const idx = openOverlayStack.indexOf(id);
  if (idx !== -1) openOverlayStack.splice(idx, 1);
}

export function isTopOverlayId(id: string): boolean {
  return (
    openOverlayStack.length > 0 &&
    openOverlayStack[openOverlayStack.length - 1] === id
  );
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  });
}

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
  initialFocusRef,
}: AppModalProps) {
  const modalId = useId();
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    acquireBodyScrollLock();
    pushOverlayId(modalId);

    const rafId = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const requested = initialFocusRef?.current;
      if (requested && dialog.contains(requested)) {
        requested.focus();
        return;
      }

      if (dialog.contains(document.activeElement)) {
        return;
      }

      const autoFocused = dialog.querySelector<HTMLElement>("[autofocus]");
      if (autoFocused) {
        autoFocused.focus();
        return;
      }

      const focusables = getFocusableElements(dialog);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }
    });

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!isTopOverlayId(modalId)) return;

      if (ev.key === "Escape") {
        if (dismissibleRef.current) {
          ev.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (ev.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = getFocusableElements(dialog);
        if (focusables.length === 0) {
          ev.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (ev.shiftKey) {
          if (!active || active === first || !dialog.contains(active)) {
            ev.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialog.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      removeOverlayId(modalId);
      releaseBodyScrollLock();

      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, modalId, initialFocusRef]);

  if (!open) return null;

  const dialogCls = [
    "ui-modal",
    "ui-modal-sheet",
    `ui-modal-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="ui-modal-backdrop"
      onClick={() => {
        if (dismissible) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={dialogCls}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-handle" aria-hidden="true" />
        <header className="ui-modal-header">
          <div className="ui-modal-title-group">
            <h3 id={titleId} className="ui-modal-title">
              {title}
            </h3>
            {subtitle && (
              <p id={subtitleId} className="ui-modal-subtitle">
                {subtitle}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              className="ui-modal-close"
              aria-label="Đóng hộp thoại"
              onClick={onClose}
            >
              <AppIcon name="x" size={18} />
            </button>
          )}
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
