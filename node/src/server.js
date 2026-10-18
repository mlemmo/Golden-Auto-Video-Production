// Golden Auto Node service: the whole dashboard of the node test site — the sign-in and dashboard pages (same
// templates as PHP), sessions, and every action with the same JSON in and out as PHP's ?api=<action>. Actions answer
// at POST /api/node/<action> and, like PHP, at POST /?api=<action>. Nginx serves static files (style, scripts,
// assets) and sends the rest here (ubuntu/node/nginx-golden-auto-node.conf). No npm dependencies.
// While a browser still holds a PHP session (before the Nginx switch), /api/node/ calls are signed in through PHP
// (src/lib/auth.js, public/node_auth.php) as before.
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkAuth, HttpError } from './lib/auth.js';
import { loadConfig } from './lib/config.js';
import { openDb } from './lib/db.js';
import { clientRoutes } from './routes/clients.js';
import { narrationRoutes } from './routes/narrations.js';
import { jobRoutes, MULTIPART } from './routes/jobs.js';
import { finishingRoutes } from './routes/finishing.js';
import { parseMultipart } from './lib/multipart.js';
import { CLIENT_DEFAULT, clientsLoad, clientFind, clientDetails } from './lib/clients.js';
import { withSpeechSites } from './lib/speech.js';
import { sessionStore, newSessionId, newCsrf, sameSecret, parseCookies, sessionCookie, clearedCookie, COOKIE } from './lib/session.js';
import { loginPage, dashboardPage, passwordVerify } from './lib/pages.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);
const MAX_BODY = 1 << 20;
const MAX_UPLOAD = 72 * 1024 * 1024;  // Nginx client_max_body_size and PHP post_max_size

// Session actions (index.php handles these itself).
const sessionRoutes = {
  client_select: ({ db, body, session }) => { clientFind(db, String(body.id ?? '')); session.data.client = String(body.id); return { message: 'Client selected.' }; },
  logout: ({ session }) => { session.destroyed = true; return {}; },
};

// action → handler(ctx), ctx = { cfg, db, client, dealer, body, files, req, session }. A plain Error is a user-facing
// message (HTTP 400, like PHP's RuntimeException); HttpError carries its own status; anything else is a logged 500.
export const actions = { ...clientRoutes, ...narrationRoutes, ...jobRoutes, ...finishingRoutes, ...sessionRoutes };

const SECURITY = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY, ...headers });
  res.end(JSON.stringify(body));
}
function sendText(res, status, text, type = 'text/html; charset=UTF-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY, ...headers });
  res.end(text);
}
async function readBody(req, max) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Request is too large.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const text = (await readBody(req, MAX_BODY)).toString('utf8');
  if (text === '') return {};
  let v;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid request.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Invalid request.');
  return v;
}
const userError = (e) => e instanceof Error && e.constructor === Error;

/** Behind Nginx (X-Forwarded-Proto https) or a direct local connection (tests, development). */
function connection(req) {
  const proto = req.headers['x-forwarded-proto'];
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  return { https: proto === 'https', allowed: proto === 'https' || (proto === undefined && local) };
}

/** The browser's session (created on first visit, as session_start does). */
function openSession(cfg, req) {
  const store = sessionStore(String(cfg.data_dir) + '/node-sessions.sqlite');
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  const data = store.load(sid);
  const session = data ? { id: sid, data, fresh: false } : { id: newSessionId(), data: {}, fresh: true };
  session.data.csrf ??= newCsrf();
  return { store, session };
}
function closeSession(store, session, https) {
  if (session.destroyed) { store.destroy(session.id); return { 'Set-Cookie': clearedCookie(https) }; }
  store.save(session.id, session.data);
  return session.fresh ? { 'Set-Cookie': sessionCookie(session.id, https) } : {};
}
function currentClient(db, data) {
  const client = String(data.client ?? CLIENT_DEFAULT);
  return clientsLoad(db).items.some((c) => c.id === client) ? client : CLIENT_DEFAULT;
}

