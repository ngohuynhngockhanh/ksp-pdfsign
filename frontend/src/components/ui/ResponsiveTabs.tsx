import type { ReactNode } from "react";

export interface ResponsiveTabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface ResponsiveTabsProps<T extends string = string> {
  tabs: Array<ResponsiveTabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function ResponsiveTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  className = "",
  ariaLabel = "Chuyển mục",
}: ResponsiveTabsProps<T>) {
  return (
    <div
      className={`ui-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label={ariaLabel}
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
            <span className="ui-tab-label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== "" && (
              <span className="ui-tab-badge">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
