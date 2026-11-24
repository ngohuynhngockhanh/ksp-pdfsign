import type { ReactNode } from "react";
import { AppIcon, type IconName } from "./Icon";

export type StatusBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "brand";

export type StatusBadgeVariant = "soft" | "solid" | "outline";
export type StatusBadgeSize = "sm" | "md";

export interface StatusBadgeProps {
  tone?: StatusBadgeTone;
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
  dot?: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function StatusBadge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  dot = false,
  icon,
  children,
  className = "",
  title,
}: StatusBadgeProps) {
  const cls = [
    "ui-badge",
    `ui-badge--${tone}`,
    `ui-badge--${variant}`,
    `ui-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls} title={title}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {icon && (
        <AppIcon
          name={icon}
          size={size === "sm" ? 12 : 14}
          className="ui-badge-icon"
        />
      )}
      <span className="ui-badge-text">{children}</span>
    </span>
  );
}
