// MySQL access through a mysql2 pool. Every connection runs in UTC; DATETIME values come back as Date objects.
import mysql from 'mysql2/promise';

export function createPool(url, options = {}) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = mysql.createPool({ uri: url, timezone: 'Z', supportBigNumbers: true, connectionLimit: 5, ...options });
  pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  return pool;
}

/** Runs fn(conn) inside a transaction: committed when it returns, rolled back when it throws. */
export async function tx(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
