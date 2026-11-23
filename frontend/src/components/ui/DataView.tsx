import { useEffect, useState, type ReactNode } from "react";

export interface DataViewProps {
  desktop: ReactNode;
  mobileCards?: ReactNode;
  mobileMode?: "card" | "scroll";
  className?: string;
}

const MOBILE_QUERY = "(max-width: 768px)";

function readIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function DataView({
  desktop,
  mobileCards,
  mobileMode,
  className = "",
}: DataViewProps) {
  const mode = mobileMode ?? (mobileCards ? "card" : "scroll");
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  if (mode === "card" && mobileCards !== undefined) {
    return (
      <div className={`ui-dataview ui-dataview-mode-card${className ? ` ${className}` : ""}`}>
        {isMobile ? (
          <div className="ui-dataview-mobile" style={{ display: "block" }}>
            {mobileCards}
          </div>
        ) : (
          <div className="ui-dataview-desktop">{desktop}</div>
        )}
      </div>
    );
  }

  return (
    <div className={`ui-dataview ui-dataview-mode-scroll${className ? ` ${className}` : ""}`}>
      <div className="ui-table-scroll-wrap" tabIndex={0}>
        {desktop}
      </div>
    </div>
  );
}
