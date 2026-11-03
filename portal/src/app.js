// The portal's Express app: JSON API under /api, the built React app (public/) for everything else.
// SiteGround puts a proxy in front, so the client address comes from X-Forwarded-For (trust proxy 1).
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORTAL_DIR } from './lib/config.js';
import { HttpError } from './lib/errors.js';
import { loadSession, parseCookies, COOKIE } from './lib/sessions.js';
import { authRoutes } from './routes/auth.js';
import { dealerRoutes } from './routes/dealers.js';
import { workerRoutes } from './routes/worker.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { orderRoutes, staffRoutes } from './routes/orders.js';
import { clientFetch } from '../../shared/website.js';

const PHOTO_UPLOAD = /^\/dealers\/\d+\/uploads(\/\d+\/thumb)?$/;

// fetchFn: outgoing API requests (VIN lookup); siteFetch: dealer website pages (shared/website.js, public https only).
// Tests pass fakes for both, so nothing outside is called.
export function createApp({ pool, config, publicDir = join(PORTAL_DIR, 'public'), fetchFn = fetch, siteFetch = clientFetch }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // The static customer site on another address (CORS_ORIGINS) may call the API with its cookie; nobody else may.
  const allowed = new Set(config.corsOrigins ?? []);
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin) || req.path.startsWith('/worker')) return next();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  });

  // Worker API first: it reads its own raw body and has no browser session.
  app.use('/api/worker', workerRoutes({ pool, config }));

  app.use('/api', express.json({ limit: '100kb' }), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    req.cookies = parseCookies(req.headers.cookie);
    req.session = await loadSession(pool, req.cookies[COOKIE]);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // JSON only (an HTML form on another site cannot send it; photo uploads are JPEG), and the session's CSRF token on
      // every change.
      if (!req.is('application/json') && !(req.is('image/jpeg') && PHOTO_UPLOAD.test(req.path))) throw new HttpError(415, 'Send JSON.');
      if (req.path !== '/auth/login' && req.session && req.get('x-csrf-token') !== req.session.csrf) {
        throw new HttpError(403, 'Your session changed. Reload the page and try again.');
      }
    }
    next();
  });
  app.use('/api/auth', authRoutes({ pool, config }));
  app.use('/api/dealers', dealerRoutes({ pool }));
  app.use('/api/dealers', vehicleRoutes({ pool, config, fetchFn, siteFetch }));
  app.use('/api/dealers', orderRoutes({ pool, config }));
  app.use('/api/staff', staffRoutes({ pool }));
  app.use('/api', (req) => { throw new HttpError(404, `No such API route: ${req.method} ${req.path}`); });

  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: 'index.html' }));
    // React handles its own pages: unknown GET paths get the app shell.
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(join(publicDir, 'index.html')) : next()));
  }

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
