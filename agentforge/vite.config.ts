import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          flow: ['@xyflow/react'],
          editor: ['@uiw/react-codemirror', '@codemirror/lang-javascript'],
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
