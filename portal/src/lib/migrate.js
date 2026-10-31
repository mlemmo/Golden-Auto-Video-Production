// Applies migrations/NNN_name.sql in order, once each, recorded in schema_migrations.
import mysql from 'mysql2/promise';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTAL_DIR } from './config.js';

export const MIGRATIONS_DIR = join(PORTAL_DIR, 'migrations');

export async function migrate(url, dir = MIGRATIONS_DIR) {
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))');
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const applied = [];
    for (const name of readdirSync(dir).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort()) {
      if (done.has(name)) continue;
      await conn.query(readFileSync(join(dir, name), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
      applied.push(name);
    }
    return applied;
  } finally {
    await conn.end();
  }
}

/** Tests only: drops every table in the database behind url, then migrates from scratch. */
export async function resetDatabase(url) {
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
    if (tables.length) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0; ' + tables.map((r) => `DROP TABLE \`${r.t}\`;`).join(' ') + ' SET FOREIGN_KEY_CHECKS = 1;');
    }
  } finally {
    await conn.end();
  }
  return migrate(url);
}
