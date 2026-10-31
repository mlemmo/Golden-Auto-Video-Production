// Builds the portal's React app into ../public (served by the portal's Express app). `npm run dev` serves it with
// live reload and forwards /api to a portal running on localhost:3000 (cd portal && npm start).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, assetsDir: 'static' },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
