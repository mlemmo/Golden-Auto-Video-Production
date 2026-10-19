// Dashboard accounts. There is no registration page: the first admin is created at the first sign-in (with the old
// shared dashboard password, config password_hash), and admins create and manage everyone else.
// Roles: admin (everything, plus users and clients), user (makes videos for the clients assigned to them, including
// paid steps), viewer (sees and downloads videos for their clients; changes nothing).
// Stored in agent.sqlite, table users (id, email UNIQUE, payload JSON). Passwords are bcrypt hashes.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { gmdateC, str } from './text.js';
import { jsonEncode } from './storedjson.js';
import { CLIENT_DEFAULT, clientsLoad } from './clients.js';

export const ROLES = ['admin', 'user', 'viewer'];
export const MIN_PASSWORD = 10;

function table(db) {
  db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, payload TEXT NOT NULL)');
}
const parse = (row) => (row ? JSON.parse(row.payload) : null);
const save = (db, u) => db.prepare('INSERT INTO users VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, payload=excluded.payload').run(u.id, u.email, jsonEncode(u));

export const normalEmail = (e) => str(e).trim().toLowerCase();
function checkEmail(email) {
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(email) || email.length > 120) throw new Error('Enter a valid email address.');
}
function checkPassword(pw) {
  if (str(pw).length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (str(pw).length > 200) throw new Error('That password is too long.');
}
const hash = (pw) => bcrypt.hashSync(str(pw), 12);
let dummyHash = null;

export function userCount(db) { table(db); return db.prepare('SELECT count(*) n FROM users').get().n; }
export function userById(db, id) { table(db); return parse(db.prepare('SELECT payload FROM users WHERE id=?').get(str(id))); }
export function userByEmail(db, email) { table(db); return parse(db.prepare('SELECT payload FROM users WHERE email=?').get(normalEmail(email))); }
export function usersList(db) { table(db); return db.prepare('SELECT payload FROM users ORDER BY email').all().map(parse); }

/** What the dashboard may know about an account (never the hash). */
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name ?? '', role: u.role, clients: u.role === 'admin' ? [] : (u.clients ?? []),
  active: u.active !== false, created_at: u.created_at, last_sign_in: u.last_sign_in ?? null });

/**
 * Sign-in by email and password. With no accounts yet, the old shared dashboard password creates the first admin
 * for the email given. Returns the account or null.
 */
export async function signIn(db, cfg, email, password) {
  email = normalEmail(email);
  if (userCount(db) === 0) {
    if (!cfg.password_hash || !(await bcrypt.compare(str(password), str(cfg.password_hash)).catch(() => false))) return null;
    checkEmail(email);
    const u = { id: randomBytes(12).toString('hex'), email, name: '', role: 'admin', clients: [], active: true,
      password_hash: str(cfg.password_hash), created_at: gmdateC(), created_by: 'first sign-in' };
    save(db, u);
    return signedIn(db, u);
  }
  const u = userByEmail(db, email);
  // Compare against a stand-in hash when the email is unknown, so the answer takes as long either way.
  dummyHash ??= hash(randomBytes(12).toString('hex'));
  const ok = await bcrypt.compare(str(password), u?.password_hash ?? dummyHash).catch(() => false);
  if (!u || !ok || u.active === false) return null;
  return signedIn(db, u);
}
function signedIn(db, u) { u.last_sign_in = gmdateC(); save(db, u); return u; }

/** The clients an account may work on (admins: all). */
export function allowedClients(db, u) {
  const all = clientsLoad(db).items.map((c) => c.id);
  return u.role === 'admin' ? all : all.filter((id) => (u.clients ?? []).includes(id));
}

// ---- Admin: managing accounts --------------------------------------------------------------------------------------
function cleanFields(db, input) {
  const role = str(input.role);
  if (!ROLES.includes(role)) throw new Error('Choose a role: admin, user or viewer.');
  const known = clientsLoad(db).items.map((c) => c.id);
  const clients = role === 'admin' ? [] : [...new Set((Array.isArray(input.clients) ? input.clients : []).map(str))].filter((c) => known.includes(c));
  const name = str(input.name).trim().slice(0, 80);
  return { role, clients, name };
}
export function userCreate(db, admin, input) {
  const email = normalEmail(input.email);
  checkEmail(email);
  if (userByEmail(db, email)) throw new Error('There is already an account with that email.');
  checkPassword(input.password);
  const f = cleanFields(db, input);
  const u = { id: randomBytes(12).toString('hex'), email, ...f, active: true, password_hash: hash(input.password), created_at: gmdateC(), created_by: admin.email };
  save(db, u);
  return u;
}
/** Change role, clients, name, email, active, or set a new password. An admin cannot demote or switch off themself. */
export function userUpdate(db, admin, input) {
  const u = userById(db, input.id);
  if (!u) throw new Error('Account not found.');
  const f = cleanFields(db, { role: input.role ?? u.role, clients: input.clients ?? u.clients, name: input.name ?? u.name });
  const active = input.active === undefined ? u.active !== false : !!input.active;
  if (u.id === admin.id && (f.role !== 'admin' || !active)) throw new Error('You cannot remove your own admin access or switch off your own account.');
  if (input.email !== undefined) {
    const email = normalEmail(input.email);
    checkEmail(email);
    const other = userByEmail(db, email);
    if (other && other.id !== u.id) throw new Error('There is already an account with that email.');
    u.email = email;
  }
  if (input.password) { checkPassword(input.password); u.password_hash = hash(input.password); }
  Object.assign(u, f, { active, updated_at: gmdateC(), updated_by: admin.email });
  save(db, u);
  return u;
}
export function userDelete(db, admin, id) {
  const u = userById(db, id);
  if (!u) throw new Error('Account not found.');
  if (u.id === admin.id) throw new Error('You cannot delete your own account.');
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
}
/** Any account: change its own password (the current one is required). */
export async function passwordChange(db, u, current, next) {
  if (!(await bcrypt.compare(str(current), u.password_hash).catch(() => false))) throw new Error('The current password is not right.');
  checkPassword(next);
  u.password_hash = hash(next); u.updated_at = gmdateC();
  save(db, u);
}

export { CLIENT_DEFAULT };
