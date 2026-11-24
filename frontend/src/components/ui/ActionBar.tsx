import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AppButton } from "./AppButton";
import { AppIcon, type IconName } from "./Icon";

export interface ActionBarOverflowItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export interface ActionBarProps {
  selectedCount?: number;
  selectedLabel?: string;
  onClearSelection?: () => void;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  overflowItems?: ActionBarOverflowItem[];
  overflowLabel?: string;
  className?: string;
}

export function ActionBar({
  selectedCount,
  selectedLabel,
  onClearSelection,
  primaryActions,
  secondaryActions,
  overflowItems,
  overflowLabel,
  className = "",
}: ActionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const overflowWrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hasSelection = (selectedCount ?? 0) > 0;
  const hasOverflow = Boolean(overflowItems && overflowItems.length > 0);

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutside = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      if (
        overflowWrapRef.current &&
        target &&
        !overflowWrapRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const handleMenuKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (
      ev.key !== "ArrowDown" &&
      ev.key !== "ArrowUp" &&
      ev.key !== "Home" &&
      ev.key !== "End"
    ) {
      return;
    }
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const items = Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    if (items.length === 0) return;

    ev.preventDefault();
    const curIdx = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIdx = 0;
    if (ev.key === "ArrowDown") {
      nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % items.length;
    } else if (ev.key === "ArrowUp") {
      nextIdx =
        curIdx === -1
          ? items.length - 1
          : (curIdx - 1 + items.length) % items.length;
    } else if (ev.key === "End") {
      nextIdx = items.length - 1;
    }
    items[nextIdx]?.focus();
  };

  const cls = [
    "ui-action-bar",
    hasSelection ? "is-selection-active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} role="toolbar" aria-label="Thanh thao tác">
      {hasSelection && (
        <div className="ui-action-bar-info">
          <AppIcon name="check-square" size={16} />
          <span>{selectedLabel ?? `${selectedCount} đã chọn`}</span>
          {onClearSelection && (
            <AppButton variant="ghost" size="sm" onClick={onClearSelection}>
              Bỏ chọn
            </AppButton>
          )}
        </div>
      )}

      <div className="ui-action-bar-actions">
        {secondaryActions}
        {primaryActions}
        {hasOverflow && overflowItems && (
          <div className="ui-overflow-wrap" ref={overflowWrapRef}>
            <AppButton
              ref={triggerRef}
              variant="secondary"
              size="sm"
              leftIcon="more-horizontal"
              iconOnly={!overflowLabel}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-label={overflowLabel ? undefined : "Thao tác khác"}
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              {overflowLabel ?? null}
            </AppButton>

            {menuOpen && (
              <div
                id={menuId}
                ref={menuRef}
                role="menu"
                className="ui-overflow-menu"
                onKeyDown={handleMenuKeyDown}
              >
                {overflowItems.map((item, idx) => (
                  <button
                    key={`${item.label}-${idx}`}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={`ui-overflow-item${item.danger ? " ui-overflow-item--danger" : ""}`}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onClick();
                    }}
                  >
                    {item.icon && <AppIcon name={item.icon} size={15} />}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
