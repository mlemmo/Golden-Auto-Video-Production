// "Connect Facebook & Instagram": Facebook Login for Business per client (dealer). The dashboard asks for a dialog URL
// (facebook_connect), the dealer logs in with Facebook and picks the Page and Instagram account, Facebook sends the
// browser back to GET /api/node/facebook/callback, and the server exchanges the code for a token, reads the shared
// Pages (with their linked Instagram accounts and Page tokens) and stores them in table client_secrets. Tokens never go
// to the browser: facebook_status returns names only. Publishing (social.js) uses the chosen Page from here, and falls
// back to config meta_accounts. Config facebook: { app_id, app_secret, config_id, graph_version } (secret in
// private/config.json only).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { jsonEncode } from './storedjson.js';
import { str, trim, gmdateC } from './text.js';
import { validateAppBase } from './media.js';

const STATE_MS = 15 * 60 * 1000;
export const CALLBACK_PATH = '/api/node/facebook/callback';

export function facebookConfig(cfg) {
  const f = cfg.facebook && typeof cfg.facebook === 'object' ? cfg.facebook : {};
  const digits = (x) => (/^\d{5,25}$/.test(str(x ?? '')) ? str(x) : '');
  const version = /^v\d{1,3}\.\d$/.test(str(f.graph_version ?? '')) ? str(f.graph_version)
    : /^v\d{1,3}\.\d$/.test(str(cfg.meta_graph_version ?? '')) ? str(cfg.meta_graph_version) : 'v26.0';
  const app_id = digits(f.app_id), config_id = digits(f.config_id), secret = trim(str(f.app_secret ?? ''));
  return { app_id, config_id, secret, version, ready: !!(app_id && config_id && secret) };
}
export const redirectUri = (cfg) => validateAppBase(cfg) + CALLBACK_PATH;

function tables(db) {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS client_secrets (client TEXT PRIMARY KEY, payload TEXT NOT NULL)');
}
/** The stored Facebook connection of a client (with tokens; server side only), or null. */
export function facebookConnection(db, client) {
  tables(db);
  const r = db.prepare('SELECT payload FROM client_secrets WHERE client=?').get(client);
  const x = r ? JSON.parse(r.payload) : null;
  return x?.facebook ?? null;
}
function saveConnection(db, client, facebook) {
  tables(db);
  const r = db.prepare('SELECT payload FROM client_secrets WHERE client=?').get(client);
  const all = r ? JSON.parse(r.payload) : {};
  if (facebook) all.facebook = facebook; else delete all.facebook;
  db.prepare('INSERT INTO client_secrets (client, payload) VALUES (?, ?) ON CONFLICT(client) DO UPDATE SET payload=excluded.payload').run(client, jsonEncode(all));
}
/** The account social.js publishes with: the chosen Page's token and ids, or null. */
export function connectedAccount(db, client) {
  const c = facebookConnection(db, client);
  const p = c?.pages?.find((x) => x.id === c.page_id);
  if (!p) return null;
  return { page_token: p.token || c.token, page_id: p.id, ig_user_id: p.ig_id ?? '' };
}

const publicStatus = (cfg, c, message = '') => {
  const p = c?.pages?.find((x) => x.id === c.page_id);
  return {
    available: facebookConfig(cfg).ready,
    connected: !!p,
    page_name: p?.name ?? '', ig_username: p?.ig_username ?? '', instagram: !!p?.ig_id,
    connected_at: c?.connected_at ?? '', connected_by: c?.connected_by ?? '',
    // Several Pages were shared: the dealer picks one.
    pages: c && !p ? (c.pages ?? []).map((x) => ({ id: x.id, name: x.name, ig_username: x.ig_username ?? '' })) : [],
    message,
  };
};

