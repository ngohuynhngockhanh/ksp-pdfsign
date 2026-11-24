import { useState } from "react";
import { AppIcon } from "./ui/Icon";

export interface DateRange {
  tu: string;
  den: string;
}

export type DateFilterMode =
  | "all"
  | "year"
  | `m${number}`
  | `q${number}`
  | "custom";

export interface DateFilterProps {
  value: DateRange;
  onChange: (v: DateRange) => void;
  initialMode?: DateFilterMode;
  className?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate();
}

function rangeForMonth(year: number, month1based: number): DateRange {
  const last = lastDayOfMonth(year, month1based);
  return {
    tu: `${year}-${pad2(month1based)}-01`,
    den: `${year}-${pad2(month1based)}-${pad2(last)}`,
  };
}

function rangeForQuarter(year: number, q: number): DateRange {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const last = lastDayOfMonth(year, endMonth);
  return {
    tu: `${year}-${pad2(startMonth)}-01`,
    den: `${year}-${pad2(endMonth)}-${pad2(last)}`,
  };
}

export function rangeForYear(year: number): DateRange {
  return { tu: `${year}-01-01`, den: `${year}-12-31` };
}

export function DateFilter({
  value,
  onChange,
  initialMode = "all",
  className = "",
}: DateFilterProps) {
  const [mode, setMode] = useState<DateFilterMode>(initialMode);
  const year = new Date().getFullYear();

  function pick(m: DateFilterMode) {
    setMode(m);
    if (m === "all") {
      onChange({ tu: "", den: "" });
    } else if (m === "year") {
      onChange(rangeForYear(year));
    } else if (m.startsWith("m")) {
      onChange(rangeForMonth(year, Number(m.slice(1))));
    } else if (m.startsWith("q")) {
      onChange(rangeForQuarter(year, Number(m.slice(1))));
    }
  }

  const cls = ["tb-group", "ui-date-filter", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls}>
      <AppIcon name="calendar" size={15} className="ui-date-filter-icon" />
      <select
        className="ui-select tb-select ui-date-filter-select"
        aria-label="Khoảng thời gian"
        value={mode}
        onChange={(e) => pick(e.target.value as DateFilterMode)}
      >
        <option value="all">Tất cả</option>
        <option value="year">Năm nay ({year})</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={`m${m}`}>
            Tháng {m}
          </option>
        ))}
        {[1, 2, 3, 4].map((q) => (
          <option key={q} value={`q${q}`}>
            Quý {q}
          </option>
        ))}
        <option value="custom">Tùy chọn…</option>
      </select>

      {mode === "custom" && (
        <>
          <input
            type="date"
            className="ui-input tb-select ui-date-filter-input"
            aria-label="Từ ngày"
            value={value.tu}
            onChange={(e) => onChange({ ...value, tu: e.target.value })}
          />
          <span className="muted" aria-hidden="true">
            –
          </span>
          <input
            type="date"
            className="ui-input tb-select ui-date-filter-input"
            aria-label="Đến ngày"
            value={value.den}
            onChange={(e) => onChange({ ...value, den: e.target.value })}
          />
        </>
      )}
    </span>
  );
}
