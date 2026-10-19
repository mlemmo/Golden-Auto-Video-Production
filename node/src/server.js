// Golden Auto Node service: the whole dashboard — the sign-in page, the React dashboard (web/, built into
// public/app/), sessions, and every action as JSON at POST /api/node/<action>. Static files (style.css, the React build, uploaded and generated assets) are served here too; behind
// Nginx, Nginx serves most of them straight from disk.
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, statSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { HttpError } from './lib/auth.js';
import { loadConfig, ROOT } from './lib/config.js';
import { openDb } from './lib/db.js';
import { clientRoutes } from './routes/clients.js';
import { narrationRoutes } from './routes/narrations.js';
import { jobRoutes, MULTIPART } from './routes/jobs.js';
import { finishingRoutes } from './routes/finishing.js';
import { parseMultipart } from './lib/multipart.js';
import { CLIENT_DEFAULT, clientsLoad, clientFind, clientDetails, clientSpeechSites } from './lib/clients.js';
import { withSpeechSites } from './lib/speech.js';
import { sessionStore, newSessionId, newCsrf, sameSecret, parseCookies, sessionCookie, clearedCookie, COOKIE } from './lib/session.js';
import { loginPage, dashboardPage, passwordVerify } from './lib/pages.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);
const MAX_BODY = 1 << 20;
const MAX_UPLOAD = 72 * 1024 * 1024;  // same as Nginx client_max_body_size

// Session actions.
const sessionRoutes = {
  client_select: ({ db, body, session }) => { clientFind(db, String(body.id ?? '')); session.data.client = String(body.id); return { message: 'Client selected.' }; },
  logout: ({ session }) => { session.destroyed = true; return {}; },
};

// action → handler(ctx), ctx = { cfg, db, client, dealer, body, files, req, session }. A plain Error is a user-facing
// message (HTTP 400); HttpError carries its own status; anything else is a logged 500.
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
    if (!session.data.auth) throw new HttpError(401, 'Sign in again.');
    if (!sameSecret(session.data.csrf, req.headers['x-csrf-token'] ?? '')) throw new HttpError(403, 'Invalid request.');
    client = currentClient(db, session.data);
    let body, files = {};
    if (MULTIPART.has(name)) {
      uploadDir = mkdtempSync(tmpdir() + '/ga-upload-');
      ({ fields: body, files } = parseMultipart(await readBody(req, MAX_UPLOAD), req.headers['content-type'], uploadDir));
    } else body = await readJson(req);
    // Dealer named in scripts and speech for this client; its website is said as written in its details.
    const dealer = clientDetails(clientFind(db, client));
    const sites = clientSpeechSites(client, dealer);
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
  // After a successful sign-in, redirect to a plain GET of the page (Post/Redirect/Get), so reloading the
  // dashboard never asks the browser to resend the sign-in form.
  if (req.method === 'POST' && session.data.auth) {
    res.writeHead(303, { ...SECURITY, ...headers, Location: new URL(req.url, 'http://localhost').pathname });
    return res.end();
  }
  if (!session.data.auth) return sendText(res, 200, loginPage(cfg, session.data.csrf, error), undefined, headers);
  const html = dashboardPage(cfg, session.data.csrf, process.env.GOLDEN_ROOT ?? ROOT);
  if (html === null) return sendText(res, 503, 'The dashboard front end is not built yet: run npm run build in web/.', 'text/plain; charset=UTF-8', headers);
  sendText(res, 200, html, undefined, headers);
}

// Static files from public/: the stylesheet, the React build (public/app/; hashed file names under app/static/ never
// change, so they are cached for a year) and uploaded or generated assets. Never dotfiles.
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff2': 'font/woff2' };
function staticFile(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (!(pathname === '/style.css' || pathname.startsWith('/app/static/') || pathname.startsWith('/assets/'))) return false;
  const base = resolve((process.env.GOLDEN_ROOT ?? ROOT) + '/public');
  let file;
  try { file = resolve(base, '.' + decodeURIComponent(pathname)); } catch { return send(res, 400, { error: 'Bad path' }), true; }
  const type = TYPES[extname(file).toLowerCase()];
  let st = null;
  try { st = statSync(file); } catch { /* missing */ }
  if (!file.startsWith(base + sep) || file.includes(sep + '.') || !type || !st?.isFile()) return send(res, 404, { error: 'Not found' }), true;
  const cache = pathname.startsWith('/app/static/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(file).pipe(res);
  return true;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (staticFile(req, res, url.pathname)) return;
  if (req.method === 'GET' && url.pathname === '/api/node/health') return send(res, 200, { ok: true, service: pkg.name, version: pkg.version, node: process.version });
  const api = url.pathname.match(/^\/api\/node\/([a-z_]+)$/)?.[1] ?? null;
  const isPage = api === null && url.pathname === '/' && ['GET', 'POST'].includes(req.method);
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
