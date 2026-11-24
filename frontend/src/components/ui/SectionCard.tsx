import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";

export type SectionCardPadding = "default" | "compact" | "flush";
export type SectionCardTone = "default" | "subtle";

export interface SectionCardProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  footer?: ReactNode;
  padding?: SectionCardPadding;
  tone?: SectionCardTone;
  className?: string;
  id?: string;
  children: ReactNode;
}

export function SectionCard({
  title,
  eyebrow,
  subtitle,
  icon,
  actions,
  footer,
  padding = "default",
  tone = "default",
  className = "",
  id,
  children,
}: SectionCardProps) {
  const hasHeader = Boolean(title || eyebrow || subtitle || icon || actions);

  const cls = [
    "ui-section-card",
    tone === "subtle" ? "ui-section-card--subtle" : "ui-section-card--default",
    padding !== "default" ? `ui-section-card--${padding}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section id={id} className={cls}>
      {hasHeader && (
        <header className="ui-section-card-head">
          <div className="ui-section-card-heading">
            {eyebrow && <div className="ui-section-card-eyebrow">{eyebrow}</div>}
            {(title || icon) && (
              <div className="ui-section-card-title-row">
                {icon && (
                  <span className="ui-section-card-icon" aria-hidden="true">
                    <AppIcon name={icon} size={16} />
                  </span>
                )}
                {title && <h2 className="ui-section-card-title">{title}</h2>}
              </div>
            )}
            {subtitle && (
              <p className="ui-section-card-subtitle">{subtitle}</p>
            )}
          </div>
          {actions && <div className="ui-section-card-actions">{actions}</div>}
        </header>
      )}

      <div className="ui-section-card-body">{children}</div>

      {footer && <footer className="ui-section-card-footer">{footer}</footer>}
    </section>
  );
}