/** Actions facebook_status, facebook_connect, facebook_page (users and admins), facebook_disconnect (admins). */
export function facebookApi(action, inp, db, cfg, session, client, { random = randomBytes, now = Date.now() } = {}) {
  if (action === 'facebook_status') {
    // A message from the login just finished (the callback is a page redirect), shown once.
    const message = str(session.data.fb_message ?? ''); delete session.data.fb_message;
    return publicStatus(cfg, facebookConnection(db, client), message);
  }
  if (action === 'facebook_connect') {
    const f = facebookConfig(cfg);
    if (!f.ready) throw new Error('Facebook login is not set up on this server yet (config facebook: app_id, app_secret, config_id; see docs/META_SETUP.md).');
    const state = random(24).toString('hex');
    session.data.fb_state = { state, client, at: now };
    const q = new URLSearchParams({ client_id: f.app_id, redirect_uri: redirectUri(cfg), config_id: f.config_id, response_type: 'code', override_default_response_type: 'true', state });
    return { url: 'https://www.facebook.com/' + f.version + '/dialog/oauth?' + q.toString() };
  }
  if (action === 'facebook_page') {
    const c = facebookConnection(db, client);
    if (!c?.pages?.some((x) => x.id === str(inp.page_id ?? ''))) throw new Error('Choose one of the Pages shared with Facebook login.');
    c.page_id = str(inp.page_id); saveConnection(db, client, c);
    return { ...publicStatus(cfg, c), message: 'Posting to ' + c.pages.find((x) => x.id === c.page_id).name + '.' };
  }
  if (action === 'facebook_disconnect') {
    saveConnection(db, client, null);
    return { ...publicStatus(cfg, null), message: 'Facebook and Instagram disconnected. To revoke the app completely, remove it in Facebook settings (Business integrations).' };
  }
  throw new Error('Unknown action.');
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/** GET JSON from the Graph API through a transport (see social.js metaFetch); Meta's message on errors. */
async function graphGet(transport, url, token) {
  const r = await transport('GET', url, token ? { Authorization: 'OAuth ' + token } : {}, null);
  if (r.status < 200 || r.status >= 300 || r.json?.error) throw new Error('Facebook answered: ' + str(r.json?.error?.message ?? 'HTTP ' + r.status));
  return r.json ?? {};
}

/**
 * The login's return (GET callback). allowed = the signed-in account's clients. Saves the connection and returns the
 * message to show; never throws for a user-facing problem (the browser is on a redirect, not an API call).
 */
export async function facebookCallback(db, cfg, session, user, query, allowed, { transport, now = Date.now() } = {}) {
  const saved = session.data.fb_state; delete session.data.fb_state;
  if (!user) return 'Sign in again, then connect Facebook from the dealer details.';
  if (user.role === 'viewer') return 'Your account can view videos but not connect Facebook.';
  if (!saved || !query.get('state') || !same(saved.state, query.get('state')) || now - saved.at > STATE_MS) return 'The Facebook login expired or did not match. Press Connect Facebook & Instagram again.';
  if (!allowed.includes(saved.client)) return 'Your account has no access to that client.';
  if (query.get('error')) return 'Facebook login was cancelled' + (query.get('error_description') ? ': ' + str(query.get('error_description')).slice(0, 200) : '.');
  const code = str(query.get('code') ?? '');
  if (!code) return 'Facebook did not send a login code. Try again.';
  const f = facebookConfig(cfg);
  if (!f.ready) return 'Facebook login is not set up on this server.';
  const base = 'https://graph.facebook.com/' + f.version + '/';
  try {
    const t = await graphGet(transport, base + 'oauth/access_token?' + new URLSearchParams({ client_id: f.app_id, client_secret: f.secret, redirect_uri: redirectUri(cfg), code }).toString(), '');
    const token = str(t.access_token ?? '');
    if (!token) return 'Facebook did not return an access token. Try again.';
    const me = await graphGet(transport, base + 'me/accounts?' + new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' }).toString(), token);
    const pages = (me.data ?? []).filter((p) => /^\d+$/.test(str(p.id ?? ''))).map((p) => ({ id: str(p.id), name: str(p.name ?? 'Page'), token: str(p.access_token ?? ''),
      ig_id: /^\d+$/.test(str(p.instagram_business_account?.id ?? '')) ? str(p.instagram_business_account.id) : '', ig_username: str(p.instagram_business_account?.username ?? '') }));
    if (!pages.length) return 'No Facebook Page was shared. Connect again and choose the dealer\'s Page (and its Instagram account).';
    const c = { token, pages, page_id: pages.length === 1 ? pages[0].id : '', connected_at: gmdateC(new Date(now)), connected_by: str(user.email) };
    saveConnection(db, saved.client, c);
    if (!c.page_id) return 'Connected. Choose which Page to post to.';
    const p = pages[0];
    return 'Connected to ' + p.name + (p.ig_id ? ' and Instagram @' + p.ig_username : ' (no Instagram account is linked to this Page)') + '.';
  } catch (e) {
    return str(e.message).startsWith('Facebook answered') ? e.message : 'Could not reach Facebook. Try again.';
  }
}
