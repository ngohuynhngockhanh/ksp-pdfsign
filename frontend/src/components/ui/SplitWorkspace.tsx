import { useState, type ReactNode } from "react";

export type SplitWorkspaceVariant = "sidebar-left" | "preview-right" | "inbox";
export type SplitWorkspacePane = "primary" | "secondary";

export interface SplitWorkspaceProps {
  variant?: SplitWorkspaceVariant;
  primary: ReactNode;
  secondary: ReactNode;
  mobileTabs?: [string, string];
  activeMobilePane?: SplitWorkspacePane;
  onMobilePaneChange?: (pane: SplitWorkspacePane) => void;
  stickySecondary?: boolean;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}

export function SplitWorkspace({
  variant = "preview-right",
  primary,
  secondary,
  mobileTabs,
  activeMobilePane,
  onMobilePaneChange,
  stickySecondary,
  className = "",
  primaryClassName = "",
  secondaryClassName = "",
}: SplitWorkspaceProps) {
  const [internalPane, setInternalPane] =
    useState<SplitWorkspacePane>("primary");

  const activePane = activeMobilePane ?? internalPane;
  const setPane = (next: SplitWorkspacePane) => {
    if (activeMobilePane === undefined) {
      setInternalPane(next);
    }
    onMobilePaneChange?.(next);
  };

  const hasSwitcher = Boolean(mobileTabs);
  const shouldStickySecondary =
    stickySecondary ?? variant === "preview-right";

  const rootCls = ["ui-split", `ui-split--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  const primaryCls = [
    "ui-split-primary",
    hasSwitcher && activePane !== "primary" ? "ui-split-pane-hidden" : "",
    primaryClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const secondaryCls = [
    "ui-split-secondary",
    shouldStickySecondary ? "ui-split-sticky" : "",
    hasSwitcher && activePane !== "secondary" ? "ui-split-pane-hidden" : "",
    secondaryClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls}>
      {mobileTabs && (
        <div
          className="ui-split-mobile-switcher"
          role="tablist"
          aria-label="Chuyển vùng làm việc"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activePane === "primary"}
            className={`ui-btn ui-btn--sm ${activePane === "primary" ? "ui-btn--primary" : "ui-btn--ghost"}`}
            onClick={() => setPane("primary")}
          >
            {mobileTabs[0]}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePane === "secondary"}
            className={`ui-btn ui-btn--sm ${activePane === "secondary" ? "ui-btn--primary" : "ui-btn--ghost"}`}
            onClick={() => setPane("secondary")}
          >
            {mobileTabs[1]}
          </button>
        </div>
      )}

      <div className={primaryCls}>{primary}</div>
      <div className={secondaryCls}>{secondary}</div>
    </div>
  );
}
