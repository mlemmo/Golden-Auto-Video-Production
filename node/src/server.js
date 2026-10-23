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
import { socialApi, metaFetch } from './lib/social.js';
import { adApi } from './lib/ads.js';
import { adPreview } from './lib/meta-ads.js';
import { facebookApi, facebookCallback, facebookBouncePage, CALLBACK_PATH, RETURN_PATH } from './lib/facebook.js';
import { parseMultipart } from './lib/multipart.js';
import { CLIENT_DEFAULT, clientsLoad, clientFind, clientDetails, clientSpeechSites } from './lib/clients.js';
import { withSpeechSites } from './lib/speech.js';
import { sessionStore, newSessionId, newCsrf, sameSecret, parseCookies, sessionCookie, clearedCookie, COOKIE } from './lib/session.js';
import { loginPage, dashboardPage, sharePage } from './lib/pages.js';
import { recordActivity, usageReport } from './lib/activity.js';
import { libraryVideos } from './lib/jobs.js';
import { signIn, userById, userCount, publicUser, allowedClients, usersList, userCreate, userUpdate, userDelete, passwordChange } from './lib/users.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);
const MAX_BODY = 1 << 20;
const MAX_UPLOAD = 72 * 1024 * 1024;  // same as Nginx client_max_body_size

// Session and account actions.
const sessionRoutes = {
  client_select: ({ db, body, session, user }) => {
    const id = String(body.id ?? '');
    clientFind(db, id);
    if (!allowedClients(db, user).includes(id)) throw new HttpError(403, 'Your account has no access to that client.');
    session.data.client = id; return { message: 'Client selected.' };
  },
  logout: ({ session }) => { session.destroyed = true; return {}; },
  me: ({ db, user }) => ({ user: publicUser(user), clients: allowedClients(db, user) }),
  // The Library page: every finished video of the clients this account may use.
  // Posting finished videos to Facebook and Instagram (src/lib/social.js); the video's client must be one of the account's.
  ...Object.fromEntries(['social_status', 'social_list', 'social_post', 'social_cancel', 'social_retry'].map((a) => [a, ({ db, cfg, user, body }) => socialApi(a, body, db, cfg, { allowed: allowedClients(db, user), user: user.email })])),
  // Connect Facebook & Instagram for the current client (src/lib/facebook.js); tokens stay on the server.
  ...Object.fromEntries(['facebook_status', 'facebook_connect', 'facebook_page', 'facebook_disconnect'].map((a) => [a, ({ db, cfg, body, session, client }) => facebookApi(a, body, db, cfg, session, client)])),
  // Paid ads (src/lib/ads.js): requests, Switch on / Pause / Retry (applied by the ads worker) and dealer ad settings.
  ...Object.fromEntries(['ad_status', 'ad_list', 'ad_request', 'ad_cancel', 'ad_remove', 'ad_switch_on', 'ad_pause', 'ad_retry'].map((a) => [a, ({ db, user, body }) => adApi(a, body, db, { allowed: allowedClients(db, user), user: user.email })])),
  // Meta's own previews of an ad (nothing is created; the video is uploaded to the ad account once and reused at launch).
  ad_preview: ({ db, cfg, user, body }) => adPreview(db, cfg, body, { allowed: allowedClients(db, user) }),
  ...Object.fromEntries(['ad_settings', 'ad_settings_save'].map((a) => [a, ({ db, user, body, client }) => adApi(a, { ...body, client }, db, { allowed: allowedClients(db, user), user: user.email })])),
  library: ({ db, user }) => { const ids = allowedClients(db, user); return { videos: libraryVideos(db, ids), clients: clientsLoad(db).items.filter((c) => ids.includes(c.id)).map((c) => ({ id: c.id, name: c.name })) }; },
  password_change: async ({ db, user, body }) => { await passwordChange(db, user, body.current, body.password); return { message: 'Password changed.' }; },
  // Admins: accounts.
  users_list: ({ db }) => ({ users: usersList(db).map(publicUser), clients: clientsLoad(db).items.map((c) => ({ id: c.id, name: c.name })) }),
  user_create: ({ db, user, body }) => ({ user: publicUser(userCreate(db, user, body)), message: 'Account created.' }),
  user_update: ({ db, user, body }) => ({ user: publicUser(userUpdate(db, user, body)), message: 'Account saved.' }),
  user_delete: ({ db, user, body }) => { userDelete(db, user, body.id); return { message: 'Account deleted.' }; },
  // Admins: the Usage dashboard (days: 7, 30, 90 or 0 = all time; optional client and user).
  usage: ({ db, cfg, body }) => usageReport(db, cfg, { days: Number(body.days ?? 30) || 0, client: String(body.client ?? ''), user: String(body.user ?? '') }),
};

