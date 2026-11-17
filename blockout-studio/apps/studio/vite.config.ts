import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// BLOCKOUT_HTTPS=1 serves over HTTPS with a self-signed cert (iOS only exposes motion sensors to secure pages).
const https = process.env.BLOCKOUT_HTTPS === '1';
const require = createRequire(import.meta.url);
/** Serve MediaPipe's WASM from the installed package at /mediapipe/wasm (dev) and copy it into the build, so mocap needs no CDN. */
function mediapipeWasm(): Plugin {
  const dir = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
  return {
    name: 'blockout-mediapipe-wasm',
    configureServer(server) { server.middlewares.use('/mediapipe/wasm', (req, res, next) => { const f = join(dir, (req.url ?? '').split('?')[0].replace(/^\/+/, '')); if (!f.startsWith(dir) || !existsSync(f)) return next(); res.setHeader('content-type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); createReadStream(f).pipe(res); }); },
    writeBundle(o) { const out = join(o.dir ?? 'dist', 'mediapipe/wasm'); mkdirSync(out, { recursive: true }); for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(out, f)); },
  };
}
export default defineConfig({
  plugins: [react(), mediapipeWasm(), ...(https ? [basicSsl()] : [])],
  server: { port: 5173, strictPort: false, proxy: { '/bridge': { target: 'http://127.0.0.1:8787', ws: true, rewrite: (p) => p.replace(/^\/bridge/, '') } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@blockout/core', '@blockout/render', '@blockout/prompting', '@blockout/pipeline'] },
});
