import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Üretim derlemesinde sıkı CSP: yalnızca kendi dosyalarımız ve yerel servis.
const csp: Plugin = {
  name: "floem-csp",
  apply: "build",
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "frame-src 'self' blob:",
      "connect-src http://127.0.0.1:*",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), csp],
  server: { port: 5199, strictPort: false },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
