import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";

export type PageHeaderVariant = "compact" | "hero";

export interface PageHeaderBreadcrumb {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface PageHeaderBackAction {
  label: string;
  onClick: () => void;
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: PageHeaderVariant;
  icon?: IconName;
  breadcrumbs?: PageHeaderBreadcrumb[];
  backAction?: PageHeaderBackAction;
  headingTag?: "h1" | "h2";
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  badges,
  actions,
  className = "",
  variant = "compact",
  icon,
  breadcrumbs,
  backAction,
  headingTag = "h1",
}: PageHeaderProps) {
  const HeadingTag = headingTag;
  const hasNav = Boolean(backAction || (breadcrumbs && breadcrumbs.length > 0));

  const cls = [
    "ui-page-header",
    `ui-page-header--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={cls}>
      <div className="ui-page-header-copy">
        {hasNav && (
          <div className="ui-page-header-nav">
            {backAction && (
              <button
                type="button"
                className="ui-page-header-back"
                onClick={backAction.onClick}
              >
                <AppIcon name="arrow-left" size={14} />
                <span>{backAction.label}</span>
              </button>
            )}
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav className="ui-page-header-breadcrumbs" aria-label="Đường dẫn">
                <ol className="ui-breadcrumbs-list">
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <li key={idx} className="ui-breadcrumb-item">
                        {idx > 0 && (
                          <AppIcon
                            name="chevron-right"
                            size={12}
                            className="ui-breadcrumb-sep"
                          />
                        )}
                        {crumb.onClick ? (
                          <button
                            type="button"
                            className="ui-breadcrumb-link"
                            onClick={crumb.onClick}
                          >
                            {crumb.label}
                          </button>
                        ) : crumb.href && !isLast ? (
                          <a className="ui-breadcrumb-link" href={crumb.href}>
                            {crumb.label}
                          </a>
                        ) : (
                          <span
                            className="ui-breadcrumb-current"
                            aria-current={isLast ? "page" : undefined}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
          </div>
        )}

        {eyebrow && <div className="ui-page-header-eyebrow">{eyebrow}</div>}

        <div className="ui-page-header-title-row">
          {icon && (
            <span className="ui-page-header-icon" aria-hidden="true">
              <AppIcon name={icon} size={variant === "hero" ? 22 : 20} />
            </span>
          )}
          <HeadingTag className="ui-page-header-title">{title}</HeadingTag>
        </div>

        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
        {badges && <div className="ui-page-header-badges">{badges}</div>}
      </div>

      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  );
}
