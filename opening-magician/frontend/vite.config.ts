import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies the native bridge; the production build is served by the bridge itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600, sourcemap: false },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
