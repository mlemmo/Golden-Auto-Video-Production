// The LotSpotlight portal's API, served by the studio's own server with the studio's database (one backend, Sawyer
// 2026-11-03). The portal pages are a static site (portal/web, built into portal/public) on their own address that call
// this API on the API address (config portal_api: { url, origins }). Paths: /api/auth/…, /api/dealers/…, /api/staff/….
//
// Dealers are the studio's clients; accounts are the studio's accounts. What an account may do at a dealer (canAt):
// studio admins are eShield staff (everything, every dealer, release orders, add dealers); studio users order and edit
// Dealer details for their clients; studio viewers look; customer accounts have two separate permissions per dealer,
// order videos and add people (Dealer details go with add people); neither, or a customer_viewer account, looks.
// Sign-in uses its own cookie (ls_sid, SameSite=Lax so the pages on the same domain send it; 12 idle hours) and every
// change carries the session's CSRF token in X-CSRF-Token.
import { HttpError } from '../lib/auth.js';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { clientAdd, clientDetails, clientFind, clientSaveDetails, clientsLoad, clientWebsite } from '../lib/clients.js';
import { save } from '../lib/db.js';
import { allowedClients, customerAdd, customerPerms, customerRemove, customerSetPerms, isCustomer, passwordChange, portalSignIn, userById, usersList } from '../lib/users.js';
import { newCsrf, newSessionId, parseCookies, sameSecret, sessionStore } from '../lib/session.js';
import { websiteListing } from './listing.js';
import { deps, onDepsChange, setPortalDeps } from './deps.js';
import { decodeVin } from './vin.js';
import { orderChoices } from './options.js';
import {
  addUpload, carView, deleteUpload, getCar, getOrder, getUpload, listCars, listOrders, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, moveOrder, orderView,
  placeOrder, PRODUCTS, reviewOrder, setThumb, statusFilter, uploadPath,
} from './store.js';
import { createReadStream } from 'node:fs';

export const COOKIE = 'ls_sid';
const IDLE = 12 * 3600;
const MAX_JSON = 100 * 1024;
const TIMEZONE = 'America/Los_Angeles';
const PATHS = /^\/api\/(auth|dealers|staff)(\/|$)/;

/** Is this request for the portal API? */
export const isPortalPath = (pathname) => PATHS.test(pathname);

// Outgoing requests (VIN lookup, dealer websites): src/portal/deps.js, replaced in tests.
let listing = null;
onDepsChange(() => { listing = null; });
export { setPortalDeps };
const websiteCars = () => (listing ??= websiteListing((url) => deps.siteFetch(url)));

// Failed sign-ins: 5 per email or 20 per address in 15 minutes.
const failures = new Map();
function tooMany(email, ip) {
  const now = Date.now(), recent = (k) => (failures.get(k) ?? []).filter((t) => now - t < 900_000);
  return recent('e:' + email).length >= 5 || recent('i:' + ip).length >= 20;
}
function failed(email, ip) {
  const now = Date.now();
  for (const k of ['e:' + email, 'i:' + ip]) failures.set(k, [...(failures.get(k) ?? []).filter((t) => now - t < 900_000), now]);
  if (failures.size > 10_000) failures.clear();
}

/** Role of an account at a dealer (client id): staff, owner, admin, viewer, or null. */
/** What an account may do at a dealer: { staff, order, people, details }, or null without access. */
export function canAt(user, client) {
  if (user.role === 'admin') return { staff: true, order: true, people: true, details: true };
  if (!(user.clients ?? []).includes(client)) return null;
  if (user.role === 'user') return { staff: false, order: true, people: false, details: true };
  const p = customerPerms(user, client);
  return { staff: false, order: p.order, people: p.people, details: p.people };
}
/** A short name for the permissions, for the page header and the People list. */
const roleName = (can) => (can.staff ? 'staff' : can.order && can.people ? 'order_people' : can.order ? 'order' : can.people ? 'people' : 'viewer');
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name ?? '', is_staff: u.role === 'admin', customer: isCustomer(u) });

function dealerView(db, client, can = null) {
  const d = clientDetails(client);
  return { id: client.id, slug: client.id, name: client.name, website: client.website || null, city: d.city || null, phone: d.phone || null,
    timezone: client.portal?.timezone ?? TIMEZONE, status: 'active', ...(can ? { can, role: roleName(can) } : {}) };
}
function dealersFor(db, user) {
  const ids = allowedClients(db, user);
  return clientsLoad(db).items.filter((c) => ids.includes(c.id)).map((c) => dealerView(db, c, canAt(user, c.id))).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Request plumbing ----

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS, ...headers });
  res.end(JSON.stringify(body));
}
async function readBody(req, max) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Request too large.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const cookie = (id, secure) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${IDLE}${secure ? '; Secure' : ''}`;
const clearCookie = (secure) => `${COOKIE}=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

