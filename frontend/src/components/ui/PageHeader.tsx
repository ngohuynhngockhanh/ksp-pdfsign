import type { ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  badges,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`ui-page-header${className ? ` ${className}` : ""}`}>
      <div className="ui-page-header-copy">
        {eyebrow && <div className="ui-page-header-eyebrow">{eyebrow}</div>}
        <h1 className="ui-page-header-title">{title}</h1>
        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
        {badges && <div className="ui-page-header-badges">{badges}</div>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  );
}
