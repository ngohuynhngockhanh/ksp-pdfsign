import { useState, type ReactNode } from "react";
import { AppButton } from "./AppButton";
import { AppIcon } from "./Icon";

export interface FilterBarSearch {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export interface FilterBarProps {
  search?: FilterBarSearch;
  filters?: ReactNode;
  actions?: ReactNode;
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
  collapsibleMobile?: boolean;
  className?: string;
}

export function FilterBar({
  search,
  filters,
  actions,
  activeCount = 0,
  onReset,
  resetLabel = "Xóa lọc",
  collapsibleMobile = true,
  className = "",
}: FilterBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const hasFilters =
    filters !== undefined && filters !== null && filters !== false;
  const showReset = Boolean(onReset && activeCount > 0);

  const cls = ["ui-filter-bar", className].filter(Boolean).join(" ");
  const controlsCls = [
    "ui-filter-bar-controls",
    collapsibleMobile ? "ui-filter-bar-collapsible" : "",
    collapsibleMobile && mobileOpen ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} role="search">
      <div className="ui-filter-bar-row">
        {search && (
          <div className="ui-filter-bar-search">
            <span className="ui-filter-bar-search-icon" aria-hidden="true">
              <AppIcon name="search" size={16} />
            </span>
            <input
              type="search"
              className="ui-input ui-filter-bar-search-input"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Tìm kiếm…"}
              aria-label={search.ariaLabel ?? search.placeholder ?? "Tìm kiếm"}
            />
            {search.value && (
              <button
                type="button"
                className="ui-filter-bar-search-clear"
                aria-label="Xóa từ khóa tìm kiếm"
                onClick={() => search.onChange("")}
              >
                <AppIcon name="x" size={14} />
              </button>
            )}
          </div>
        )}

        {hasFilters && collapsibleMobile && (
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="sliders-horizontal"
            className="ui-filter-bar-toggle"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            Bộ lọc
            {activeCount > 0 && (
              <span className="ui-filter-bar-count">{activeCount}</span>
            )}
          </AppButton>
        )}

        {hasFilters && <div className={controlsCls}>{filters}</div>}

        {(showReset || actions) && (
          <div className="ui-filter-bar-actions">
            {showReset && (
              <AppButton
                variant="ghost"
                size="sm"
                leftIcon="rotate-ccw"
                onClick={onReset}
              >
                {resetLabel}
              </AppButton>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
