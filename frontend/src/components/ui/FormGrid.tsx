import type { CSSProperties, ReactNode } from "react";

export interface FormGridProps {
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function FormGrid({
  cols = 2,
  className = "",
  children,
  style,
}: FormGridProps) {
  return (
    <div
      className={`ui-form-grid ui-form-grid-${cols}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {children}
    </div>
  );
}
