import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  compact = false,
  className = "",
}: EmptyStateProps) {
  const cls = [
    "ui-empty-state",
    compact ? "ui-empty-state--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className="ui-empty-state-icon" aria-hidden="true">
        <AppIcon name={icon} size={compact ? 22 : 28} />
      </div>
      <h3 className="ui-empty-state-title">{title}</h3>
      {description && <p className="ui-empty-state-desc">{description}</p>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
