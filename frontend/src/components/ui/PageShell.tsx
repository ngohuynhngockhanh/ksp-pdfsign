import type { ReactNode } from "react";

export type PageShellMaxWidth = "default" | "narrow" | "wide";

export interface PageShellProps {
  maxWidth?: PageShellMaxWidth;
  className?: string;
  children: ReactNode;
  "data-page"?: string;
}

export function PageShell({
  maxWidth = "default",
  className = "",
  children,
  "data-page": dataPage,
}: PageShellProps) {
  const cls = [
    "ui-page-shell",
    `ui-page-shell--${maxWidth}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} data-page={dataPage}>
      {children}
    </div>
  );
}
