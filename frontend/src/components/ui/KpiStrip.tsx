import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";
import { SkeletonBlock } from "./SkeletonBlock";

export type KpiCanonicalTone =
  | "neutral"
  | "brand"
  | "gold"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type KpiTone =
  | KpiCanonicalTone
  | "default"
  | "teal"
  | "green"
  | "amber"
  | "coral"
  | "red"
  | "ink";

export type KpiStripColumns = 2 | 3 | 4 | 5;

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  icon?: IconName;
  tone?: KpiTone;
  onClick?: () => void;
  active?: boolean;
}

export interface KpiStripProps {
  items: KpiItem[];
  loading?: boolean;
  columns?: KpiStripColumns;
  className?: string;
}

const LEGACY_TONE_MAP: Record<KpiTone, KpiCanonicalTone> = {
  neutral: "neutral",
  ink: "neutral",
  brand: "brand",
  teal: "brand",
  default: "brand",
  gold: "gold",
  info: "info",
  success: "success",
  green: "success",
  warning: "warning",
  amber: "warning",
  danger: "danger",
  coral: "danger",
  red: "danger",
};

function resolveKpiTone(tone?: KpiTone): KpiCanonicalTone {
  if (!tone) return "brand";
  return LEGACY_TONE_MAP[tone] ?? "brand";
}

export function KpiStrip({
  items,
  loading = false,
  columns,
  className = "",
}: KpiStripProps) {
  const stripCls = [
    "ui-kpi-strip",
    columns ? `ui-kpi-strip--cols-${columns}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (loading) {
    const skeletonCount = items.length > 0 ? items.length : (columns ?? 4);
    return (
      <section
        className={stripCls}
        aria-busy="true"
        aria-label="Đang tải chỉ số"
      >
        {Array.from({ length: skeletonCount }).map((_, idx) => (
          <div
            key={idx}
            className="ui-kpi-card ui-kpi-card--neutral ui-kpi-card--skeleton"
            aria-hidden="true"
          >
            <SkeletonBlock variant="line" className="ui-kpi-skeleton-label" />
            <SkeletonBlock variant="title" className="ui-kpi-skeleton-value" />
            <SkeletonBlock variant="line" className="ui-kpi-skeleton-sub" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className={stripCls}>
      {items.map((item, idx) => {
        const canonicalTone = resolveKpiTone(item.tone);
        const cls = [
          "ui-kpi-card",
          `ui-kpi-card--${canonicalTone}`,
          item.active ? "is-active" : "",
          item.onClick ? "is-clickable" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const body = (
          <>
            <div className="ui-kpi-head">
              <span className="ui-kpi-label">{item.label}</span>
              {item.icon && (
                <span className="ui-kpi-icon" aria-hidden="true">
                  <AppIcon name={item.icon} size={16} />
                </span>
              )}
            </div>
            <div className="ui-kpi-value-row">
              <strong className="ui-kpi-value num">{item.value}</strong>
              {item.delta !== undefined && item.delta !== null && (
                <span className="ui-kpi-delta">{item.delta}</span>
              )}
            </div>
            {item.sub !== undefined && item.sub !== null && (
              <small className="ui-kpi-sub">{item.sub}</small>
            )}
          </>
        );

        if (item.onClick) {
          return (
            <button
              key={idx}
              type="button"
              className={cls}
              onClick={item.onClick}
              aria-pressed={item.active || undefined}
            >
              {body}
            </button>
          );
        }

        return (
          <article key={idx} className={cls}>
            {body}
          </article>
        );
      })}
    </section>
  );
}
