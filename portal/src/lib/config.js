// Settings from the environment (.env next to package.json on SiteGround; see .env.example).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkerSecrets } from './hmac.js';

export const PORTAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Loads portal/.env when present; variables already set in the environment win. */
export function loadEnvFile(path = join(PORTAL_DIR, '.env')) {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env = process.env) {
  const appUrl = env.APP_URL || 'http://localhost:3000';
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || undefined,
    appUrl,
    databaseUrl: env.DATABASE_URL || '',
    workerSecrets: parseWorkerSecrets(env.WORKER_SHARED_SECRETS || ''),
    // The static customer site's addresses (e.g. https://lotspotlight.com), allowed to call this API from the browser.
    // They must share the API's registrable domain (lotspotlight.com and api.lotspotlight.com) so the sign-in cookie,
    // SameSite=Lax, goes with their requests. Empty: the pages are served by this app itself (one address).
    corsOrigins: String(env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    // Customers' uploaded car photos (full size until our server has copied them, then thumbnails only).
    uploadDir: env.UPLOAD_DIR || join(PORTAL_DIR, 'uploads'),
    secureCookies: appUrl.startsWith('https://'),
  };
}
