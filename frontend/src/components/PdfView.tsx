import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AppButton, InlineAlert, SkeletonBlock, StatusBadge } from "./ui";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.45;
const MAX_SCALE = 2.2;
const SCALE_STEP = 0.1;

// Trình xem PDF chỉ đọc (render tất cả trang ra canvas, tự vừa khung mobile & sắc nét DPR).
export function PdfView({ url }: { url: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.1);
  const [fitScale, setFitScale] = useState(1.1);
  const [userZoomed, setUserZoomed] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [page1WidthPt, setPage1WidthPt] = useState(595);

  useEffect(() => {
    setUserZoomed(false);
  }, [url]);

  // Fit-width auto scaling via ResizeObserver (UI-MOB-02)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const recompute = () => {
      const avail = Math.max(260, el.clientWidth - 24);
      const computed = Math.min(1.35, Math.max(MIN_SCALE, Number((avail / page1WidthPt).toFixed(2))));
      setFitScale(computed);
      if (!userZoomed) {
        setScale(avail < 760 ? computed : Math.min(1.2, computed));
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

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    setLoading(true);
    setLoadErr("");

    (async () => {
      try {
        const doc = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) return;
        setNumPages(doc.numPages);
        setLoading(false);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          if (i === 1) {
            const vp1 = page.getViewport({ scale: 1 });
            if (vp1.width > 0) setPage1WidthPt(vp1.width);
          }
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.className = "pdfview-page";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise.catch(() => {});
        }
      } catch (ex) {
        if (!cancelled) {
          setNumPages(0);
          setLoadErr((ex as Error).message || "Không thể hiển thị bản xem trước PDF.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, scale]);

  const adjustScale = (delta: number) => {
    setUserZoomed(true);
    setScale((prev) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((prev + delta).toFixed(2)))),
    );
  };

  return (
    <div className="ui-pdf-stage" ref={rootRef}>
      <div className="ui-viewer-toolbar">
        <StatusBadge tone="neutral" icon="file-text" size="sm" className="num">
          {numPages} trang
        </StatusBadge>

        <div className="ui-pdf-zoom">
          <AppButton
            size="sm"
            variant="ghost"
            iconOnly
            leftIcon="zoom-out"
            aria-label="Thu nhỏ"
            disabled={scale <= MIN_SCALE}
            onClick={() => adjustScale(-SCALE_STEP)}
          />
          <label className="ui-pdf-zoom-label">
            <span className="ui-pdf-zoom-pct num">{Math.round(scale * 100)}%</span>
            <input
              type="range"
              aria-label="Tỷ lệ thu phóng PDF"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.05}
              value={scale}
              onChange={(e) => {
                setUserZoomed(true);
                setScale(parseFloat(e.target.value));
              }}
            />
          </label>
          <AppButton
            size="sm"
            variant="ghost"
            iconOnly
            leftIcon="zoom-in"
            aria-label="Phóng to"
            disabled={scale >= MAX_SCALE}
            onClick={() => adjustScale(SCALE_STEP)}
          />
          <AppButton
            size="sm"
            variant="secondary"
            leftIcon="maximize"
            onClick={() => {
              setUserZoomed(false);
              setScale(fitScale);
            }}
          >
            Vừa khung
          </AppButton>
        </div>
      </div>

      {loadErr && (
        <InlineAlert tone="warning" title="Không thể hiển thị bản xem trước PDF">
          {loadErr}
        </InlineAlert>
      )}

      {loading && !loadErr && (
        <div className="ui-row-center ui-pad-3" role="status" aria-busy="true" aria-label="Đang tải bản xem trước PDF">
          <SkeletonBlock variant="rect" className="ui-pdf-skeleton" />
        </div>
      )}

      <div className="ui-pdf-pages" ref={containerRef} />
    </div>
  );
}