// ---- Routes: [method, path pattern, minimum (null: signed in; 'staff'; or a dealer role), handler, body kind] ----

const routes = [];
const route = (method, pattern, access, fn, body = 'json') => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), access, fn, body });

route('GET', '/api/auth/me', null, ({ db, user, session }) => ({ user: publicUser(user), dealers: dealersFor(db, user), csrf: session.data.csrf }));
route('POST', '/api/auth/logout', null, ({ session }) => { session.destroyed = true; return { ok: true }; });
route('POST', '/api/auth/password', null, async ({ db, user, body }) => {
  await passwordChange(db, user, body.current, body.password);
  return { ok: true };
});

route('GET', '/api/dealers', null, ({ db, user }) => ({ dealers: dealersFor(db, user) }));
route('POST', '/api/dealers', 'staff', async ({ db, body }) => {
  const c = await clientAdd(db, String(body.name ?? ''), String(body.website ?? ''));
  return [201, { dealer: dealerView(db, c, canAt({ role: 'admin' }, c.id)) }];
});
route('GET', '/api/dealers/:dealer', 'viewer', ({ db, client, can }) => ({ dealer: dealerView(db, client, can) }));
route('PATCH', '/api/dealers/:dealer', 'details', ({ db, client, body }) => {
  const cur = clientDetails(client);
  const website = body.website === undefined ? client.website : String(body.website ?? '').trim() === '' ? client.website : clientWebsite(body.website);
  const host = String(website ?? '').replace(/^https:\/\//, '').replace(/^www\./, '');
  const name = body.name === undefined ? client.name : String(body.name).trim();
  if (!name || name.length > 80) throw new HttpError(400, 'Enter the dealer name (up to 80 characters).');
  if (clientsLoad(db).items.some((x) => x.id !== client.id && x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Another dealer already has that name.');
  clientSaveDetails(db, client.id, { name, city: body.city === undefined ? cur.city : body.city ?? '', website: host || cur.website,
    website_spoken: host && host !== cur.website ? '' : cur.website_spoken, phone: body.phone === undefined ? cur.phone : body.phone ?? '' });
  const all = clientsLoad(db), item = all.items.find((x) => x.id === client.id);
  Object.assign(item, { name, website, portal: { ...(item.portal ?? {}), timezone: String(body.timezone ?? item.portal?.timezone ?? TIMEZONE).slice(0, 64) } });
  save(db, 'clients', all);
  return { dealer: dealerView(db, item) };
});

// People: who has access to this dealer (eShield staff are not listed; they see every dealer).
const person = (u, client) => { const can = canAt(u, client); return { id: u.id, email: u.email, name: u.name ?? '', order: can.order, people: can.people, role: roleName(can), studio: !isCustomer(u) }; };
route('GET', '/api/dealers/:dealer/users', 'people', ({ db, client }) => ({
  users: usersList(db).filter((u) => u.role !== 'admin' && (u.clients ?? []).includes(client.id) && u.active !== false).map((u) => person(u, client.id)),
}));
route('POST', '/api/dealers/:dealer/users', 'people', ({ db, user, client, body }) => {
  const { user: added, created } = customerAdd(db, user, { email: body.email, name: body.name, password: body.password, order: body.order === true, people: body.people === true, client: client.id });
  return [201, { user: person(added, client.id), created }];
});
route('PATCH', '/api/dealers/:dealer/users/:user', 'people', ({ db, user, client, params, body }) => ({
  user: person(customerSetPerms(db, user, params.user, client.id, { order: body.order === true, people: body.people === true }), client.id),
}));
route('DELETE', '/api/dealers/:dealer/users/:user', 'people', ({ db, user, client, params }) => { customerRemove(db, user, params.user, client.id); return { ok: true }; });

// Cars: the website read live (nothing saved), cars with videos (stored when ordered), VIN lookup, uploads.
route('GET', '/api/dealers/:dealer/website-cars', 'viewer', async ({ db, client, query }) => {
  const read = await websiteCars().forDealer({ id: client.id, website: client.website }, { fresh: query.get('fresh') === '1' });
  const ordered = new Map(listCars(db, client.id).map((c) => [c.vin, c]));
  return { ...read, cars: read.cars.map((c) => ({ ...c, vehicle_id: ordered.has(c.vin) ? c.vin : null, order_status: ordered.get(c.vin)?.order_status ?? null })) };
});
route('GET', '/api/dealers/:dealer/vehicles', 'viewer', ({ db, client }) => ({ vehicles: listCars(db, client.id) }));
route('GET', '/api/dealers/:dealer/vehicles/:vin', 'viewer', ({ db, client, params }) => ({ vehicle: carView(getCar(db, client.id, params.vin)) }));
route('GET', '/api/dealers/:dealer/vin/:vin', 'order', async ({ params }) => ({ vehicle: await decodeVin(params.vin, deps.fetchFn) }));
route('POST', '/api/dealers/:dealer/uploads', 'order', ({ db, cfg, client, user, body }) => [201, { photo_id: addUpload(db, cfg, client.id, user, body) }], 'jpeg');
route('POST', '/api/dealers/:dealer/uploads/:photo/thumb', 'order', ({ db, cfg, client, params, body }) => {
  setThumb(db, cfg, getUpload(db, client.id, params.photo), body);
  return { ok: true };
}, 'thumb');
route('DELETE', '/api/dealers/:dealer/uploads/:photo', 'order', ({ db, cfg, client, params }) => { deleteUpload(db, cfg, getUpload(db, client.id, params.photo)); return { ok: true }; });
route('GET', '/api/dealers/:dealer/photos/:photo', 'viewer', ({ db, cfg, client, params, query, res }) => {
  const u = getUpload(db, client.id, params.photo);
  const path = (query.get('size') === 'thumb' && uploadPath(cfg, u.thumb)) || uploadPath(cfg, u.file) || uploadPath(cfg, u.thumb);
  if (!path) throw new HttpError(404, 'Photo not found.');
  return { file: path };
});

// Orders.
const clientName = (db) => { const names = new Map(clientsLoad(db).items.map((c) => [c.id, c.name])); return (id) => names.get(id) ?? id; };
route('GET', '/api/dealers/:dealer/products', 'viewer', ({ db, cfg }) => ({ products: PRODUCTS, choices: orderChoices(db, cfg) }));
route('GET', '/api/dealers/:dealer/orders', 'viewer', ({ db, client, query }) => ({
  orders: listOrders(db, { clients: [client.id], statuses: statusFilter(query.get('status')) }).map((o) => orderView(o, clientName(db))),
}));
route('POST', '/api/dealers/:dealer/orders', 'order', ({ db, cfg, client, user, body }) => {
  const id = placeOrder(db, cfg, client.id, user, body);
  return [201, { order: orderView(getOrder(db, id), clientName(db)) }];
});
route('GET', '/api/dealers/:dealer/orders/:order', 'viewer', ({ db, client, params }) => ({ order: orderView(getOrder(db, params.order, client.id), clientName(db)) }));
// Customers cancel before payment; staff can cancel any order not delivered yet.
route('POST', '/api/dealers/:dealer/orders/:order/cancel', 'order', ({ db, client, can, params }) => {
  const order = getOrder(db, params.order, client.id);
  const from = can.staff ? ['awaiting_payment', 'paid', 'in_progress', 'ready_for_review', 'rejected'] : ['awaiting_payment'];
  moveOrder(db, order.id, from, 'cancelled', {}, can.staff ? 'This order can no longer be cancelled.' : 'Paid orders can only be cancelled by eShield. Contact us.');
  return { order: orderView(getOrder(db, order.id), clientName(db)) };
});

// The customer's review of the delivered videos (Milestone 4): approve, or reject with what to change.
route('POST', '/api/dealers/:dealer/orders/:order/approve', 'order', ({ db, client, user, params }) => {
  reviewOrder(db, params.order, client.id, user, { approve: true });
  return { order: orderView(getOrder(db, params.order), clientName(db)) };
});
route('POST', '/api/dealers/:dealer/orders/:order/reject', 'order', ({ db, client, user, params, body }) => {
  reviewOrder(db, params.order, client.id, user, { approve: false, reason: body.reason });
  return { order: orderView(getOrder(db, params.order), clientName(db)) };
});

route('GET', '/api/staff/orders', 'staff', ({ db, query }) => ({ orders: listOrders(db, { statuses: statusFilter(query.get('status')) }).map((o) => orderView(o, clientName(db))) }));
// Stands in for payment until Stripe (Milestone 3).
route('POST', '/api/staff/orders/:order/release', 'staff', ({ db, user, params }) => {
  moveOrder(db, params.order, ['awaiting_payment'], 'paid', { paid_via: 'staff', paid_at: new Date().toISOString(), released_by: user.email }, 'Only orders awaiting payment can be released.');
  return { order: orderView(getOrder(db, params.order), clientName(db)) };
});

// ---- The handler ----

/**
 * Answers one portal API request. https/allowed: from the studio server's connection check (HTTPS behind Nginx, or a
 * local test). Pages on another address (config portal_api.origins) may call it with their cookie; nobody else.
 */
export async function handlePortal(req, res, url, { https, allowed }) {
  const cfg = loadConfig();
  const origin = req.headers.origin;
  const cors = origin && (cfg.portal_api?.origins ?? []).includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {};
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, ...(cors['Access-Control-Allow-Origin'] ? { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token', 'Access-Control-Max-Age': '600' } : {}) });
    return res.end();
  }
  if (!allowed) return sendJson(res, 403, { error: 'Use HTTPS.' }, cors);
  const store = sessionStore(String(cfg.data_dir) + '/portal-sessions.sqlite', IDLE);
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  const data = store.load(sid);
  const session = data ? { id: sid, data, fresh: false } : { id: newSessionId(), data: { csrf: newCsrf() }, fresh: true };
  const finish = () => {
    if (session.destroyed) { store.destroy(session.id); return { 'Set-Cookie': clearCookie(https) }; }
    if (!session.data.user) return {};
    store.save(session.id, session.data);
    return session.fresh ? { 'Set-Cookie': cookie(session.id, https) } : {};
  };
  try {
    const db = openDb(cfg);
    // Sign-in: JSON, no CSRF token yet; a new session id each time.
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
      const body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}');
      const email = String(body.email ?? '').trim().toLowerCase(), ip = req.socket.remoteAddress ?? '';
      if (tooMany(email, ip)) throw new HttpError(429, 'Too many failed sign-ins. Try again in 15 minutes.');
      const user = await portalSignIn(db, email, body.password);
      if (!user) { failed(email, ip); throw new HttpError(401, 'Wrong email or password.'); }
      if (!session.fresh) store.destroy(session.id);
      Object.assign(session, { id: newSessionId(), fresh: true, data: { csrf: newCsrf(), user: user.id } });
      return sendJson(res, 200, { user: publicUser(user), dealers: dealersFor(db, user), csrf: session.data.csrf }, { ...cors, ...finish() });
    }

    let match = null, r = null;
    for (const x of routes) { const m = url.pathname.match(x.re); if (m) { if (x.method === req.method) { r = x; match = m; break; } match = m; } }
    if (!r) return sendJson(res, match ? 405 : 404, { error: match ? 'Method not allowed.' : 'Not found.' }, cors);

    const user = session.data.user ? userById(db, session.data.user) : null;
    if (!user || user.active === false) { delete session.data.user; throw new HttpError(401, 'Please sign in.'); }
    let body = {};
    if (req.method !== 'GET') {
      if (!sameSecret(session.data.csrf, req.headers['x-csrf-token'] ?? '')) throw new HttpError(403, 'Your session changed. Reload the page and try again.');
      const type = String(req.headers['content-type'] ?? '');
      if (r.body === 'json') {
        if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
        try { body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}'); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Body must be JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object.');
      } else {
        if (!type.startsWith('image/jpeg')) throw new HttpError(415, 'Photos must be sent as JPEG.');
        body = await readBody(req, r.body === 'thumb' ? MAX_THUMB_BYTES : MAX_PHOTO_BYTES);
      }
    }
    const params = match.groups ?? {};
    let client = null, can = null;
    if (r.access === 'staff' && user.role !== 'admin') throw new HttpError(403, 'Only eShield staff can do that.');
    if (params.dealer !== undefined) {
      try { client = clientFind(db, decodeURIComponent(params.dealer)); } catch { client = null; }
      can = client ? canAt(user, client.id) : null;
      if (!can) throw new HttpError(404, 'Dealer not found.');
      const need = { order: 'order videos', people: 'add people', details: 'change the dealer details' }[r.access];
      if (need && !can[r.access]) throw new HttpError(403, `Your access to this dealer does not include permission to ${need}.`);
    }
    const out = await r.fn({ db, cfg, user, session, client, can, params, body, query: url.searchParams, res });
    const headers = { ...cors, ...finish() };
    if (out?.file) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', ...headers });
      return createReadStream(out.file).pipe(res);
    }
    const [status, payload] = Array.isArray(out) ? out : [200, out];
    sendJson(res, status, payload, headers);
  } catch (e) {
    const headers = { ...cors, ...finish() };
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message }, headers);
    if (e instanceof SyntaxError) return sendJson(res, 400, { error: 'Body must be JSON.' }, headers);
    if (e instanceof Error && e.constructor === Error) return sendJson(res, 400, { error: e.message }, headers);
    console.error(e);
    sendJson(res, 500, { error: 'Something went wrong on the server.' }, headers);
  }
}
