// Accounts and dealer roles. eShield staff (users.is_staff) see and manage every dealer; everyone else only the
// dealers they belong to, with one role each: owner > admin > approver > viewer.
import bcrypt from 'bcryptjs';
import { HttpError } from './errors.js';

export const ROLES = ['owner', 'admin', 'approver', 'viewer'];
export const MIN_PASSWORD = 10;
const BCRYPT_COST = 12;

export const normalEmail = (email) => String(email ?? '').trim().toLowerCase();
export const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 190;

export function hashPassword(password) {
  if (String(password ?? '').length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  return bcrypt.hash(String(password), BCRYPT_COST);
}

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

/** Returns the active user for this email and password, or null. */
export async function checkLogin(db, email, password) {
  const [rows] = await db.query("SELECT * FROM users WHERE email = ? AND status = 'active'", [normalEmail(email)]);
  const user = rows[0];
  const ok = await bcrypt.compare(String(password ?? ''), user ? user.password_hash : DUMMY_HASH);
  return ok && user ? user : null;
}

export async function createUser(db, { email, name = '', password, isStaff = false }) {
  const e = normalEmail(email);
  if (!validEmail(e)) throw new HttpError(400, 'Enter a valid email address.');
  const hash = await hashPassword(password);
  try {
    const [r] = await db.query('INSERT INTO users (email, password_hash, name, is_staff) VALUES (?,?,?,?)', [e, hash, String(name).slice(0, 190), !!isStaff]);
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account with that email already exists.');
    throw err;
  }
}

export async function findUserByEmail(db, email) {
  const [rows] = await db.query('SELECT id, email, name, is_staff, status FROM users WHERE email = ?', [normalEmail(email)]);
  return rows[0] ?? null;
}

/** The user's role at this dealer: 'staff' for eShield staff, else their dealer_users role, else null. */
export async function roleAt(db, user, dealerId) {
  if (user.is_staff) return 'staff';
  const [rows] = await db.query('SELECT role FROM dealer_users WHERE dealer_id = ? AND user_id = ?', [dealerId, user.id]);
  return rows[0]?.role ?? null;
}

/** True when `role` is at least `minimum` (staff passes everything). */
export function atLeast(role, minimum) {
  if (role === 'staff') return true;
  const i = ROLES.indexOf(role);
  return i !== -1 && i <= ROLES.indexOf(minimum);
}

export async function dealersFor(db, user) {
  if (user.is_staff) {
    const [rows] = await db.query("SELECT id, name, slug, status, 'staff' AS role FROM dealers ORDER BY name");
    return rows;
  }
  const [rows] = await db.query(
    'SELECT d.id, d.name, d.slug, d.status, du.role FROM dealer_users du JOIN dealers d ON d.id = du.dealer_id WHERE du.user_id = ? ORDER BY d.name',
    [user.id],
  );
  return rows;
}

export async function dealerMembers(db, dealerId) {
  const [rows] = await db.query(
    'SELECT u.id, u.email, u.name, u.status, du.role FROM dealer_users du JOIN users u ON u.id = du.user_id WHERE du.dealer_id = ? ORDER BY u.email',
    [dealerId],
  );
  return rows;
}

export async function ownerCount(db, dealerId) {
  const [rows] = await db.query("SELECT COUNT(*) AS n FROM dealer_users WHERE dealer_id = ? AND role = 'owner'", [dealerId]);
  return Number(rows[0].n);
}

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, is_staff: !!u.is_staff });