async function runAction(name, req, res, cfg, store, session, https) {
  const handler = Object.hasOwn(actions, name) ? actions[name] : null;
  if (!handler) return send(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required.' });
  let uploadDir = null;
  try {
    const db = openDb(cfg);
    let client;
    if (session.data.auth) {
      if (!sameSecret(session.data.csrf, req.headers['x-csrf-token'] ?? '')) throw new HttpError(403, 'Invalid request.');
      client = currentClient(db, session.data);
    } else if (parseCookies(req.headers.cookie).PHPSESSID && req.url.startsWith('/api/node/') && !Object.hasOwn(sessionRoutes, name)) {
      // A page still served by PHP: its session decides (until Nginx sends the whole site here).
      ({ client } = await checkAuth(req, process.env.NODE_AUTH_URL ?? String(cfg.public_base_url).replace(/\/$/, '') + '/node_auth.php'));
    } else throw new HttpError(401, 'Sign in again.');
    let body, files = {};
    if (MULTIPART.has(name)) {
      uploadDir = mkdtempSync(tmpdir() + '/ga-upload-');
      ({ fields: body, files } = parseMultipart(await readBody(req, MAX_UPLOAD), req.headers['content-type'], uploadDir));
    } else body = await readJson(req);
    // Dealer named in scripts and speech for this client; its website is said as written in its details.
    const dealer = clientDetails(clientFind(db, client));
    const sites = client !== CLIENT_DEFAULT ? { [dealer.website]: dealer.website_spoken } : {};
    const out = await withSpeechSites(sites, () => handler({ cfg, db, client, dealer, body, files, req, session }));
    send(res, 200, out, closeSession(store, session, https));
  } catch (e) {
    const headers = closeSession(store, session, https);
    if (e instanceof HttpError) return send(res, e.status, { error: e.message }, headers);
    if (userError(e)) return send(res, 400, { error: e.message }, headers);
    console.error(e);
    send(res, 500, { error: 'Internal error' }, headers);
  } finally {
    if (uploadDir) rmSync(uploadDir, { recursive: true, force: true });
  }
}

/** GET or POST / : the sign-in page (and its form) or the dashboard. */
async function page(req, res, cfg, store, session, https) {
  let error = '';
  if (req.method === 'POST') {
    const form = new URLSearchParams((await readBody(req, MAX_BODY)).toString('utf8'));
    if (form.has('password')) {
      if (!sameSecret(session.data.csrf, form.get('csrf') ?? '')) { closeSession(store, session, https); return sendText(res, 403, 'Invalid request.'); }
      const now = Date.now() / 1000;
      session.data.attempts = (session.data.attempts ?? []).filter((t) => t > now - 300);
      if (session.data.attempts.length >= 5) error = 'Too many attempts. Wait five minutes.';
      else if (await passwordVerify(form.get('password'), cfg.password_hash)) {
        // A new session id on sign-in (session_regenerate_id).
        store.destroy(session.id); session.id = newSessionId(); session.fresh = true;
        session.data.auth = true; session.data.attempts = [];
      } else { session.data.attempts.push(now); error = 'Incorrect password.'; }
    }
  }
  const headers = closeSession(store, session, https);
  if (!session.data.auth) return sendText(res, 200, loginPage(cfg, session.data.csrf, error), undefined, headers);
  sendText(res, 200, dashboardPage(cfg, session.data.csrf, Object.keys(actions)), undefined, headers);
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/node/health') return send(res, 200, { ok: true, service: pkg.name, version: pkg.version, node: process.version });
  const api = url.pathname.match(/^\/api\/node\/([a-z_]+)$/)?.[1] ?? (['/', '/index.php'].includes(url.pathname) && url.searchParams.has('api') ? url.searchParams.get('api') : null);
  const isPage = api === null && ['/', '/index.php'].includes(url.pathname) && ['GET', 'POST'].includes(req.method);
  if ((api === null && !isPage) || (api !== null && !Object.hasOwn(actions, api))) return send(res, 404, { error: 'Not found' });
  try {
    const { https, allowed } = connection(req);
    if (!allowed) return sendText(res, 403, 'Use HTTPS to access this dashboard.', 'text/plain; charset=UTF-8');
    const cfg = loadConfig();
    if (!cfg.password_hash) return sendText(res, 503, 'Set the private dashboard password hash before use.', 'text/plain; charset=UTF-8');
    const { store, session } = openSession(cfg, req);
    if (api !== null) return await runAction(api, req, res, cfg, store, session, https);
    await page(req, res, cfg, store, session, https);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Internal error' });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => console.log(`golden-auto-node listening on http://${HOST}:${PORT}`));
}
