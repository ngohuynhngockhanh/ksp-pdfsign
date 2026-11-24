import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api toi backend FastAPI (cong 8000).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return "vendor-lucide";
          }
          if (
            /[\\/]node_modules[\\/]pdfjs-dist[\\/]/.test(id) &&
            !id.includes("pdf.worker")
          ) {
            return "vendor-pdf";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
