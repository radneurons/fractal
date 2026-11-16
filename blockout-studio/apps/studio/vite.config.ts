import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false, proxy: { '/bridge': { target: 'http://127.0.0.1:8787', ws: true, rewrite: (p) => p.replace(/^\/bridge/, '') } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@blockout/core', '@blockout/render', '@blockout/prompting', '@blockout/pipeline'] },
});