// What each role may do. Viewers only read; admins alone manage users, clients and the shared spokesperson library;
// users do everything else (including paid steps) for the clients assigned to them.
const VIEWER_ACTIONS = new Set(['library', 'music_list', 'scene_list', 'clients', 'client_select', 'inventory', 'sync_log', 'jobs', 'narration_list', 'spokesperson_list', 'detail', 'speech', 'logout', 'me', 'password_change']);
const ADMIN_ACTIONS = new Set(['usage', 'music_upload', 'music_delete', 'ad_settings_save', 'facebook_disconnect', 'spokesperson_describe', 'spokesperson_picture', 'spokesperson_save_draft', 'snapshot_import', 'scene_save', 'scene_delete', 'scene_default', 'scene_suggest', 'client_add', 'client_analyze', 'client_details', 'spokesperson_upload', 'spokesperson_default', 'spokesperson_delete', 'users_list', 'user_create', 'user_update', 'user_delete']);
// Actions that need no current client (an account without clients can still use them).
const NO_CLIENT = new Set(['library', 'ad_preview', 'ad_status', 'ad_list', 'ad_request', 'ad_cancel', 'ad_remove', 'ad_switch_on', 'ad_pause', 'ad_retry', 'social_status', 'social_list', 'social_post', 'social_cancel', 'social_retry', 'usage', 'clients', 'logout', 'me', 'password_change', 'users_list', 'user_create', 'user_update', 'user_delete', 'client_add']);
// Actions recorded for the Usage dashboard (who, which client, what, when; never passwords).
const TRACKED = new Set(['generate', 'ad_request', 'ad_cancel', 'ad_remove', 'ad_switch_on', 'ad_pause', 'ad_retry', 'ad_settings_save', 'facebook_page', 'facebook_disconnect', 'social_post', 'social_cancel', 'social_retry', 'spokesperson_picture', 'spokesperson_save_draft', 'narration_preview', 'narration_lipsync', 'footage_build', 'slideshow_build', 'music_upload', 'music_delete', 'finish', 'narration_approve', 'job_delete',
  'narration_delete', 'narration_lipsync_delete', 'sync', 'import', 'client_add', 'client_details', 'client_analyze', 'spokesperson_upload',
  'spokesperson_default', 'spokesperson_delete', 'user_create', 'user_update', 'user_delete', 'password_change']);
function activityDetail(name, body, out) {
  const d = {};
  for (const k of ['stock', 'duration', 'voice', 'format', 'id', 'resolution']) if (['string', 'number'].includes(typeof body[k]) && body[k] !== '') d[k] = body[k];
  const v = out?.job?.vehicle ?? out?.vehicle ?? out?.post?.vehicle; if (v) d.vehicle = v;
  if (Array.isArray(body.platforms)) d.platforms = body.platforms.join(',');
  if (Array.isArray(body.formats)) d.formats = body.formats.join(',');
  if (out?.job?.duration) d.duration = out.job.duration;
  if (name.startsWith('user_')) { d.email = body.email ?? out?.user?.email; d.role = body.role; }
  if (name === 'client_add') d.client_name = out?.client?.name;
  return d;
}
function allowedFor(role, name) {
  if (role === 'admin') return true;
  if (ADMIN_ACTIONS.has(name)) return false;
  return role === 'user' || VIEWER_ACTIONS.has(name);
}

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
/** The session's client if this account may use it, else its first allowed client; null when it has none. */
function currentClient(db, data, user) {
  const allowed = allowedClients(db, user), client = String(data.client ?? CLIENT_DEFAULT);
  return allowed.includes(client) ? client : allowed[0] ?? null;
}
/** The signed-in account, or null (no session, deleted or switched off). */
function sessionUser(db, session) {
  const u = session.data.user ? userById(db, session.data.user) : null;
  return u && u.active !== false ? u : null;
}

