import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Trinh xem PDF chi doc (render tat ca trang ra canvas).
export function PdfView({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    (async () => {
      const doc = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
      if (cancelled) return;
      setNumPages(doc.numPages);
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "pdfview-page";
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, scale]);

  return (
    <div className="pdfview">
      <div className="pdfview-toolbar">
        <span className="muted">{numPages} trang</span>
        <label>
          Phóng
          <input
            type="range"
            min={0.7}
            max={2}
            step={0.1}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
          />
        </label>
      </div>
      <div className="pdfview-pages" ref={containerRef} />
    </div>
  );
}
