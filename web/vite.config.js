// Builds the dashboard into ../public/app (served by the Node service at /app/). `npm run dev` serves it with live
// reload and forwards actions, the sign-in page and static files to a Node service on localhost:4350
// (cd node && npm run dev); sign in there first, then open the dev page.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const node = 'http://127.0.0.1:4350';
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: { outDir: '../public/app', emptyOutDir: true, assetsDir: 'static' },
  server: { proxy: { '/api': node, '/style.css': node, '/assets': node } },
});
