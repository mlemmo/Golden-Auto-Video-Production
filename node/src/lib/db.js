// Data layer: the same SQLite file and tables as the PHP dashboard (private/app.php db/state/save), shared by both
// while areas move over. Node's built-in node:sqlite, no npm dependency. Rows are written as PHP would write them
// (phpjson.js), so PHP keeps reading them unchanged.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { phpJsonEncode } from './phpjson.js';

const cache = new Map();

/** db($cfg): opens <data_dir>/agent.sqlite (created 0700 like PHP) and makes sure both tables exist. */
export function openDb(cfg) {
  const dir = String(cfg.data_dir ?? '');
  if (!dir) throw new Error('data_dir missing from config');
  const file = dir + '/agent.sqlite';
  if (cache.has(file)) return cache.get(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  // PHP's PDO opens the file with a busy timeout too; wait rather than fail while the other side writes.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)');
  cache.set(file, db);
  return db;
}
/** A throw-away in-memory database with the same tables (tests and parity cases). */
export function openMemoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE state (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE jobs (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)');
  return db;
}
export function closeDb(cfg) {
  const file = String(cfg.data_dir) + '/agent.sqlite';
  cache.get(file)?.close();
  cache.delete(file);
}

/** state($db, $id): the saved row, or null. */
export function state(db, id) {
  const row = db.prepare('SELECT payload FROM state WHERE id = ?').get(id);
  return row ? JSON.parse(row.payload) : null;
}
/** save($db, $id, $data) */
export function save(db, id, data) {
  db.prepare('INSERT OR REPLACE INTO state VALUES (?, ?)').run(id, phpJsonEncode(data));
}
/** Ids of state rows starting with a prefix (e.g. "inventory:"). */
export function stateIds(db, prefix) {
  return db.prepare('SELECT id FROM state WHERE id LIKE ? ESCAPE \'\\\'').all(prefix.replace(/[\\%_]/g, '\\$&') + '%').map((r) => r.id);
}
/** Does any state row's JSON contain this text (used before deleting a shared photo file)? */
export function stateMentions(db, text) {
  return db.prepare('SELECT COUNT(*) AS n FROM state WHERE instr(payload, ?) > 0').get(text).n > 0;
}

// Jobs (video jobs): id, unique fingerprint (duplicate paid-request protection, may be null), JSON payload.
export function jobGet(db, id) {
  const row = db.prepare('SELECT payload FROM jobs WHERE id = ?').get(id);
  return row ? JSON.parse(row.payload) : null;
}
export function jobInsert(db, id, fingerprint, payload) {
  db.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run(id, fingerprint ?? null, phpJsonEncode(payload));
}
export function jobSave(db, job) {
  db.prepare('UPDATE jobs SET payload = ? WHERE id = ?').run(phpJsonEncode(job), job.id);
}
/** Newest first, like ORDER BY rowid DESC. */
export function jobsList(db, limit = 30) {
  return db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT ?').all(limit).map((r) => JSON.parse(r.payload));
}
