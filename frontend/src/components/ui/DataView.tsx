import { useEffect, useState, type ReactNode } from "react";
import { SkeletonBlock, TableSkeleton } from "./SkeletonBlock";

export interface DataViewProps {
  desktop: ReactNode;
  mobileCards?: ReactNode;
  mobileMode?: "card" | "scroll";
  className?: string;
  loading?: boolean;
  skeletonRows?: number;
  skeletonCols?: number;
  empty?: ReactNode;
  stickyHeader?: boolean;
  tableClassName?: string;
}

export const MOBILE_QUERY = "(max-width: 820px)";

function readIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function DataView({
  desktop,
  mobileCards,
  mobileMode,
  className = "",
  loading = false,
  skeletonRows = 5,
  skeletonCols = 5,
  empty,
  stickyHeader = false,
  tableClassName = "",
}: DataViewProps) {
  const mode = mobileMode ?? (mobileCards !== undefined ? "card" : "scroll");
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  const rootCls = [
    "ui-dataview",
    mode === "card" && mobileCards !== undefined
      ? "ui-dataview-mode-card"
      : "ui-dataview-mode-scroll",
    stickyHeader ? "ui-dataview--sticky" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (loading) {
    const cardCount = Math.max(1, Math.min(8, Math.floor(skeletonRows)));
    return (
      <div className={rootCls}>
        {mode === "card" && mobileCards !== undefined && isMobile ? (
          <div
            className="ui-dataview-mobile"
            role="status"
            aria-busy="true"
            aria-label="Đang tải dữ liệu"
          >
            <div className="ui-mobile-card-list">
              {Array.from({ length: cardCount }).map((_, idx) => (
                <div key={idx} className="ui-mobile-card">
                  <SkeletonBlock variant="title" />
                  <SkeletonBlock variant="line" lines={2} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ui-table-scroll-wrap" tabIndex={0}>
            <TableSkeleton rows={skeletonRows} cols={skeletonCols} />
          </div>
        )}
      </div>
    );
  }

  if (empty !== undefined && empty !== null && empty !== false) {
    return (
      <div className={rootCls}>
        <div className="ui-dataview-empty">{empty}</div>
      </div>
    );
  }

  if (mode === "card" && mobileCards !== undefined) {
    return (
      <div className={rootCls}>
        {isMobile ? (
          <div className="ui-dataview-mobile">{mobileCards}</div>
        ) : (
          <div
            className={["ui-dataview-desktop", tableClassName]
              .filter(Boolean)
              .join(" ")}
          >
            {desktop}
          </div>
        )}
      </div>
    );
  }

  const scrollWrapCls = ["ui-table-scroll-wrap", tableClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls}>
      <div className={scrollWrapCls} tabIndex={0}>
        {desktop}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Composable MobileCard Primitives                                           */
/* ========================================================================== */

export interface MobileCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export function MobileCard({
  children,
  className = "",
  onClick,
  active = false,
}: MobileCardProps) {
  const cls = [
    "ui-mobile-card",
    onClick ? "is-clickable" : "",
    active ? "is-active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <article
        className={cls}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {children}
      </article>
    );
  }

  return <article className={cls}>{children}</article>;
}

export interface MobileCardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function MobileCardHeader({
  title,
  subtitle,
  badge,
  className = "",
  children,
}: MobileCardHeaderProps) {
  const cls = ["ui-mc-head", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div>
        <div className="ui-mc-title">{title}</div>
        {subtitle && <div className="ui-mc-subtitle">{subtitle}</div>}
      </div>
      {badge}
      {children}
    </div>
  );
}

export interface MobileCardGridProps {
  cols?: 1 | 2;
  className?: string;
  children: ReactNode;
}

export function MobileCardGrid({
  cols = 2,
  className = "",
  children,
}: MobileCardGridProps) {
  const cls = [
    "ui-mc-grid",
    cols === 1 ? "ui-form-grid-1" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={cls}>{children}</div>;
}

export interface MobileCardRowProps {
  label: ReactNode;
  value: ReactNode;
  fullWidth?: boolean;
  mono?: boolean;
  className?: string;
}

export function MobileCardRow({
  label,
  value,
  fullWidth = false,
  mono = false,
  className = "",
}: MobileCardRowProps) {
  const cls = [
    "ui-mc-row",
    "ui-mc-field",
    fullWidth ? "ui-form-grid-span-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <span>{label}</span>
      <strong className={mono ? "num" : undefined}>{value}</strong>
    </div>
  );
}

export interface MobileCardActionsProps {
  className?: string;
  children: ReactNode;
}

export function MobileCardActions({
  className = "",
  children,
}: MobileCardActionsProps) {
  const cls = ["ui-mc-actions", className].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
}
