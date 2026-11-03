// The video studio's clients (its dealers), mirrored here so eShield staff can add them to the portal with one click.
// The studio sends its whole list over the signed worker API whenever it starts, its clients change, or staff open its
// Orders window; the answer tells it which portal dealer each client is linked to.
import { tx } from './db.js';
import { HttpError } from './errors.js';
import { cleanDealer } from './dealers.js';

const text = (v, max) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

/** Saves the studio's list; an unlinked client whose name matches an unlinked dealer is linked. Returns { links }. */
export async function syncStudioClients(pool, clients) {
  if (!Array.isArray(clients) || clients.length > 500) throw new HttpError(400, 'Send the studio clients as a list.');
  const list = clients.map((c) => ({
    client_id: String(c?.id ?? '').slice(0, 40), name: text(c?.name, 190), website: null, city: text(c?.city, 80), state: text(c?.state, 40),
    phone: text(c?.phone, 40), car_count: Number.isInteger(c?.car_count) && c.car_count >= 0 ? c.car_count : null, raw_website: c?.website,
    portal_dealer_id: Number.isSafeInteger(c?.portal_dealer_id) ? c.portal_dealer_id : null,
  })).filter((c) => /^[a-z0-9-]{1,40}$/.test(c.client_id) && c.name);
  for (const c of list) {
    try { c.website = cleanDealer({ website: c.raw_website }).website ?? null; } catch { c.website = null; }
  }
  return tx(pool, async (conn) => {
    for (const c of list) {
      await conn.query(
        `INSERT INTO studio_clients (client_id, name, website, city, state, phone, car_count, gone_at) VALUES (?,?,?,?,?,?,?,NULL)
         ON DUPLICATE KEY UPDATE name = VALUES(name), website = VALUES(website), city = VALUES(city), state = VALUES(state),
           phone = VALUES(phone), car_count = VALUES(car_count), gone_at = NULL`,
        [c.client_id, c.name, c.website, c.city, c.state, c.phone, c.car_count]);
    }
    const ids = list.map((c) => c.client_id);
    await conn.query(`UPDATE studio_clients SET gone_at = NOW(3) WHERE gone_at IS NULL${ids.length ? ' AND client_id NOT IN (?)' : ''}`, ids.length ? [ids] : []);
    // A link the studio already made (it opened an order of that dealer) is kept here too.
    const linked = async (dealerId) => (await conn.query('SELECT 1 FROM studio_clients WHERE dealer_id = ?', [dealerId]))[0].length > 0;
    for (const c of list.filter((x) => x.portal_dealer_id)) {
      const [[row]] = await conn.query('SELECT dealer_id FROM studio_clients WHERE client_id = ?', [c.client_id]);
      const [exists] = await conn.query('SELECT 1 FROM dealers WHERE id = ?', [c.portal_dealer_id]);
      if (!row.dealer_id && exists.length && !(await linked(c.portal_dealer_id))) await conn.query('UPDATE studio_clients SET dealer_id = ? WHERE client_id = ?', [c.portal_dealer_id, c.client_id]);
    }
    // A dealer staff already typed in by hand, with the same name, is the same dealer.
    const [open] = await conn.query('SELECT client_id, name FROM studio_clients WHERE dealer_id IS NULL AND gone_at IS NULL');
    for (const c of open) {
      const [match] = await conn.query(
        'SELECT d.id FROM dealers d WHERE LOWER(d.name) = LOWER(?) AND d.id NOT IN (SELECT dealer_id FROM studio_clients WHERE dealer_id IS NOT NULL) ORDER BY d.id LIMIT 1',
        [c.name]);
      if (match.length) await conn.query('UPDATE studio_clients SET dealer_id = ? WHERE client_id = ?', [match[0].id, c.client_id]);
    }
    const [rows] = await conn.query('SELECT client_id, dealer_id FROM studio_clients WHERE dealer_id IS NOT NULL AND gone_at IS NULL');
    return { links: Object.fromEntries(rows.map((r) => [r.client_id, r.dealer_id])) };
  });
}

export async function listStudioClients(db) {
  const [rows] = await db.query(
    `SELECT s.*, d.name AS dealer_name FROM studio_clients s LEFT JOIN dealers d ON d.id = s.dealer_id
      WHERE s.gone_at IS NULL ORDER BY s.dealer_id IS NOT NULL, s.name`);
  return rows;
}

/** Adds a studio client as a portal dealer (short name: its studio id, or with -2, -3… when taken) and links them. */
export async function addStudioClient(pool, clientId) {
  return tx(pool, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM studio_clients WHERE client_id = ? AND gone_at IS NULL FOR UPDATE', [String(clientId)]);
    const c = rows[0];
    if (!c) throw new HttpError(404, 'That studio client is not in the list any more. Reload.');
    if (c.dealer_id) throw new HttpError(409, 'This studio client is already on the portal.');
    let slug = c.client_id, n = 2;
    while ((await conn.query('SELECT 1 FROM dealers WHERE slug = ?', [slug]))[0].length) slug = `${c.client_id}-${n++}`.slice(0, 80);
    const [r] = await conn.query('INSERT INTO dealers (name, slug, website, city, state, phone) VALUES (?,?,?,?,?,?)', [c.name, slug, c.website, c.city, c.state, c.phone]);
    await conn.query('UPDATE studio_clients SET dealer_id = ? WHERE client_id = ?', [r.insertId, c.client_id]);
    return { id: r.insertId, name: c.name, slug, website: c.website, status: 'active' };
  });
}
