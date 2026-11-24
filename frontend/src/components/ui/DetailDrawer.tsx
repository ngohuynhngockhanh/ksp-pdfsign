import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  acquireBodyScrollLock,
  getFocusableElements,
  isTopOverlayId,
  pushOverlayId,
  releaseBodyScrollLock,
  removeOverlayId,
} from "./AppModal";
import { AppIcon } from "./Icon";

export type DetailDrawerSize = "md" | "lg";

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: DetailDrawerSize;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  headerActions,
  footer,
  children,
  className = "",
  dismissible = true,
  initialFocusRef,
}: DetailDrawerProps) {
  const drawerId = useId();
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    pushOverlayId(drawerId);

    const rafId = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const requested = initialFocusRef?.current;
      if (requested && panel.contains(requested)) {
        requested.focus();
        return;
      }

      if (panel.contains(document.activeElement)) {
        return;
      }

      const focusables = getFocusableElements(panel);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panel.focus();
      }
    });

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!isTopOverlayId(drawerId)) return;

      if (ev.key === "Escape") {
        if (dismissibleRef.current) {
          ev.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (ev.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = getFocusableElements(panel);
        if (focusables.length === 0) {
          ev.preventDefault();
          panel.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (ev.shiftKey) {
          if (!active || active === first || !panel.contains(active)) {
            ev.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !panel.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      removeOverlayId(drawerId);
      releaseBodyScrollLock();

      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, drawerId, initialFocusRef]);

  if (!open) return null;

  const panelCls = [
    "ui-drawer-sheet",
    `ui-drawer-sheet--${size}`,
    `ui-drawer-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="ui-drawer-backdrop"
      onClick={() => {
        if (dismissible) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={panelCls}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-drawer-handle" aria-hidden="true" />
        <header className="ui-drawer-header">
          <div className="ui-modal-title-group">
            <h3 id={titleId} className="ui-drawer-title">
              {title}
            </h3>
            {subtitle && (
              <p id={subtitleId} className="ui-drawer-subtitle">
                {subtitle}
              </p>
            )}
          </div>
          {headerActions && (
            <div className="ui-page-header-actions">{headerActions}</div>
          )}
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
        <div className="ui-drawer-body">{children}</div>
        {footer && <footer className="ui-drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}