async function runAction(name, req, res, cfg, store, session, https) {
  const handler = Object.hasOwn(actions, name) ? actions[name] : null;
  if (!handler) return send(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required.' });
  let uploadDir = null;
  try {
    const db = openDb(cfg);
    const user = sessionUser(db, session);
    if (!user) { delete session.data.user; throw new HttpError(401, 'Sign in again.'); }
    if (!sameSecret(session.data.csrf, req.headers['x-csrf-token'] ?? '')) throw new HttpError(403, 'Invalid request.');
    if (!allowedFor(user.role, name)) throw new HttpError(403, user.role === 'viewer' ? 'Your account can view videos but not change anything.' : 'Only an admin can do that.');
    const client = currentClient(db, session.data, user);
    if (client === null && !NO_CLIENT.has(name)) throw new HttpError(403, 'No clients are assigned to your account yet. Ask an admin.');
    let body, files = {};
    if (MULTIPART.has(name)) {
      uploadDir = mkdtempSync(tmpdir() + '/ga-upload-');
      ({ fields: body, files } = parseMultipart(await readBody(req, MAX_UPLOAD), req.headers['content-type'], uploadDir));
    } else body = await readJson(req);
    // Paid records say who approved them (set here, never taken from the request).
    body.approved_by = user.email;
    // Dealer named in scripts and speech for this client; its website is said as written in its details.
    const dealer = client === null ? null : clientDetails(clientFind(db, client));
    const sites = client === null ? {} : clientSpeechSites(client, dealer);
    let out = await withSpeechSites(sites, () => handler({ cfg, db, client, dealer, body, files, req, session, user }));
    if (TRACKED.has(name)) recordActivity(db, { user: user.email, client: client ?? '', action: name, detail: activityDetail(name, body, out) });
    // Accounts see only their own clients.
    if (name === 'clients') { const allowed = allowedClients(db, user); out = { ...out, items: out.items.filter((c) => allowed.includes(c.id)), current: client }; }
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
      else {
        let u = null;
        try { u = await signIn(openDb(cfg), cfg, form.get('email') ?? '', form.get('password')); } catch (e) { if (!userError(e)) throw e; error = e.message; }
        recordActivity(openDb(cfg), { user: u ? u.email : String(form.get('email') ?? '').trim().toLowerCase().slice(0, 120), action: u ? 'sign_in' : 'sign_in_failed' });
        if (u) {
          // A new session id on sign-in.
          store.destroy(session.id); session.id = newSessionId(); session.fresh = true;
          session.data = { csrf: session.data.csrf, user: u.id, attempts: [] };
        } else if (!error) { session.data.attempts.push(now); error = 'Incorrect email or password.'; }
      }
    }
  }
  const user = session.data.user ? sessionUser(openDb(cfg), session) : null;
  if (session.data.user && !user) delete session.data.user;
  const headers = closeSession(store, session, https);
  // After a successful sign-in, redirect to a plain GET of the page (Post/Redirect/Get), so reloading the
  // dashboard never asks the browser to resend the sign-in form.
  if (req.method === 'POST' && user) {
    res.writeHead(303, { ...SECURITY, ...headers, Location: new URL(req.url, 'http://localhost').pathname });
    return res.end();
  }
  if (!user) return sendText(res, 200, loginPage(cfg, session.data.csrf, error, userCount(openDb(cfg)) === 0), undefined, headers);
  const html = dashboardPage(cfg, session.data.csrf, process.env.GOLDEN_ROOT ?? ROOT, publicUser(user));
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
  // Public share page of one finished video (no sign-in): /v/<video id>.
  const share = req.method === 'GET' && url.pathname.match(/^\/v\/([a-f0-9]{16,64})$/);
  if (share) {
    try {
      const cfg = loadConfig(), db = openDb(cfg);
      const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(share[1]);
      const j = row ? JSON.parse(row.payload) : null;
      if (!j || j.finish_status !== 'completed' || !String(j.captioned_url ?? '').startsWith('https://')) return sendText(res, 404, 'This video is not available.', 'text/plain; charset=UTF-8');
      let dealer = null; try { dealer = clientDetails(clientFind(db, j.client ?? CLIENT_DEFAULT)); } catch { /* client removed */ }
      return sendText(res, 200, sharePage({ vehicle: String(j.vehicle ?? ''), stock: j.stock, price: j.price ?? null, url: j.captioned_url }, dealer));
    } catch (e) { console.error(e); return sendText(res, 500, 'Internal error', 'text/plain; charset=UTF-8'); }
  }
  // Facebook Login for Business returns to CALLBACK_PATH (cross-site: no session cookie), which bounces to RETURN_PATH on
  // this origin; there the connection is saved and the browser goes back to the dashboard.
  if (req.method === 'GET' && url.pathname === CALLBACK_PATH) return sendText(res, 200, facebookBouncePage(url.searchParams), 'text/html; charset=UTF-8', { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (req.method === 'GET' && url.pathname === RETURN_PATH) {
    try {
      const { https, allowed } = connection(req);
      if (!allowed) return sendText(res, 403, 'Use HTTPS to access this dashboard.', 'text/plain; charset=UTF-8');
      const cfg = loadConfig(), db = openDb(cfg);
      const { store, session } = openSession(cfg, req);
      const user = sessionUser(db, session);
      const message = await facebookCallback(db, cfg, session, user, url.searchParams, user ? allowedClients(db, user) : [], { transport: metaFetch });
      if (user && /^Connected/.test(message)) recordActivity(db, { user: user.email, client: String(session.data.client ?? CLIENT_DEFAULT), action: 'facebook_connect', detail: {} });
      session.data.fb_message = message;
      res.writeHead(303, { Location: '/?facebook=1', 'Cache-Control': 'no-store', ...closeSession(store, session, https) });
      return res.end();
    } catch (e) { console.error(e); return sendText(res, 500, 'Internal error', 'text/plain; charset=UTF-8'); }
  }
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
