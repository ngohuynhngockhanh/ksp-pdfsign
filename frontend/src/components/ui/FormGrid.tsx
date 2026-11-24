import type { CSSProperties, ReactNode } from "react";
import { AppIcon } from "./Icon";

export interface FormGridProps {
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  children: ReactNode;
  /** @deprecated Prefer utility classes over inline style; kept temporarily for legacy Wave 2/3 callers. */
  style?: CSSProperties;
}

export function FormGrid({
  cols = 2,
  className = "",
  children,
  style,
}: FormGridProps) {
  const cls = ["ui-form-grid", `ui-form-grid-${cols}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={style}>
      {children}
    </div>
  );
}

export interface FormFieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  fullWidth = false,
  className = "",
  children,
}: FormFieldProps) {
  const hasError = Boolean(error);
  const cls = [
    "ui-field",
    fullWidth ? "ui-form-grid-span-full" : "",
    hasError ? "is-error field-missing" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const labelContent = (
    <>
      <span>{label}</span>
      {required && (
        <span className="ui-field-required" aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  return (
    <div className={cls}>
      {label !== undefined && label !== null && label !== "" && (
        htmlFor ? (
          <label className="ui-field-label" htmlFor={htmlFor}>
            {labelContent}
          </label>
        ) : (
          <span className="ui-field-label">{labelContent}</span>
        )
      )}

      {children}

      {hint && <span className="ui-field-hint">{hint}</span>}

      {hasError && (
        <span className="ui-field-error" role="alert">
          <AppIcon name="alert-circle" size={14} /> {error}
        </span>
      )}
    </div>
  );
}
