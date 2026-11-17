import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Geliştirmede /api istekleri yerel floembi.app sunucusuna (python -m floem_bi.server) gider.
export default defineConfig({
  plugins: [react()],
  server: { port: 5299, proxy: { "/api": "http://127.0.0.1:8800" } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
