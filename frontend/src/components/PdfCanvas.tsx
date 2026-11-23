import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Rect } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  onSelect: (rect: Rect) => void;
}

type InteractionMode = "draw" | "scroll";

interface SelectionBox {
  page: number;
  // Normalized 0..1 coordinates relative to rendered page viewport so zoom/resize preserves visual box
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

// Render từng trang PDF ra canvas + cho phép kéo chọn ô chữ nhật bằng chuột HOẶC cảm ứng (Pointer Events).
// Tọa độ ô chọn được chuyển về ĐIỂM PDF bằng viewport.convertToPdfPoint
// (tự động xử lý scale, CSS fit-width ratio và lật trục Y).
export function PdfCanvas({ url, onSelect }: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [fitScale, setFitScale] = useState(1.2);
  const [userZoomed, setUserZoomed] = useState(false);
  const [mode, setMode] = useState<InteractionMode>("draw");
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page1WidthPt, setPage1WidthPt] = useState<number>(595);
  const [selection, setSelection] = useState<SelectionBox | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSelection(null);
    setUserZoomed(false);
    (async () => {
      const doc = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
      if (cancelled) return;
      setPdf(doc);
      setNumPages(doc.numPages);
      try {
        const p1 = await doc.getPage(1);
        if (!cancelled) {
          const vp1 = p1.getViewport({ scale: 1 });
          if (vp1.width > 0) setPage1WidthPt(vp1.width);
        }
      } catch {
        /* fallback 595pt A4 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Measure container width via ResizeObserver to auto-fit PDF on narrow viewports (UI-MOB-02)
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const recompute = () => {
      const avail = Math.max(260, el.clientWidth - 24);
      const computed = Math.min(1.4, Math.max(0.45, Number((avail / page1WidthPt).toFixed(2))));
      setFitScale(computed);
      if (!userZoomed) {
        setScale(avail < 760 ? computed : Math.min(1.3, computed));
      }
    };
    recompute();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(recompute);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [page1WidthPt, userZoomed]);

  // 1-tap preset signature box on page 1 (or last page if multi-page) for effortless mobile signing
  const placePresetBox = useCallback(async () => {
    if (!pdf || numPages <= 0) return;
    const targetIndex = numPages - 1;
    const page = await pdf.getPage(targetIndex + 1);
    const vp = page.getViewport({ scale: 1 });
    const boxW = Math.min(200, vp.width * 0.36);
    const boxH = Math.min(82, vp.height * 0.12);
    const x = Math.max(24, vp.width - boxW - 42);
    const y = Math.max(24, vp.height - boxH - 64);
    const [px1, py1] = vp.convertToPdfPoint(x, y);
    const [px2, py2] = vp.convertToPdfPoint(x + boxW, y + boxH);
    setSelection({
      page: targetIndex,
      nx: x / vp.width,
      ny: y / vp.height,
      nw: boxW / vp.width,
      nh: boxH / vp.height,
    });
    onSelect({
      page: targetIndex,
      x1: px1,
      y1: py1,
      x2: px2,
      y2: py2,
    });
  }, [pdf, numPages, onSelect]);

  return (
    <div className="pdf-area" ref={areaRef}>
      <div className="pdf-toolbar">
        <strong>{numPages} trang</strong>
        <div className="pdf-mode-group" role="group" aria-label="Chế độ tương tác PDF">
          <button
            type="button"
            className={`pdf-mode-btn${mode === "draw" ? " is-active" : ""}`}
            aria-pressed={mode === "draw"}
            onClick={() => setMode("draw")}
          >
            Vẽ vùng ký
          </button>
          <button
            type="button"
            className={`pdf-mode-btn${mode === "scroll" ? " is-active" : ""}`}
            aria-pressed={mode === "scroll"}
            onClick={() => setMode("scroll")}
          >
            Cuộn trang
          </button>
          <button
            type="button"
            className="pdf-mode-btn"
            disabled={!pdf}
            onClick={placePresetBox}
            title="Đặt nhanh ô chữ ký chuẩn ở góc dưới phải trang cuối"
          >
            Đặt khung mẫu
          </button>
        </div>
        <label>
          Phóng ({Math.round(scale * 100)}%)
          <input
            type="range"
            min={0.45}
            max={2.2}
            step={0.05}
            value={scale}
            onChange={(e) => {
              setUserZoomed(true);
              setScale(parseFloat(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          className="btn-sm"
          onClick={() => {
            setUserZoomed(false);
            setScale(fitScale);
          }}
        >
          Vừa khung
        </button>
        <span className="muted">
          {mode === "draw"
            ? "Kéo chuột hoặc chạm kéo trên trang để vẽ khung chữ ký"
            : "Đang ở chế độ cuộn — chuyển sang 'Vẽ vùng ký' để chọn ô ký"}
        </span>
      </div>
      <div className="pdf-pages">
        {pdf &&
          Array.from({ length: numPages }, (_, i) => (
            <PageCanvas
              key={i}
              pdf={pdf}
              pageIndex={i}
              scale={scale}
              mode={mode}
              selection={selection && selection.page === i ? selection : null}
              onDraw={(sel, rectPdf) => {
                setSelection({ page: i, ...sel });
                onSelect(rectPdf);
              }}
            />
          ))}
      </div>
    </div>
  );
}

function PageCanvas({
  pdf,
  pageIndex,
  scale,
  mode,
  selection,
  onDraw,
}: {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  mode: InteractionMode;
  selection: { nx: number; ny: number; nw: number; nh: number } | null;
  onDraw: (
    sel: { nx: number; ny: number; nw: number; nh: number },
    rectPdf: Rect,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<pdfjsLib.PageViewport | null>(null);
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [live, setLive] = useState<{ nx: number; ny: number; nw: number; nh: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport });
      await renderTask.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [pdf, pageIndex, scale]);

  function localPos(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y, width: rect.width, height: rect.height };
  }

  function finishDrag(clientX: number, clientY: number, el: HTMLDivElement) {
    if (!dragStart.current || !viewportRef.current) return;
    const s = dragStart.current;
    dragStart.current = null;
    try {
      if (el.hasPointerCapture(s.pointerId)) {
        el.releasePointerCapture(s.pointerId);
      }
    } catch {
      /* ignore */
    }

    const p = localPos(clientX, clientY);
    const x = Math.min(s.x, p.x);
    const y = Math.min(s.y, p.y);
    const w = Math.abs(p.x - s.x);
    const h = Math.abs(p.y - s.y);
    if (w < 8 || h < 8 || p.width <= 0 || p.height <= 0) {
      setLive(null);
      return;
    }

    const vp = viewportRef.current;
    // Scale from displayed CSS pixels to pdf.js viewport pixels (exact even when max-width:100% shrinks canvas)
    const sx = vp.width / p.width;
    const sy = vp.height / p.height;
    const [px1, py1] = vp.convertToPdfPoint(x * sx, y * sy);
    const [px2, py2] = vp.convertToPdfPoint((x + w) * sx, (y + h) * sy);

    const norm = {
      nx: x / p.width,
      ny: y / p.height,
      nw: w / p.width,
      nh: h / p.height,
    };
    setLive(null);
    onDraw(norm, {
      page: pageIndex,
      x1: px1,
      y1: py1,
      x2: px2,
      y2: py2,
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (mode !== "draw") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic Playwright PointerEvents may not support capture */
    }
    const p = localPos(e.clientX, e.clientY);
    dragStart.current = { x: p.x, y: p.y, pointerId: e.pointerId };
    setLive(null);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (mode !== "draw" || !dragStart.current) return;
    if (dragStart.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const p = localPos(e.clientX, e.clientY);
    if (p.width <= 0 || p.height <= 0) return;
    const s = dragStart.current;
    setLive({
      nx: Math.min(s.x, p.x) / p.width,
      ny: Math.min(s.y, p.y) / p.height,
      nw: Math.abs(p.x - s.x) / p.width,
      nh: Math.abs(p.y - s.y) / p.height,
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    finishDrag(e.clientX, e.clientY, e.currentTarget);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    dragStart.current = null;
    setLive(null);
  }

  const shown = live ?? selection;

  return (
    <div className="page-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div
        className={`overlay ${mode === "draw" ? "pdf-overlay-draw" : "pdf-overlay-scroll"}`}
        data-testid={`pdf-overlay-page-${pageIndex}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {shown && (
          <div
            className="sel-rect"
            style={{
              left: `${shown.nx * 100}%`,
              top: `${shown.ny * 100}%`,
              width: `${shown.nw * 100}%`,
              height: `${shown.nh * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
