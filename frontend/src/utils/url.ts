/**
 * Safe external/same-origin URL helpers (SEC-EDGE-10).
 * Blocks javascript:, data:, vbscript:, file:, protocol-relative //, and control characters.
 */
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

export function safeHttpUrl(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return undefined;

  // Allow safe same-origin relative paths (/api/..., /ho-so, etc.) but NOT protocol-relative //evil.com
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function openExternalSafe(raw?: string | null): void {
  const safe = safeHttpUrl(raw);
  if (!safe) return;
  const win = window.open(safe, "_blank", "noopener,noreferrer");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* ignore cross-origin opener guard */
    }
  }
}
