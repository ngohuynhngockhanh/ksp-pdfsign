import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";

export type InlineAlertTone = "info" | "success" | "warning" | "danger";

export interface InlineAlertProps {
  tone?: InlineAlertTone;
  title?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}

const ALERT_ICON_BY_TONE: Record<InlineAlertTone, IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "alert-circle",
};

export function InlineAlert({
  tone = "info",
  title,
  action,
  onDismiss,
  className = "",
  children,
}: InlineAlertProps) {
  const cls = [
    "ui-inline-alert",
    `ui-inline-alert--${tone}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const role = tone === "danger" || tone === "warning" ? "alert" : "status";

  return (
    <div role={role} className={cls}>
      <span className="ui-inline-alert-icon" aria-hidden="true">
        <AppIcon name={ALERT_ICON_BY_TONE[tone]} size={18} />
      </span>

      <div className="ui-inline-alert-body">
        {title && <div className="ui-inline-alert-title">{title}</div>}
        {children !== undefined && children !== null && (
          <div className="ui-inline-alert-content">{children}</div>
        )}
      </div>

      {action && <div className="ui-inline-alert-action">{action}</div>}

      {onDismiss && (
        <button
          type="button"
          className="ui-inline-alert-dismiss"
          onClick={onDismiss}
          aria-label="Đóng thông báo"
        >
          <AppIcon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
