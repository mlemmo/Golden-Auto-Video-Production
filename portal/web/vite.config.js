// Builds the portal's React app into ../public (served as static files on the pages address). `npm run dev` serves it with
// live reload and forwards /api to the studio's server on localhost:4350 (cd node && npm start), which serves the
// portal API (node/src/portal).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, assetsDir: 'static' },
  server: { proxy: { '/api': 'http://127.0.0.1:4350' } },
});
