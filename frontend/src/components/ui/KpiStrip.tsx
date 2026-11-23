import type { ReactNode } from "react";

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "teal" | "ink" | "green" | "amber" | "coral" | "red" | "gold" | string;
  active?: boolean;
  onClick?: () => void;
}

export interface KpiStripProps {
  items: KpiItem[];
  className?: string;
}

export function KpiStrip({ items, className = "" }: KpiStripProps) {
  return (
    <section className={`ui-kpi-strip${className ? ` ${className}` : ""}`}>
      {items.map((item, idx) => {
        const tone = item.tone || "teal";
        const cls = `ui-kpi-card ui-kpi-tone-${tone}${item.active ? " is-active" : ""}${
          item.onClick ? " is-clickable" : ""
        }`;
        if (item.onClick) {
          return (
            <button
              key={idx}
              type="button"
              className={cls}
              onClick={item.onClick}
            >
              <span className="ui-kpi-label">{item.label}</span>
              <strong className="ui-kpi-value num">{item.value}</strong>
              {item.sub && <small className="ui-kpi-sub">{item.sub}</small>}
            </button>
          );
        }
        return (
          <article key={idx} className={cls}>
            <span className="ui-kpi-label">{item.label}</span>
            <strong className="ui-kpi-value num">{item.value}</strong>
            {item.sub && <small className="ui-kpi-sub">{item.sub}</small>}
          </article>
        );
      })}
    </section>
  );
}
