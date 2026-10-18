// Sign-in sessions for the Node dashboard (what PHP's session_start gives index.php): an HttpOnly, SameSite=Strict
// cookie holding a random id, data kept server-side in its own SQLite file (data_dir/node-sessions.sqlite, so the
// shared agent.sqlite schema stays as PHP's). Idle sessions end after 24 minutes, like PHP's default
// session.gc_maxlifetime. Data: { csrf, auth, client, attempts }.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'ga_sid';
export const IDLE_SECONDS = 1440;

const stores = new Map();
export function sessionStore(path) {
  if (stores.has(path)) return stores.get(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, seen INTEGER NOT NULL)');
  const store = {
    load(id, now = Date.now() / 1000) {
      if (!/^[a-f0-9]{64}$/.test(id ?? '')) return null;
      const row = db.prepare('SELECT data, seen FROM sessions WHERE id=?').get(id);
      if (!row) return null;
      if (row.seen < now - IDLE_SECONDS) { db.prepare('DELETE FROM sessions WHERE id=?').run(id); return null; }
      return JSON.parse(row.data);
    },
    save(id, data, now = Date.now() / 1000) {
      db.prepare('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, seen=excluded.seen').run(id, JSON.stringify(data), Math.floor(now));
      if (Math.random() < 0.01) db.prepare('DELETE FROM sessions WHERE seen < ?').run(Math.floor(now - IDLE_SECONDS));
    },
    destroy(id) { db.prepare('DELETE FROM sessions WHERE id=?').run(id); },
    close() { db.close(); stores.delete(path); },
  };
  stores.set(path, store);
  return store;
}
export const newSessionId = () => randomBytes(32).toString('hex');
export const newCsrf = () => randomBytes(24).toString('hex');

/** hash_equals(): constant-time string comparison. */
export function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}
export const sessionCookie = (id, secure) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
export const clearedCookie = (secure) => `${COOKIE}=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
