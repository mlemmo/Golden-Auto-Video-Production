// Sign-in sessions: an HttpOnly cookie with a random token; the sessions table keeps only its SHA-256, the user and
// a CSRF token the browser must echo in X-CSRF-Token on every change. Sessions end after 12 idle hours.
import { createHash, randomBytes } from 'node:crypto';

export const COOKIE = 'ls_sid';
export const IDLE_HOURS = 12;

const tokenId = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  await db.query(`INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?,?,?, NOW(3) + INTERVAL ${IDLE_HOURS} HOUR)`, [tokenId(token), userId, csrf]);
  if (Math.random() < 0.05) await db.query('DELETE FROM sessions WHERE expires_at < NOW(3)');
  return { token, csrf };
}

/** The session and its active user for a cookie token, or null. Extends the idle timer at most once a minute. */
export async function loadSession(db, token) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) return null;
  const id = tokenId(token);
  const [rows] = await db.query(
    `SELECT s.id AS session_id, s.csrf, s.updated_at AS seen, u.id, u.email, u.name, u.is_staff
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > NOW(3) AND u.status = 'active'`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.seen).getTime() > 60_000) {
    await db.query(`UPDATE sessions SET expires_at = NOW(3) + INTERVAL ${IDLE_HOURS} HOUR WHERE id = ?`, [id]);
  }
  return { id, csrf: row.csrf, user: { id: row.id, email: row.email, name: row.name, is_staff: !!row.is_staff } };
}

export async function destroySession(db, token) {
  if (/^[a-f0-9]{64}$/.test(token ?? '')) await db.query('DELETE FROM sessions WHERE id = ?', [tokenId(token)]);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

// SameSite=Lax (not Strict) so the session survives the top-level redirect back from Meta's login (Milestone 3).
export const sessionCookie = (token, secure) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${IDLE_HOURS * 3600}${secure ? '; Secure' : ''}`;
export const clearedCookie = (secure) => `${COOKIE}=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
