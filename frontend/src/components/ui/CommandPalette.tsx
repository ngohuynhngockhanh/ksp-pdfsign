import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { AppButton } from "./AppButton";
import {
  acquireBodyScrollLock,
  getFocusableElements,
  isTopOverlayId,
  pushOverlayId,
  releaseBodyScrollLock,
  removeOverlayId,
} from "./AppModal";
import { AppIcon, type IconName } from "./Icon";

export interface CommandPaletteItem {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  meta?: string;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  items: CommandPaletteItem[];
}

function normalizeVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

interface IndexedItem {
  item: CommandPaletteItem;
  normLabel: string;
  normMeta: string;
  normGroup: string;
  normHaystack: string;
}

interface GroupedResult {
  group: string;
  entries: Array<{ item: CommandPaletteItem; flatIndex: number }>;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: CommandPaletteProps) {
  const overlayId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);

  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;

  const indexed = useMemo<IndexedItem[]>(
    () =>
      items.map((item) => {
        const normLabel = normalizeVi(item.label);
        const normMeta = normalizeVi(item.meta || "");
        const normGroup = normalizeVi(item.group);
        const normKeywords = (item.keywords || []).map(normalizeVi).join(" ");
        return {
          item,
          normLabel,
          normMeta,
          normGroup,
          normHaystack: `${normLabel} ${normMeta} ${normGroup} ${normKeywords}`,
        };
      }),
    [items],
  );

  const { groups, flatItems } = useMemo<{
    groups: GroupedResult[];
    flatItems: CommandPaletteItem[];
  }>(() => {
    const q = normalizeVi(query);
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

    const matched: Array<{ entry: IndexedItem; score: number; order: number }> = [];
    indexed.forEach((entry, order) => {
      if (tokens.length === 0) {
        matched.push({ entry, score: 0, order });
        return;
      }
      const allMatch = tokens.every((tok) => entry.normHaystack.includes(tok));
      if (!allMatch) return;

      let score = 0;
      if (entry.normLabel === q) score = 400;
      else if (entry.normLabel.startsWith(q)) score = 300;
      else if (entry.normLabel.includes(q)) score = 200;
      else if (entry.normMeta.includes(q)) score = 120;
      else score = 60;

      matched.push({ entry, score, order });
    });

    const groupMap = new Map<string, Array<{ entry: IndexedItem; score: number; order: number }>>();
    for (const m of matched) {
      const key = m.entry.item.group;
      const bucket = groupMap.get(key);
      if (bucket) {
        bucket.push(m);
      } else {
        groupMap.set(key, [m]);
      }
    }

    const grouped: GroupedResult[] = [];
    const flat: CommandPaletteItem[] = [];

    for (const [group, bucket] of groupMap.entries()) {
      if (tokens.length > 0) {
        bucket.sort((a, b) => b.score - a.score || a.order - b.order);
      }
      const entries = bucket.map(({ entry }) => {
        const flatIndex = flat.length;
        flat.push(entry.item);
        return { item: entry.item, flatIndex };
      });
      grouped.push({ group, entries });
    }

    return { groups: grouped, flatItems: flat };
  }, [indexed, query]);

  const safeActiveIndex =
    flatItems.length === 0 ? -1 : Math.min(activeIndex, flatItems.length - 1);

  const closePalette = useCallback(() => {
    onOpenChangeRef.current(false);
  }, []);

  const executeItem = useCallback((item: CommandPaletteItem) => {
    onOpenChangeRef.current(false);
    item.onSelect();
  }, []);

  // Global Ctrl+K / Cmd+K shortcut (works globally across the app and toggles open/closed)
  useEffect(() => {
    const onGlobalKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        onOpenChangeRef.current(!openRef.current);
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  // Reset search state when opened & manage scroll lock, overlay stack, Escape, and focus restoration
  useEffect(() => {
    if (!open) return;

    setQuery("");
    setActiveIndex(0);

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    acquireBodyScrollLock();
    pushOverlayId(overlayId);

    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!isTopOverlayId(overlayId)) return;

      if (ev.key === "Escape") {
        ev.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }

      if (ev.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = getFocusableElements(dialog);
        if (focusables.length === 0) {
          ev.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (ev.shiftKey) {
          if (!active || active === first || !dialog.contains(active)) {
            ev.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialog.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      removeOverlayId(overlayId);
      releaseBodyScrollLock();

      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, overlayId]);

  // Keep active option visible inside the scrollable result list
  useEffect(() => {
    if (!open || safeActiveIndex < 0) return;
    const activeEl = document.getElementById(`${listId}-opt-${safeActiveIndex}`);
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [open, safeActiveIndex, listId]);

  const handleInputKeyDown = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      if (flatItems.length === 0) return;
      ev.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
      return;
    }
    if (ev.key === "ArrowUp") {
      if (flatItems.length === 0) return;
      ev.preventDefault();
      setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
      return;
    }
    if (ev.key === "Home" && flatItems.length > 0) {
      ev.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (ev.key === "End" && flatItems.length > 0) {
      ev.preventDefault();
      setActiveIndex(flatItems.length - 1);
      return;
    }
    if (ev.key === "Enter" && safeActiveIndex >= 0 && flatItems[safeActiveIndex]) {
      ev.preventDefault();
      executeItem(flatItems[safeActiveIndex]);
    }
  };

  if (!open) return null;

  const activeDescendantId =
    safeActiveIndex >= 0 ? `${listId}-opt-${safeActiveIndex}` : undefined;

  return (
    <div
      className="ui-cmdk-backdrop"
      data-testid="cmdk-backdrop"
      onClick={closePalette}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhanh lệnh và trang"
        data-testid="cmdk-dialog"
        tabIndex={-1}
        className="ui-cmdk-dialog"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="ui-cmdk-input-wrap">
          <AppIcon name="search" size={18} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls={flatItems.length > 0 ? listId : undefined}
            aria-activedescendant={activeDescendantId}
            aria-label="Tìm nhanh lệnh và trang"
            data-testid="cmdk-input"
            className="ui-cmdk-input"
            placeholder="Tìm nhanh trang, chức năng hoặc thao tác…"
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
          <AppButton
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Đóng hộp thoại"
            data-testid="cmdk-close"
            onClick={closePalette}
          >
            <AppIcon name="x" size={16} />
          </AppButton>
        </div>

        {flatItems.length > 0 ? (
          <div
            id={listId}
            role="listbox"
            aria-label="Danh sách lệnh và trang"
            className="ui-cmdk-list"
            data-testid="cmdk-list"
          >
            {groups.map(({ group, entries }, groupIdx) => {
              const groupHeadingId = `${listId}-grp-${groupIdx}`;
              return (
                <div
                  key={group}
                  role="group"
                  aria-labelledby={groupHeadingId}
                  className="ui-cmdk-group"
                >
                  <div id={groupHeadingId} className="ui-cmdk-group-label">
                    {group}
                  </div>
                  {entries.map(({ item, flatIndex }) => {
                    const isActive = flatIndex === safeActiveIndex;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-opt-${flatIndex}`}
                        role="option"
                        aria-selected={isActive}
                        data-testid={`cmdk-item-${item.id}`}
                        className={`ui-cmdk-item${isActive ? " ui-cmdk-item--active" : ""}`}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => executeItem(item)}
                      >
                        <span className="ui-cmdk-item-icon" aria-hidden="true">
                          <AppIcon name={item.icon} size={16} />
                        </span>
                        <span className="ui-cmdk-item-label">{item.label}</span>
                        {item.meta && (
                          <span className="ui-cmdk-item-meta">{item.meta}</span>
                        )}
                        {item.shortcut && (
                          <kbd className="ui-cmdk-kbd">{item.shortcut}</kbd>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="ui-cmdk-empty"
            role="status"
            data-testid="cmdk-empty"
          >
            Không tìm thấy trang hoặc lệnh phù hợp với “{query.trim()}”.
          </div>
        )}

        <div className="ui-cmdk-footer">
          <span>
            <kbd className="ui-cmdk-kbd">
              <AppIcon name="arrow-up" size={11} />
              <AppIcon name="arrow-down" size={11} />
            </kbd>{" "}
            Di chuyển
          </span>
          <span>
            <kbd className="ui-cmdk-kbd">Enter</kbd> Chọn
          </span>
          <span>
            <kbd className="ui-cmdk-kbd">Esc</kbd> Đóng
          </span>
        </div>
      </div>
    </div>
  );
}
