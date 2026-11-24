import { forwardRef, type ButtonHTMLAttributes } from "react";
import { AppIcon, type IconName } from "./Icon";

export type AppButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export type AppButtonSize = "sm" | "md" | "lg";

export interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
  iconOnly?: boolean;
  fullWidth?: boolean;
}

const ICON_SIZE_BY_BUTTON_SIZE: Record<AppButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
  function AppButton(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      iconOnly = false,
      fullWidth = false,
      type = "button",
      disabled = false,
      className = "",
      children,
      ...rest
    },
    ref,
  ) {
    const iconSize = ICON_SIZE_BY_BUTTON_SIZE[size];
    const hasChildren =
      children !== undefined && children !== null && children !== false;

    const cls = [
      "ui-btn",
      `ui-btn--${variant}`,
      `ui-btn--${size}`,
      iconOnly ? "ui-btn--icon-only" : "",
      fullWidth ? "ui-btn--full" : "",
      loading ? "is-loading" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type}
        className={cls}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? (
          <AppIcon
            name="loader"
            size={iconSize}
            className="ui-btn-spinner ui-spin"
          />
        ) : leftIcon ? (
          <AppIcon name={leftIcon} size={iconSize} className="ui-btn-icon-el" />
        ) : null}

        {hasChildren && !(loading && iconOnly) ? (
          iconOnly ? (
            children
          ) : (
            <span className="ui-btn-label">{children}</span>
          )
        ) : null}

        {!loading && rightIcon && !iconOnly ? (
          <AppIcon name={rightIcon} size={iconSize} className="ui-btn-icon-el" />
        ) : null}
      </button>
    );
  },
);
