#!/usr/bin/env node
/**
 * INUT Design System v2 — Automated Design System Gatekeeper (G1–G5)
 * Zero-dependency Node ESM script.
 *
 * Usage:
 *   node scripts/design-lint.mjs --warn      # Exit 0, prints full scorecard + per-file breakdown (Waves 1–3)
 *   node scripts/design-lint.mjs --strict    # Exit 1 on any G1–G5 violation (Wave 4 CI gate)
 *   node scripts/design-lint.mjs --json      # Emit machine-readable JSON scorecard
 *   node scripts/design-lint.mjs --verbose   # Include line-level violation samples per file
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const FRONTEND_SRC = path.join(REPO_ROOT, "frontend", "src");
const STYLES_DIR = path.join(FRONTEND_SRC, "styles");
const MODULES_STYLES_DIR = path.join(STYLES_DIR, "modules");
const PAGES_DIR = path.join(FRONTEND_SRC, "pages");
const COMPONENTS_DIR = path.join(FRONTEND_SRC, "components");
const UI_COMPONENTS_DIR = path.join(COMPONENTS_DIR, "ui");
const APP_TSX = path.join(FRONTEND_SRC, "App.tsx");

// Gate thresholds (INUT Design System v2 — #89 & #90)
const THRESHOLDS = {
  maxModuleCssBytes: 35 * 1024, // 35 KiB
  maxModuleCssLines: 900,
  maxCssLineLength: 200,
  allowedBreakpoints: new Set([1280, 1024, 820, 430]),
  maxCanonicalBreakpoints: 4,
  maxZIndexTokens: 6,
  maxDynamicInlineStyles: 15,
  minAppButtonPct: 95,
  minStatusBadgePct: 95,
  minRoutedInShellPages: 36,
  excludedPageHeaderFiles: new Set(["Login.tsx", "PurchaseFixModal.tsx"]),
  nonListSkeletonExemptPages: new Set(["Signer.tsx"]),
};

// Parse CLI args
const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(`INUT Design System v2 Gatekeeper (G1–G5)

Usage:
  node scripts/design-lint.mjs [options]

Options:
  --warn      Report scorecard & per-file breakdown and exit 0 (Waves 1–3)
  --strict    Exit 1 on any G1–G5 violation (default; Wave 4 CI gate)
  --verbose   Print line-level violation details
  --json      Output full JSON report
  -h, --help  Show this help message
`);
  process.exit(0);
}

const isWarn = args.has("--warn") && !args.has("--strict");
const isVerbose = args.has("--verbose");
const isJson = args.has("--json");

// ============================================================================
// Filesystem helpers
// ============================================================================

function walkFiles(dir, extFilter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, extFilter));
    } else if (entry.isFile() && extFilter(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

function relPath(abs) {
  return path.relative(REPO_ROOT, abs).replace(/\\/g, "/");
}

function createLineLookup(src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return function indexToLine(idx) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lineStarts[mid] <= idx) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return hi + 1;
  };
}

// ============================================================================
// Comment & data-URI stripping (preserves exact line numbers & indices)
// ============================================================================

function maskMatchPreserveNewlines(str) {
  return str.replace(/[^\n]/g, " ");
}

function stripCssCommentsAndDataUris(src) {
  // 1. Strip /* ... */ comments preserving newlines
  let out = src.replace(/\/\*[\s\S]*?\*\//g, maskMatchPreserveNewlines);
  // 2. Mask data:image/... URIs so encoded SVG hex colors don't false-positive
  out = out.replace(/data:image\/[^'")\s]+/gi, (m) => "data:image/" + " ".repeat(Math.max(0, m.length - 11)));
  return out;
}

/**
 * Strips JS/TS/TSX comments (// and /* *\/) while preserving string literals
 * (so "https://..." is never truncated) and masks data:image/svg+xml strings.
 * Optionally masks string contents too (useful for native dialog detection).
 */
function stripTsxComments(src, { maskStrings = false } = {}) {
  const len = src.length;
  const chars = new Array(len);
  let i = 0;

  while (i < len) {
    const ch = src[i];
    const next = i + 1 < len ? src[i + 1] : "";

    // Single-line comment
    if (ch === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < len && src[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < len) {
        if (src[i] === "*" && i + 1 < len && src[i + 1] === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          break;
        }
        chars[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    // String literals (' or ")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      chars[i] = ch;
      i++;
      while (i < len) {
        const c = src[i];
        if (c === "\\") {
          chars[i] = maskStrings ? " " : c;
          if (i + 1 < len) {
            chars[i + 1] = maskStrings ? (src[i + 1] === "\n" ? "\n" : " ") : src[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (c === quote) {
          chars[i] = c;
          i++;
          break;
        }
        chars[i] = maskStrings ? (c === "\n" ? "\n" : " ") : c;
        i++;
      }
      continue;
    }

    // Template literals (`...`) — preserve ${...} expressions when maskStrings=true
    if (ch === "`") {
      chars[i] = "`";
      i++;
      let tplDepth = 0;
      while (i < len) {
        const c = src[i];
        if (c === "\\") {
          chars[i] = maskStrings && tplDepth === 0 ? " " : c;
          if (i + 1 < len) {
            chars[i + 1] =
              maskStrings && tplDepth === 0
                ? src[i + 1] === "\n"
                  ? "\n"
                  : " "
                : src[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (tplDepth === 0 && c === "`") {
          chars[i] = "`";
          i++;
          break;
        }
        if (c === "$" && i + 1 < len && src[i + 1] === "{") {
          tplDepth++;
          chars[i] = "$";
          chars[i + 1] = "{";
          i += 2;
          continue;
        }
        if (tplDepth > 0 && c === "}") {
          tplDepth--;
          chars[i] = "}";
          i++;
          continue;
        }
        chars[i] = maskStrings && tplDepth === 0 ? (c === "\n" ? "\n" : " ") : c;
        i++;
      }
      continue;
    }

    chars[i] = ch;
    i++;
  }

  let out = chars.join("");
  // Mask data:image/svg+xml... strings
  out = out.replace(/data:image\/[^'"`\s)]+/gi, (m) => "data:image/" + " ".repeat(Math.max(0, m.length - 11)));
  return out;
}

// ============================================================================
// CSS Analysis (G1 + G2)
// ============================================================================

const CSS_HEX_RE = /(?<![a-zA-Z0-9_-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![a-zA-Z0-9_-])/g;
const CSS_COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|hwb)\s*\(/gi;
const CSS_VAR_RE = /\bvar\(--[a-zA-Z0-9_-]+/g;
const CSS_ZINDEX_TOKEN_DECL_RE = /(--z-[a-zA-Z0-9_-]+)\s*:/g;
const CSS_ZINDEX_VAR_RE = /^var\(\s*(--z-[a-zA-Z0-9_-]+)\s*\)$/;
const CSS_ZINDEX_KEYWORDS = new Set(["auto", "inherit", "initial", "unset", "revert"]);
const CSS_IMPORTANT_RE = /!\s*important\b/gi;
const MEDIA_WIDTH_RE = /(?:(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)\s*px|\bwidth\s*(?:<=|>=|<|>)\s*(\d+(?:\.\d+)?)\s*px)/gi;

function analyzeCssFile(absPath, { isTokens = false, isModule = false, allowedZTokens = null } = {}) {
  const raw = fs.readFileSync(absPath, "utf8");
  const bytes = Buffer.byteLength(raw, "utf8");
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.length;
  const clean = stripCssCommentsAndDataUris(raw);
  const indexToLine = createLineLookup(clean);

  const report = {
    file: relPath(absPath),
    isTokens,
    isModule,
    bytes,
    lines,
    rawHex: [],
    rawColorFn: [],
    varUsages: 0,
    longLines: [],
    importantViolations: [],
    disallowedBreakpoints: [],
    allBreakpoints: new Set(),
    rawZIndex: [],
    zIndexTokens: new Set(),
  };

  // Long lines (> 200 chars) checked on ALL CSS files including 01-tokens.css
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].length > THRESHOLDS.maxCssLineLength) {
      report.longLines.push({ line: i + 1, length: rawLines[i].length });
    }
  }

  if (isTokens) {
    // Count canonical --z-* stacking tokens in 01-tokens.css (G2: <= 6 tokens)
    CSS_ZINDEX_TOKEN_DECL_RE.lastIndex = 0;
    let zm;
    while ((zm = CSS_ZINDEX_TOKEN_DECL_RE.exec(clean)) !== null) {
      report.zIndexTokens.add(zm[1]);
    }
    // Disallow !important inside 01-tokens.css as well
    CSS_IMPORTANT_RE.lastIndex = 0;
    let im;
    while ((im = CSS_IMPORTANT_RE.exec(clean)) !== null) {
      report.importantViolations.push({ line: indexToLine(im.index), prop: "token" });
    }
    return report;
  }

  // Count var(--*) usages
  const varMatches = clean.match(CSS_VAR_RE);
  report.varUsages = varMatches ? varMatches.length : 0;

  // Parse CSS blocks using brace stack so we distinguish selectors vs declarations
  // and know when we are inside @media print or .sr-only.
  const blockStack = []; // { header, isAtRule, isMediaPrint, isSrOnly }
  let bufStart = 0;
  let inSingle = false;
  let inDouble = false;

  const inspectDeclarationChunk = (chunk, chunkOffset) => {
    // Only inspect chunks inside a rule block (not top-level or direct @media prelude)
    const activeRule = blockStack.length > 0 && !blockStack[blockStack.length - 1].isAtRule;
    if (!activeRule) return;

    // Split on ';' to inspect property: value declarations
    let localOffset = 0;
    const decls = chunk.split(";");
    for (const decl of decls) {
      const colonIdx = decl.indexOf(":");
      if (colonIdx !== -1) {
        const prop = decl.slice(0, colonIdx).trim().toLowerCase();
        const val = decl.slice(colonIdx + 1);
        const valOffset = chunkOffset + localOffset + colonIdx + 1;

        // G1: Raw hex colors in declaration values
        CSS_HEX_RE.lastIndex = 0;
        let m;
        while ((m = CSS_HEX_RE.exec(val)) !== null) {
          report.rawHex.push({
            line: indexToLine(valOffset + m.index),
            value: m[0],
            prop,
          });
        }

        // G1: Raw rgb/rgba/hsl/hsla functions
        CSS_COLOR_FN_RE.lastIndex = 0;
        while ((m = CSS_COLOR_FN_RE.exec(val)) !== null) {
          report.rawColorFn.push({
            line: indexToLine(valOffset + m.index),
            value: m[0].trim(),
            prop,
          });
        }

        // G2: Raw numeric or non-token z-index (must use canonical var(--z-*) or CSS keyword)
        if (prop === "z-index") {
          const zVal = val.replace(/!\s*important\b/gi, "").trim();
          const zVarMatch = CSS_ZINDEX_VAR_RE.exec(zVal);
          const isValidToken =
            zVarMatch && (!allowedZTokens || allowedZTokens.has(zVarMatch[1]));
          if (!isValidToken && !CSS_ZINDEX_KEYWORDS.has(zVal.toLowerCase())) {
            report.rawZIndex.push({
              line: indexToLine(valOffset),
              value: zVal,
            });
          }
        }

        // G2: !important outside @media print or .sr-only
        CSS_IMPORTANT_RE.lastIndex = 0;
        while ((m = CSS_IMPORTANT_RE.exec(val)) !== null) {
          const exempt = blockStack.some((b) => b.isMediaPrint || b.isSrOnly);
          if (!exempt) {
            report.importantViolations.push({
              line: indexToLine(valOffset + m.index),
              prop,
            });
          }
        }
      }
      localOffset += decl.length + 1;
    }
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "'" && !inDouble && clean[i - 1] !== "\\") {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && clean[i - 1] !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === "{") {
      const headerRaw = clean.slice(bufStart, i);
      // If we are inside a nested rule block, flush declarations before nested selector
      const lastSemi = headerRaw.lastIndexOf(";");
      const header = (lastSemi >= 0 ? headerRaw.slice(lastSemi + 1) : headerRaw).trim();
      if (lastSemi >= 0 && blockStack.length > 0 && !blockStack[blockStack.length - 1].isAtRule) {
        inspectDeclarationChunk(headerRaw.slice(0, lastSemi + 1), bufStart);
      }

      const lowerHeader = header.toLowerCase();
      const isAtRule =
        lowerHeader.startsWith("@media") ||
        lowerHeader.startsWith("@supports") ||
        lowerHeader.startsWith("@keyframes") ||
        lowerHeader.startsWith("@-webkit-keyframes") ||
        lowerHeader.startsWith("@layer") ||
        lowerHeader.startsWith("@container");
      const isMediaPrint = lowerHeader.startsWith("@media") && /\bprint\b/.test(lowerHeader);
      const selectorParts = lowerHeader
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const isSrOnly =
        selectorParts.length > 0 && selectorParts.every((s) => /\.sr-only\b/.test(s));

      // G2: Check @media width breakpoints
      if (lowerHeader.startsWith("@media")) {
        MEDIA_WIDTH_RE.lastIndex = 0;
        let mm;
        while ((mm = MEDIA_WIDTH_RE.exec(header)) !== null) {
          const w = Number(mm[1] ?? mm[2]);
          if (!Number.isNaN(w)) {
            report.allBreakpoints.add(w);
            if (!THRESHOLDS.allowedBreakpoints.has(w)) {
              report.disallowedBreakpoints.push({
                line: indexToLine(bufStart + (lastSemi >= 0 ? lastSemi + 1 : 0)),
                width: w,
                query: header.replace(/\s+/g, " ").slice(0, 80),
              });
            }
          }
        }
      }

      blockStack.push({ header, isAtRule, isMediaPrint, isSrOnly });
      bufStart = i + 1;
    } else if (ch === "}") {
      const chunk = clean.slice(bufStart, i);
      inspectDeclarationChunk(chunk, bufStart);
      blockStack.pop();
      bufStart = i + 1;
    }
  }

  return report;
}

// ============================================================================
// TSX Analysis (G1, G3, G4, G5)
// ============================================================================

const TSX_HEX6_RE = /(?<![/\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F_-])/g;
const TSX_HEX3_QUOTED_RE = /(['"`])#([0-9a-fA-F]{3,4})\1/g;
const TSX_HEX3_STYLE_RE = /\b(?:solid|dashed|dotted|color|background|backgroundColor|borderColor|fill|stroke)\s*[:=\s]\s*['"`]?(#(?:[0-9a-fA-F]{3,4}))(?![0-9a-fA-F_-])/gi;
const TSX_COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|hwb)\s*\(\s*\d/gi;

// Emoji sequences (excluding © ® ™ which are legal/trademark symbols)
const EMOJI_SEQ_RE = /(?:[\p{Extended_Pictographic}✘✕✖✗✓★☆](?:\uFE0F|\u200D[\p{Extended_Pictographic}])*)/gu;
const EMOJI_EXEMPT = new Set(["©", "®", "™", "©\uFE0F", "®\uFE0F", "™\uFE0F"]);

// Native browser dialogs
const NATIVE_DIALOG_RE = /(?<![.\w$])(?:(?:window|globalThis|self)\s*\.\s*)?(alert|confirm|prompt)\s*\(/g;

// G5 patterns
const CUSTOM_KPI_RE = /className\s*=\s*(?:["'`][^"'`]*|\{[^}]*)\b(?:kpi-grid|kpi-row|kpi-cards|metric-card|metrics-grid|stat-card|stats-grid|spx-stat-card|spx-stats|tm-kpi|piecework-metric|bidding-dossier-kpi|ops-metrics|tax-kpi|ihd-kpi|draft-kpis)\b/g;
const RAW_MODAL_RE = /className\s*=\s*(?:["'`][^"'`]*|\{[^}]*)(?:(?<!ui-)\bmodal-backdrop\b|(?<!ui-)\bmodal-overlay\b|\bspx-modal-backdrop\b|\bspx-modal-overlay\b|\btm-modal-backdrop\b|\btm-modal-overlay\b|\bcustoms-modal-backdrop\b|\bpiecework-modal-backdrop\b|\bdoc-preview-backdrop\b|["']modal["'])/g;
const CUSTOM_TOAST_RE = /className\s*=\s*(?:["'`][^"'`]*|\{[^}]*)\b(?:tm-toast|settings-toast|(?:[a-z]+-)?toast(?:-banner|-box|-bar)?)\b/g;
const RAW_BADGE_CLASS_RE = /className\s*=\s*(?:["'`][^"'`\n]*|\{[^}\n]*)(?<!ui-)(?<!ui-tab-)(?<!ui-filter-)\b(?:badge(?:-[a-z0-9-]+)?|chip|pill|state-pill|status-pill|status-badge|spx-pill(?:-[a-z0-9-]+)?|tm-badge(?:-[a-z0-9-]+)?|messenger-status-[a-z0-9-]+|customs-count-chip|interval-tag|doc-preview-badge)\b/g;

function analyzeTsxFile(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const rawLines = raw.split(/\r?\n/);
  const stripped = stripTsxComments(raw, { maskStrings: false });
  const strippedNoStrings = stripTsxComments(raw, { maskStrings: true });
  const indexToLine = createLineLookup(stripped);
  const rp = relPath(absPath);

  const isUiPrimitive = absPath.startsWith(UI_COMPONENTS_DIR + path.sep);
  const isAppShell = absPath === APP_TSX;
  const isTopLevelPage =
    path.dirname(absPath) === PAGES_DIR && absPath.endsWith(".tsx");
  const baseName = path.basename(absPath);

  const report = {
    file: rp,
    baseName,
    isUiPrimitive,
    isAppShell,
    isTopLevelPage,
    rawColors: [],
    staticInlineStyles: [],
    dynamicInlineStyles: [],
    emojis: [],
    nativeDialogs: [],
    // G5 signals
    hasPageHeader: false,
    hasKpiStrip: false,
    customKpiGrids: 0,
    appModalCount: 0,
    detailDrawerCount: 0,
    rawModalBackdrops: 0,
    hasUseToast: false,
    customToasts: 0,
    appButtonCount: 0,
    rawButtonCount: 0,
    statusBadgeCount: 0,
    rawBadgeCount: 0,
    hasSkeleton: false,
    hasEmptyState: false,
  };

  // ---- G1: Raw hex / rgb / rgba / hsl in TSX ----
  const seenColorPos = new Set();
  const addColor = (idx, value) => {
    const line = indexToLine(idx);
    const key = `${line}:${idx}`;
    if (seenColorPos.has(key)) return;
    // Skip SVG url(#id) or href="#id"
    const before = stripped.slice(Math.max(0, idx - 12), idx);
    if (/href\s*=\s*['"`]?$/i.test(before) || /url\(\s*['"]?$/i.test(before)) return;
    seenColorPos.add(key);
    report.rawColors.push({ line, value });
  };

  let m;
  TSX_HEX6_RE.lastIndex = 0;
  while ((m = TSX_HEX6_RE.exec(stripped)) !== null) {
    addColor(m.index, m[0]);
  }
  TSX_HEX3_QUOTED_RE.lastIndex = 0;
  while ((m = TSX_HEX3_QUOTED_RE.exec(stripped)) !== null) {
    addColor(m.index + 1, `#${m[2]}`);
  }
  TSX_HEX3_STYLE_RE.lastIndex = 0;
  while ((m = TSX_HEX3_STYLE_RE.exec(stripped)) !== null) {
    const hashIdx = m.index + m[0].lastIndexOf("#");
    addColor(hashIdx, m[1]);
  }
  TSX_COLOR_FN_RE.lastIndex = 0;
  while ((m = TSX_COLOR_FN_RE.exec(stripped)) !== null) {
    addColor(m.index, m[0].trim());
  }

  // ---- G3: Inline style={{...}} (and non-primitive style={...}) with /* ds-dynamic */ allowlist ----
  const styleRe = isUiPrimitive ? /\bstyle\s*=\s*\{\{/g : /\bstyle\s*=\s*\{/g;
  while ((m = styleRe.exec(stripped)) !== null) {
    const afterOpen = stripped.slice(m.index + m[0].length, m.index + m[0].length + 40).trim();
    if (/^(?:undefined|null|false)\s*\}/.test(afterOpen)) continue;
    const line = indexToLine(m.index);
    const currRawLine = rawLines[line - 1] || "";
    const prevRawLine = line >= 2 ? rawLines[line - 2] || "" : "";
    const snippetRaw = raw.slice(m.index, Math.min(raw.length, m.index + 240));
    const closeIdx = snippetRaw.indexOf("}}");
    const blockSlice = closeIdx >= 0 ? snippetRaw.slice(0, closeIdx + 2) : snippetRaw;
    const isDynamic =
      /ds-dynamic/i.test(currRawLine) ||
      /ds-dynamic/i.test(prevRawLine) ||
      /ds-dynamic/i.test(blockSlice);
    if (isDynamic) {
      report.dynamicInlineStyles.push({ line });
    } else {
      report.staticInlineStyles.push({ line });
    }
  }

  // ---- G4: Raw UI emojis ----
  const strippedLines = stripped.split(/\r?\n/);
  for (let i = 0; i < strippedLines.length; i++) {
    const lineText = strippedLines[i];
    if (!lineText) continue;
    // Allow explicit opt-out comment for non-UI external message payloads (e.g. Telegram bot text)
    if (/ds-emoji-ok/i.test(rawLines[i] || "")) continue;
    EMOJI_SEQ_RE.lastIndex = 0;
    while ((m = EMOJI_SEQ_RE.exec(lineText)) !== null) {
      const glyph = m[0];
      if (EMOJI_EXEMPT.has(glyph)) continue;
      report.emojis.push({ line: i + 1, value: glyph });
    }
  }

  // ---- G4: Native alert() / confirm() / prompt() ----
  NATIVE_DIALOG_RE.lastIndex = 0;
  while ((m = NATIVE_DIALOG_RE.exec(strippedNoStrings)) !== null) {
    const idx = m.index;
    const before = strippedNoStrings.slice(Math.max(0, idx - 24), idx);
    // Ignore function/type/interface declarations (e.g. `function confirm(`)
    if (/\b(?:function|async|const|let|var|type|interface)\s+$/.test(before)) continue;
    // Ignore TypeScript method signatures `confirm(opts: ...): Promise`
    const afterLineEnd = strippedNoStrings.indexOf("\n", idx);
    const tail = strippedNoStrings.slice(idx, afterLineEnd === -1 ? idx + 120 : afterLineEnd);
    if (/^(?:alert|confirm|prompt)\s*\([^)]*:\s*[A-Za-z]/.test(tail)) continue;
    report.nativeDialogs.push({
      line: indexToLine(idx),
      fn: m[1],
    });
  }

  // ---- G5: Primitive adoption signals ----
  report.hasPageHeader = /<PageHeader\b/.test(stripped);
  report.hasKpiStrip = /<KpiStrip\b/.test(stripped);
  report.hasUseToast = /\buseToast\s*\(/.test(strippedNoStrings);
  // DataView internally renders TableSkeleton/SkeletonBlock during loading states
  report.hasSkeleton = /<(?:SkeletonBlock|TableSkeleton|DataView)\b/.test(stripped);
  report.hasEmptyState = /<EmptyState\b/.test(stripped);

  report.appModalCount = (stripped.match(/<AppModal\b/g) || []).length;
  report.detailDrawerCount = (stripped.match(/<DetailDrawer\b/g) || []).length;

  if (!isUiPrimitive && !isAppShell) {
    report.customKpiGrids = (stripped.match(CUSTOM_KPI_RE) || []).length;
    const rawModalClasses = (stripped.match(RAW_MODAL_RE) || []).length;
    const rawRoleDialogs = (stripped.match(/\brole\s*=\s*["']dialog["']/g) || []).length;
    report.rawModalBackdrops = Math.max(rawModalClasses, rawRoleDialogs);

    // Exclude ToastProvider / ui-toast classes; also catch hand-rolled `position: "fixed"` toasts
    const toastMatches = (stripped.match(CUSTOM_TOAST_RE) || []).filter(
      (s) => !/\bui-toast/.test(s),
    );
    const inlineFixedToast =
      !report.hasUseToast &&
      /\{\s*toast\s*&&[\s\S]{0,300}position\s*:\s*["']fixed["']/.test(stripped)
        ? 1
        : 0;
    report.customToasts = toastMatches.length + inlineFixedToast;

    report.appButtonCount = (stripped.match(/<AppButton\b/g) || []).length;
    report.rawButtonCount = (stripped.match(/<button\b/g) || []).length;

    report.statusBadgeCount = (stripped.match(/<StatusBadge\b/g) || []).length;
    report.rawBadgeCount = (stripped.match(RAW_BADGE_CLASS_RE) || []).length;
  }

  return report;
}

// ============================================================================
// Run full audit
// ============================================================================

const t0 = performance.now();

// 1. Collect ALL CSS files under frontend/src (so stray CSS outside 01-tokens.css cannot bypass G1/G2)
const tokensFile = path.join(STYLES_DIR, "01-tokens.css");
const legacyMonolith = path.join(STYLES_DIR, "05-modules.css");
const allCssFiles = walkFiles(FRONTEND_SRC, (name) => name.endsWith(".css"));

const tokensReport = fs.existsSync(tokensFile)
  ? analyzeCssFile(tokensFile, { isTokens: true })
  : null;
const allowedZTokens = tokensReport ? tokensReport.zIndexTokens : new Set();

const cssReports = [
  ...(tokensReport ? [tokensReport] : []),
  ...allCssFiles
    .filter((f) => f !== tokensFile)
    .map((f) => {
      const isModule =
        f.startsWith(MODULES_STYLES_DIR + path.sep) || f === legacyMonolith;
      return analyzeCssFile(f, { isModule, allowedZTokens });
    }),
];

// 2. Collect TSX files
const pageTsxFiles = walkFiles(PAGES_DIR, (name) => name.endsWith(".tsx"));
const componentTsxFiles = walkFiles(COMPONENTS_DIR, (name) => name.endsWith(".tsx"));
const allTsxFiles = [
  ...(fs.existsSync(APP_TSX) ? [APP_TSX] : []),
  ...pageTsxFiles,
  ...componentTsxFiles,
];
const tsxReports = allTsxFiles.map(analyzeTsxFile);

// ============================================================================
// Aggregate G1–G5 Scorecard
// ============================================================================

const nonTokenCss = cssReports.filter((r) => !r.isTokens);
const moduleCss = cssReports.filter((r) => r.isModule);

// G1: Color Token Purity
const cssRawHexTotal = nonTokenCss.reduce((s, r) => s + r.rawHex.length, 0);
const cssRawColorFnTotal = nonTokenCss.reduce((s, r) => s + r.rawColorFn.length, 0);
const cssRawColorsTotal = cssRawHexTotal + cssRawColorFnTotal;
const cssVarTotal = nonTokenCss.reduce((s, r) => s + r.varUsages, 0);
const tsxRawColorsTotal = tsxReports.reduce((s, r) => s + r.rawColors.length, 0);
const g1Violations = cssRawColorsTotal + tsxRawColorsTotal;

// G2: CSS Weight & Hygiene
const moduleCssBytes = moduleCss.reduce((s, r) => s + r.bytes, 0);
const moduleCssLines = moduleCss.reduce((s, r) => s + r.lines, 0);
const cssLongLinesTotal = cssReports.reduce((s, r) => s + r.longLines.length, 0);
const cssImportantTotal = cssReports.reduce((s, r) => s + r.importantViolations.length, 0);
const cssDisallowedBpTotal = nonTokenCss.reduce((s, r) => s + r.disallowedBreakpoints.length, 0);
const cssAllBreakpoints = new Set();
for (const r of nonTokenCss) {
  for (const bp of r.allBreakpoints) cssAllBreakpoints.add(bp);
}
const cssRawZIndexTotal = nonTokenCss.reduce((s, r) => s + r.rawZIndex.length, 0);
const zIndexTokenCount = allowedZTokens.size;
const g2Pass =
  moduleCssBytes <= THRESHOLDS.maxModuleCssBytes &&
  moduleCssLines <= THRESHOLDS.maxModuleCssLines &&
  cssLongLinesTotal === 0 &&
  cssImportantTotal === 0 &&
  cssDisallowedBpTotal === 0 &&
  cssAllBreakpoints.size <= THRESHOLDS.maxCanonicalBreakpoints &&
  cssRawZIndexTotal === 0 &&
  zIndexTokenCount > 0 &&
  zIndexTokenCount <= THRESHOLDS.maxZIndexTokens;

// G3: Inline style={{
const staticInlineTotal = tsxReports.reduce((s, r) => s + r.staticInlineStyles.length, 0);
const dynamicInlineTotal = tsxReports.reduce((s, r) => s + r.dynamicInlineStyles.length, 0);
const g3Pass =
  staticInlineTotal === 0 && dynamicInlineTotal <= THRESHOLDS.maxDynamicInlineStyles;

// G4: Raw UI Emojis + Native Dialogs
const emojiTotal = tsxReports.reduce((s, r) => s + r.emojis.length, 0);
const nativeDialogTotal = tsxReports.reduce((s, r) => s + r.nativeDialogs.length, 0);
const g4Pass = emojiTotal === 0 && nativeDialogTotal === 0;

// G5: Primitive Adoption Scorecard
const routedInShellPages = tsxReports.filter(
  (r) => r.isTopLevelPage && !THRESHOLDS.excludedPageHeaderFiles.has(r.baseName),
);
const pageHeaderCount = routedInShellPages.filter((r) => r.hasPageHeader).length;
const pageHeaderTarget = routedInShellPages.length;
const missingPageHeaderPages = routedInShellPages
  .filter((r) => !r.hasPageHeader)
  .map((r) => r.baseName);

const kpiStripFiles = tsxReports.filter((r) => r.hasKpiStrip).length;
const customKpiGridsTotal = tsxReports.reduce((s, r) => s + r.customKpiGrids, 0);

const appModalTotal = tsxReports.reduce((s, r) => s + r.appModalCount, 0);
const detailDrawerTotal = tsxReports.reduce((s, r) => s + r.detailDrawerCount, 0);
const rawModalBackdropsTotal = tsxReports.reduce((s, r) => s + r.rawModalBackdrops, 0);

const useToastFiles = tsxReports.filter((r) => r.hasUseToast && !r.isUiPrimitive).length;
const customToastsTotal = tsxReports.reduce((s, r) => s + r.customToasts, 0);

const appButtonTotal = tsxReports.reduce((s, r) => s + r.appButtonCount, 0);
const rawButtonTotal = tsxReports.reduce((s, r) => s + r.rawButtonCount, 0);
const buttonDenominator = appButtonTotal + rawButtonTotal;
const appButtonPct =
  buttonDenominator === 0 ? 100 : (appButtonTotal / buttonDenominator) * 100;

const statusBadgeTotal = tsxReports.reduce((s, r) => s + r.statusBadgeCount, 0);
const rawBadgeTotal = tsxReports.reduce((s, r) => s + r.rawBadgeCount, 0);
const badgeDenominator = statusBadgeTotal + rawBadgeTotal;
const statusBadgePct =
  badgeDenominator === 0 ? 100 : (statusBadgeTotal / badgeDenominator) * 100;

const skeletonTargetPages = routedInShellPages.filter(
  (r) => !THRESHOLDS.nonListSkeletonExemptPages.has(r.baseName),
);
const skeletonPagesCount = skeletonTargetPages.filter((r) => r.hasSkeleton).length;
const skeletonTarget = skeletonTargetPages.length;
const missingSkeletonPages = skeletonTargetPages
  .filter((r) => !r.hasSkeleton)
  .map((r) => r.baseName);
const emptyStatePagesCount = routedInShellPages.filter((r) => r.hasEmptyState).length;
const missingEmptyStatePages = routedInShellPages
  .filter((r) => !r.hasEmptyState)
  .map((r) => r.baseName);

const g5Pass =
  pageHeaderTarget >= THRESHOLDS.minRoutedInShellPages &&
  pageHeaderCount === pageHeaderTarget &&
  customKpiGridsTotal === 0 &&
  rawModalBackdropsTotal === 0 &&
  customToastsTotal === 0 &&
  appButtonPct >= THRESHOLDS.minAppButtonPct &&
  statusBadgePct >= THRESHOLDS.minStatusBadgePct &&
  skeletonPagesCount === skeletonTarget &&
  emptyStatePagesCount === pageHeaderTarget;

const allPass = g1Violations === 0 && g2Pass && g3Pass && g4Pass && g5Pass;
const elapsedMs = Math.round(performance.now() - t0);

// ============================================================================
// Output
// ============================================================================

if (isJson) {
  const payload = {
    mode: isWarn ? "warn" : "strict",
    passed: allPass,
    elapsedMs,
    gates: {
      G1: {
        passed: g1Violations === 0,
        cssRawHex: cssRawHexTotal,
        cssRawColorFn: cssRawColorFnTotal,
        cssVarUsages: cssVarTotal,
        tsxRawColors: tsxRawColorsTotal,
      },
      G2: {
        passed: g2Pass,
        moduleCssKiB: Number((moduleCssBytes / 1024).toFixed(2)),
        moduleCssLines,
        longLines: cssLongLinesTotal,
        important: cssImportantTotal,
        disallowedBreakpoints: cssDisallowedBpTotal,
        observedBreakpoints: [...cssAllBreakpoints].sort((a, b) => a - b),
        rawZIndex: cssRawZIndexTotal,
        zIndexTokens: [...allowedZTokens].sort(),
        zIndexTokenCap: THRESHOLDS.maxZIndexTokens,
      },
      G3: {
        passed: g3Pass,
        staticInlineStyles: staticInlineTotal,
        dynamicInlineStyles: dynamicInlineTotal,
        dynamicCap: THRESHOLDS.maxDynamicInlineStyles,
      },
      G4: {
        passed: g4Pass,
        uiEmojis: emojiTotal,
        nativeDialogs: nativeDialogTotal,
      },
      G5: {
        passed: g5Pass,
        pageHeader: { adopted: pageHeaderCount, target: pageHeaderTarget, missing: missingPageHeaderPages },
        kpiStripFiles,
        customKpiGrids: customKpiGridsTotal,
        appModals: appModalTotal,
        detailDrawers: detailDrawerTotal,
        rawModalBackdrops: rawModalBackdropsTotal,
        useToastFiles,
        customToasts: customToastsTotal,
        appButton: {
          adopted: appButtonTotal,
          raw: rawButtonTotal,
          pct: Number(appButtonPct.toFixed(1)),
        },
        statusBadge: {
          adopted: statusBadgeTotal,
          raw: rawBadgeTotal,
          pct: Number(statusBadgePct.toFixed(1)),
        },
        skeletonPages: { adopted: skeletonPagesCount, target: skeletonTarget, missing: missingSkeletonPages },
        emptyStatePages: { adopted: emptyStatePagesCount, target: pageHeaderTarget, missing: missingEmptyStatePages },
      },
    },
    cssFiles: nonTokenCss.map((r) => ({
      file: r.file,
      kiB: Number((r.bytes / 1024).toFixed(2)),
      lines: r.lines,
      rawColors: r.rawHex.length + r.rawColorFn.length,
      longLines: r.longLines.length,
      important: r.importantViolations.length,
      badBreakpoints: r.disallowedBreakpoints.length,
      rawZIndex: r.rawZIndex.length,
    })),
    tsxFiles: tsxReports
      .filter(
        (r) =>
          r.rawColors.length ||
          r.staticInlineStyles.length ||
          r.dynamicInlineStyles.length ||
          r.emojis.length ||
          r.nativeDialogs.length ||
          r.rawModalBackdrops ||
          r.customKpiGrids ||
          r.customToasts,
      )
      .map((r) => ({
        file: r.file,
        rawColors: r.rawColors.length,
        staticStyle: r.staticInlineStyles.length,
        dynamicStyle: r.dynamicInlineStyles.length,
        emojis: r.emojis.length,
        dialogs: r.nativeDialogs.length,
        pageHeader: r.hasPageHeader,
        kpiStrip: r.hasKpiStrip,
        customKpi: r.customKpiGrids,
        rawModals: r.rawModalBackdrops,
        customToasts: r.customToasts,
        appButtons: r.appButtonCount,
        rawButtons: r.rawButtonCount,
        statusBadges: r.statusBadgeCount,
        rawBadges: r.rawBadgeCount,
      })),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(!isWarn && !allPass ? 1 : 0);
}

// Human-readable formatted scorecard
const mark = (ok) => (ok ? "PASS" : isWarn ? "WARN" : "FAIL");
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log("================================================================================");
console.log(`INUT Design System v2 Gatekeeper (mode: ${isWarn ? "--warn" : "--strict"})  [${elapsedMs}ms]`);
console.log("================================================================================");
console.log("");
console.log("SCORECARD (G1–G5)");
console.log("--------------------------------------------------------------------------------");
console.log(
  `[${mark(g1Violations === 0)}] G1 Color Token Purity   | CSS raw colors: ${cssRawColorsTotal} (${cssRawHexTotal} hex, ${cssRawColorFnTotal} fn) | TSX raw colors: ${tsxRawColorsTotal} | CSS var(): ${cssVarTotal}`,
);
console.log(
  `[${mark(g2Pass)}] G2 CSS Weight & Hygiene | Modules: ${(moduleCssBytes / 1024).toFixed(1)} KiB / ${moduleCssLines}L (cap <=35 KiB / <=900L) | >200ch: ${cssLongLinesTotal} | !imp: ${cssImportantTotal} | bad @media: ${cssDisallowedBpTotal} | raw z-index: ${cssRawZIndexTotal} | z-tokens: ${zIndexTokenCount}/${THRESHOLDS.maxZIndexTokens}`,
);
console.log(
  `[${mark(g3Pass)}] G3 Inline style={{      | Static violations: ${staticInlineTotal} (cap 0) | Allowlisted /* ds-dynamic */: ${dynamicInlineTotal} (cap <=${THRESHOLDS.maxDynamicInlineStyles})`,
);
console.log(
  `[${mark(g4Pass)}] G4 Icons & Dialogs      | Raw UI emojis: ${emojiTotal} (cap 0) | Native alert/confirm/prompt: ${nativeDialogTotal} (cap 0)`,
);
console.log(
  `[${mark(g5Pass)}] G5 Primitive Adoption   | PageHeader: ${pageHeaderCount}/${pageHeaderTarget} | KpiStrip: ${kpiStripFiles} (custom: ${customKpiGridsTotal}) | Modal/Drawer: ${appModalTotal + detailDrawerTotal} (raw: ${rawModalBackdropsTotal}) | useToast: ${useToastFiles} (custom: ${customToastsTotal})`,
);
console.log(
  `                            | AppButton: ${appButtonTotal}/${buttonDenominator} (${appButtonPct.toFixed(1)}%, target >=95%) | StatusBadge: ${statusBadgeTotal}/${badgeDenominator} (${statusBadgePct.toFixed(1)}%, target >=95%) | Skeleton: ${skeletonPagesCount}/${skeletonTarget} | EmptyState: ${emptyStatePagesCount}/${pageHeaderTarget}`,
);

if (cssAllBreakpoints.size > 0) {
  const sortedBp = [...cssAllBreakpoints].sort((a, b) => a - b);
  const badBp = sortedBp.filter((w) => !THRESHOLDS.allowedBreakpoints.has(w));
  console.log("");
  console.log(
    `Observed @media widths (${sortedBp.length}): ${sortedBp.join(", ")}px` +
      (badBp.length ? `  [disallowed: ${badBp.join(", ")}px]` : "  [100% canonical]"),
  );
}

// Per-file CSS breakdown
console.log("");
console.log("CSS BREAKDOWN (excluding 01-tokens.css)");
console.log("--------------------------------------------------------------------------------");
console.log(
  `${pad("File", 54)} ${rpad("KiB", 6)} ${rpad("Lines", 6)} ${rpad("Colors", 7)} ${rpad(">200c", 6)} ${rpad("!imp", 5)} ${rpad("@med", 5)} ${rpad("zIdx", 5)}`,
);
for (const r of nonTokenCss) {
  const colors = r.rawHex.length + r.rawColorFn.length;
  console.log(
    `${pad(r.file, 54)} ${rpad((r.bytes / 1024).toFixed(1), 6)} ${rpad(r.lines, 6)} ${rpad(colors, 7)} ${rpad(r.longLines.length, 6)} ${rpad(r.importantViolations.length, 5)} ${rpad(r.disallowedBreakpoints.length, 5)} ${rpad(r.rawZIndex.length, 5)}`,
  );
  if (isVerbose) {
    if (r.rawHex.length) {
      console.log(
        `    hex (first 5): ${r.rawHex.slice(0, 5).map((x) => `L${x.line}:${x.value}`).join(", ")}`,
      );
    }
    if (r.rawColorFn.length) {
      console.log(
        `    fn  (first 5): ${r.rawColorFn.slice(0, 5).map((x) => `L${x.line}:${x.value}`).join(", ")}`,
      );
    }
    if (r.importantViolations.length) {
      console.log(
        `    !important: ${r.importantViolations.slice(0, 8).map((x) => `L${x.line}(${x.prop})`).join(", ")}`,
      );
    }
    if (r.rawZIndex.length) {
      console.log(
        `    raw z-index: ${r.rawZIndex.slice(0, 8).map((x) => `L${x.line}:${x.value}`).join(", ")}`,
      );
    }
  }
}

// Per-file TSX breakdown (sorted by total violation score descending)
const offendingTsx = tsxReports
  .map((r) => ({
    r,
    score:
      r.rawColors.length +
      r.staticInlineStyles.length +
      r.emojis.length +
      r.nativeDialogs.length * 5 +
      r.rawModalBackdrops * 5 +
      r.customKpiGrids * 3 +
      r.customToasts * 5,
  }))
  .filter(({ r, score }) => score > 0 || r.dynamicInlineStyles.length > 0)
  .sort((a, b) => b.score - a.score);

console.log("");
console.log(`TSX PER-FILE BREAKDOWN (${offendingTsx.length}/${tsxReports.length} files with findings)`);
console.log("--------------------------------------------------------------------------------");
console.log(
  `${pad("File", 48)} ${rpad("Col", 4)} ${rpad("Sty", 5)} ${rpad("Dyn", 4)} ${rpad("Emj", 5)} ${rpad("Dlg", 4)} ${rpad("Btn%", 5)} ${rpad("PH", 3)}`,
);
for (const { r } of offendingTsx) {
  const bTot = r.appButtonCount + r.rawButtonCount;
  const bPct = bTot === 0 ? "  -" : `${Math.round((r.appButtonCount / bTot) * 100)}%`;
  const phFlag = r.isTopLevelPage && !THRESHOLDS.excludedPageHeaderFiles.has(r.baseName)
    ? r.hasPageHeader ? "Y" : "N"
    : "-";
  console.log(
    `${pad(r.file, 48)} ${rpad(r.rawColors.length, 4)} ${rpad(r.staticInlineStyles.length, 5)} ${rpad(r.dynamicInlineStyles.length, 4)} ${rpad(r.emojis.length, 5)} ${rpad(r.nativeDialogs.length, 4)} ${rpad(bPct, 5)} ${rpad(phFlag, 3)}`,
  );
  if (isVerbose) {
    if (r.rawColors.length) {
      console.log(
        `    colors (first 5): ${r.rawColors.slice(0, 5).map((x) => `L${x.line}:${x.value}`).join(", ")}`,
      );
    }
    if (r.nativeDialogs.length) {
      console.log(
        `    dialogs: ${r.nativeDialogs.map((x) => `L${x.line}:${x.fn}()`).join(", ")}`,
      );
    }
  }
}

if (missingPageHeaderPages.length > 0) {
  console.log("");
  console.log(
    `Pages missing <PageHeader> (${missingPageHeaderPages.length}/${pageHeaderTarget}): ${missingPageHeaderPages.join(", ")}`,
  );
}
if (missingSkeletonPages.length > 0) {
  console.log(
    `Pages missing Skeleton/DataView (${missingSkeletonPages.length}/${skeletonTarget}): ${missingSkeletonPages.join(", ")}`,
  );
}
if (missingEmptyStatePages.length > 0) {
  console.log(
    `Pages missing <EmptyState> (${missingEmptyStatePages.length}/${pageHeaderTarget}): ${missingEmptyStatePages.join(", ")}`,
  );
}
if (zIndexTokenCount === 0 || zIndexTokenCount > THRESHOLDS.maxZIndexTokens) {
  console.log(
    `z-index tokens in 01-tokens.css: ${zIndexTokenCount} (cap 1..${THRESHOLDS.maxZIndexTokens}): ${[...allowedZTokens].sort().join(", ")}`,
  );
}

console.log("");
if (allPass) {
  console.log("RESULT: ALL DESIGN SYSTEM v2 GATES PASSED (G1–G5).");
  process.exit(0);
} else if (isWarn) {
  console.log("RESULT: WARNINGS PRESENT (--warn mode exits 0).");
  process.exit(0);
} else {
  console.log("RESULT: FAILED — Design System v2 violations detected (--strict exits 1).");
  process.exit(1);
}
