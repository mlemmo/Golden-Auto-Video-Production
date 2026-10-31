// Test helpers: a wiped and migrated test database (TEST_DATABASE_URL; tests that need it are skipped without it),
// the app on a random local port, and a tiny browser (cookie + CSRF) for the JSON API.
import { loadEnvFile, loadConfig } from '../src/lib/config.js';
import { createPool } from '../src/lib/db.js';
import { resetDatabase } from '../src/lib/migrate.js';
import { createApp } from '../src/app.js';

loadEnvFile();
export const TEST_DB = process.env.TEST_DATABASE_URL || '';
export const NO_DB = TEST_DB ? false : 'TEST_DATABASE_URL is not set';
export const WORKER_ID = 'test-worker';
export const WORKER_SECRET = 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz';

export async function freshDb() {
  await resetDatabase(TEST_DB);
  return createPool(TEST_DB);
}

export async function startApp(pool, env = {}) {
  const config = loadConfig({ APP_URL: 'http://localhost', WORKER_SHARED_SECRETS: `${WORKER_ID}:${WORKER_SECRET}`, ...env });
  const server = createApp({ pool, config, publicDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, config, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function browser(base) {
  let cookie = '', csrf = '';
  async function call(method, path, body, { sendCsrf = true } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(sendCsrf && csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.status === 204 ? null : await res.json();
    if (data?.csrf) csrf = data.csrf;
    return { status: res.status, data };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, o) => call('POST', p, b, o),
    patch: (p, b = {}) => call('PATCH', p, b),
    del: (p) => call('DELETE', p, {}),
    login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  };
}
