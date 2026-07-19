import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Rect } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  onSelect: (rect: Rect) => void;
}

// Render tung trang PDF ra canvas + cho phep keo chon o chu nhat.
// Toa do o chon duoc chuyen ve DIEM PDF bang viewport.convertToPdfPoint
// (tu dong xu ly scale va lat truc Y).
export function PdfCanvas({ url, onSelect }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.3);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [selection, setSelection] = useState<{
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
      if (cancelled) return;
      setPdf(doc);
      setNumPages(doc.numPages);
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="pdf-area">
      <div className="pdf-toolbar">
        <span>{numPages} trang</span>
        <label>
          Phóng
          <input
            type="range"
            min={0.8}
            max={2.2}
            step={0.1}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
          />
        </label>
        <span className="muted">Kéo chuột trên trang để chọn vùng đặt chữ ký</span>
      </div>
      <div className="pdf-pages">
        {pdf &&
          Array.from({ length: numPages }, (_, i) => (
            <PageCanvas
              key={i}
              pdf={pdf}
              pageIndex={i}
              scale={scale}
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
  selection,
  onDraw,
}: {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  selection: { x: number; y: number; w: number; h: number } | null;
  onDraw: (
    sel: { x: number; y: number; w: number; h: number },
    rectPdf: Rect,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<pdfjsLib.PageViewport | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvasContext: ctx, viewport });
      await task.promise.catch(() => {});
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex, scale]);

  function pos(e: React.MouseEvent) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    dragStart.current = pos(e);
    setLive(null);
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragStart.current) return;
    const p = pos(e);
    const s = dragStart.current;
    setLive({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }
  function onMouseUp(e: React.MouseEvent) {
    if (!dragStart.current || !viewportRef.current) return;
    const p = pos(e);
    const s = dragStart.current;
    dragStart.current = null;
    const box = {
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    };
    if (box.w < 8 || box.h < 8) {
      setLive(null);
      return;
    }
    const vp = viewportRef.current;
    // Hai goc doi dien (pixel canvas) -> diem PDF.
    const [px1, py1] = vp.convertToPdfPoint(box.x, box.y);
    const [px2, py2] = vp.convertToPdfPoint(box.x + box.w, box.y + box.h);
    onDraw(box, {
      page: pageIndex,
      x1: px1,
      y1: py1,
      x2: px2,
      y2: py2,
    });
    setLive(box);
  }

  const shown = selection ?? live;

  return (
    <div className="page-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div
        className="overlay"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {shown && (
          <div
            className="sel-rect"
            style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
          />
        )}
      </div>
    </div>
  );
}
