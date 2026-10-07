import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development (`npm run dev`) the page comes from Vite and /api goes to the
// local server, with this run's secret added by the proxy (the browser never sees it).
const devToken = process.env.CLMUSIC_DEV_TOKEN;
const devPort = process.env.CLMUSIC_DEV_PORT || '5174';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: devToken ? {
      '/api': { target: `http://127.0.0.1:${devPort}`, changeOrigin: true, headers: { 'X-CLMusic-Token': devToken } },
    } : undefined,
  },
  test: {
    environment: 'jsdom',
    include: ['test/ui/**/*.test.{js,jsx}'],
    setupFiles: ['test/ui/setup.js'],
    restoreMocks: true,
  },
});
