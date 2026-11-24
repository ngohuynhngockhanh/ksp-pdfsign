export type SkeletonVariant = "line" | "title" | "card" | "rect";

export interface SkeletonBlockProps {
  variant?: SkeletonVariant;
  lines?: number;
  className?: string;
}

export function SkeletonBlock({
  variant = "line",
  lines = 1,
  className = "",
}: SkeletonBlockProps) {
  const count = Math.max(1, Math.floor(lines));

  if (count === 1) {
    const cls = [
      "ui-skeleton",
      `ui-skeleton--${variant}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return <div className={cls} aria-hidden="true" />;
  }

  const stackCls = [
    "ui-skeleton-stack",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={stackCls} aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => {
        const isShort = variant === "line" && idx === count - 1;
        return (
          <div
            key={idx}
            className={`ui-skeleton ui-skeleton--${variant}${isShort ? " ui-skeleton--short" : ""}`}
          />
        );
      })}
    </div>
  );
}

export interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function TableSkeleton({
  rows = 5,
  cols = 5,
  className = "",
}: TableSkeletonProps) {
  const rowCount = Math.max(1, Math.floor(rows));
  const colCount = Math.max(1, Math.floor(cols));

  const cls = ["ui-table-skeleton", className].filter(Boolean).join(" ");

  return (
    <div
      className={cls}
      role="status"
      aria-busy="true"
      aria-label="Đang tải dữ liệu"
    >
      <table className="ui-table-skeleton-table" aria-hidden="true">
        <thead>
          <tr>
            {Array.from({ length: colCount }).map((_, c) => (
              <th key={c}>
                <span className="ui-skeleton ui-skeleton--line ui-skeleton--th" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: colCount }).map((_, c) => {
                const cellMod =
                  c === 0
                    ? " ui-skeleton--cell-primary"
                    : c === colCount - 1
                      ? " ui-skeleton--short"
                      : "";
                return (
                  <td key={c}>
                    <span className={`ui-skeleton ui-skeleton--line${cellMod}`} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
