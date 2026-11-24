import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AppIcon, type IconName } from "./Icon";

export type ResponsiveTabsVariant = "underline" | "segmented";

export interface ResponsiveTabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface ResponsiveTabsProps<T extends string = string> {
  tabs: Array<ResponsiveTabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  variant?: ResponsiveTabsVariant;
  className?: string;
  ariaLabel?: string;
}

export function ResponsiveTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  variant = "underline",
  className = "",
  ariaLabel = "Chuyển mục",
}: ResponsiveTabsProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(maxScroll > 2 && el.scrollLeft < maxScroll - 2);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateScrollState();

    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateScrollState);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      ro?.disconnect();
    };
  }, [updateScrollState, tabs.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (activeBtn && typeof activeBtn.scrollIntoView === "function") {
      activeBtn.scrollIntoView({
        behavior: "smooth",
        inline: "nearest",
        block: "nearest",
      });
    }
  }, [active]);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    const delta = Math.max(160, Math.round(el.clientWidth * 0.6)) * direction;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>) => {
      if (
        ev.key !== "ArrowLeft" &&
        ev.key !== "ArrowRight" &&
        ev.key !== "Home" &&
        ev.key !== "End"
      ) {
        return;
      }

      const enabledTabs = tabs.filter((t) => !t.disabled);
      if (enabledTabs.length === 0) return;

      const curIdx = enabledTabs.findIndex((t) => t.id === active);
      let nextIdx = curIdx === -1 ? 0 : curIdx;

      if (ev.key === "ArrowRight") {
        nextIdx = (nextIdx + 1) % enabledTabs.length;
      } else if (ev.key === "ArrowLeft") {
        nextIdx = (nextIdx - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (ev.key === "Home") {
        nextIdx = 0;
      } else if (ev.key === "End") {
        nextIdx = enabledTabs.length - 1;
      }

      const nextTab = enabledTabs[nextIdx];
      if (!nextTab || nextTab.id === active) return;

      ev.preventDefault();
      onChange(nextTab.id);

      const listEl = listRef.current;
      if (listEl) {
        const targetIndex = tabs.findIndex((t) => t.id === nextTab.id);
        const btns = listEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        btns[targetIndex]?.focus();
      }
    },
    [tabs, active, onChange],
  );

  const wrapCls = ["ui-tabs-wrap", className].filter(Boolean).join(" ");
  const viewportCls = [
    "ui-tabs-viewport",
    canScrollLeft ? "has-overflow-left" : "",
    canScrollRight ? "has-overflow-right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const listCls = [
    "ui-tabs",
    variant === "segmented" ? "ui-tabs--segmented" : "ui-tabs--underline",
  ].join(" ");

  return (
    <div className={wrapCls}>
      {canScrollLeft && (
        <button
          type="button"
          className="ui-tabs-scroll-btn"
          aria-label="Cuộn tab sang trái"
          tabIndex={-1}
          onClick={() => scrollTabs(-1)}
        >
          <AppIcon name="chevron-left" size={16} />
        </button>
      )}

      <div className={viewportCls}>
        <div
          ref={listRef}
          className={listCls}
          role="tablist"
          aria-label={ariaLabel}
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={tab.disabled}
                className={`ui-tab${isActive ? " is-active" : ""}`}
                onClick={() => onChange(tab.id)}
              >
                {tab.icon && <AppIcon name={tab.icon} size={15} />}
                <span className="ui-tab-label">{tab.label}</span>
                {tab.badge !== undefined &&
                  tab.badge !== null &&
                  tab.badge !== "" && (
                    <span className="ui-tab-badge">{tab.badge}</span>
                  )}
              </button>
            );
          })}
        </div>
      </div>

      {canScrollRight && (
        <button
          type="button"
          className="ui-tabs-scroll-btn"
          aria-label="Cuộn tab sang phải"
          tabIndex={-1}
          onClick={() => scrollTabs(1)}
        >
          <AppIcon name="chevron-right" size={16} />
        </button>
      )}
    </div>
  );
}
