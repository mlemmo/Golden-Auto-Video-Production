// Website pulls: the portal reads a dealer's website and keeps the cars (our server never holds a dealer's whole
// inventory or its photos). SiteGround stops long-running work, so a pull reads a few vehicle pages per request and
// remembers its place in website_pulls; the customer's page keeps asking for the next batch until it is done.
// Readers come from shared/ (the same code as the video app). Today only Dealer Car Search sites can be read; other
// sites, and sites that block us, are imported by eShield staff from a browser snapshot (snapshotCars).
import { tx, json } from './db.js';
import { HttpError } from './errors.js';
import { normalPulled, upsertPulled } from './vehicles.js';
import { clientAnalyze } from '../../../shared/website.js';
import { dcsVehiclePages, dcsParseVdp, dcsPageError } from '../../../shared/dcs.js';

export const PAGES_PER_BATCH = 4;
const CLAIM_SECONDS = 120;
const MAX_ERRORS = 50;
const parsed = (v, fallback) => (v === null || v === undefined ? fallback : typeof v === 'string' ? JSON.parse(v) : v);

export function pullView(p) {
  if (!p) return null;
  const pages = parsed(p.pages_json, []);
  return { id: p.id, status: p.status, message: p.message, website: p.website, total: pages.length, done: Math.min(p.next_index, pages.length),
    added: p.added, changed: p.changed, gone: p.gone, errors: parsed(p.errors_json, []), created_at: p.created_at, finished_at: p.finished_at };
}

export async function latestPull(db, dealerId) {
  const [rows] = await db.query('SELECT * FROM website_pulls WHERE dealer_id = ? ORDER BY id DESC LIMIT 1', [dealerId]);
  return rows[0] ?? null;
}

const WE_IMPORT = 'We will import your cars for you; eShield has been told.';

/**
 * Checks the dealer's website and starts a pull. A pull already running is returned instead. A site we cannot read
 * gets a 'blocked' pull with a message (staff see it in the dealer's pulls and import a snapshot).
 */
export async function startPull(pool, dealer, user, siteFetch) {
  if (!dealer.website) throw new HttpError(400, 'Your dealer has no website saved. Ask eShield to add it.');
  const running = await latestPull(pool, dealer.id);
  if (running?.status === 'running') return running;
  const insert = async (status, message, pages = null) => {
    const [r] = await pool.query(
      'INSERT INTO website_pulls (dealer_id, started_by, website, status, message, pages_json, finished_at) VALUES (?,?,?,?,?,?,?)',
      [dealer.id, user.id, dealer.website, status, message, json(pages), status === 'running' ? null : new Date()]);
    const [rows] = await pool.query('SELECT * FROM website_pulls WHERE id = ?', [r.insertId]);
    return rows[0];
  };
  const analysis = await clientAnalyze(dealer.website, siteFetch);
  if (analysis.blocked) return insert('blocked', `Your website blocks automatic reading. ${WE_IMPORT}`);
  if (!analysis.reachable) return insert('failed', 'Your website could not be reached. Check that it is up and try again.');
  if (analysis.platform !== 'Dealer Car Search') {
    return insert('blocked', `We can't read ${analysis.platform ? analysis.platform + ' websites' : 'this kind of website'} automatically yet. ${WE_IMPORT}`);
  }
  let pages;
  try {
    pages = await dcsVehiclePages(dealer.website, analysis.sitemap, siteFetch);
  } catch (err) {
    return insert('failed', err.message);
  }
  return insert('running', null, pages);
}

/** A car read from a Dealer Car Search page, in the portal's shape. */
function carFromDcs(v) {
  return { vin: v.Vin, stock_no: v.StockNumber, year: v.Year, make: v.Make, model: v.Model, trim: v.Trim, color: v.ExteriorColor,
    drivetrain: v.Drivetrain, mileage: v.Odometer, price: v.price, description: v.description, page_url: v.url, photos: v.photo_sources };
}

/**
 * Reads the next few pages of a running pull and saves their cars. Only one request works on a pull at a time; a
 * second one gets the pull as it is. When the last page is read, website cars the pull did not find are marked
 * "not on your website anymore" (missing_since), never deleted.
 */
export async function continuePull(pool, dealerId, pullId, siteFetch, batch = PAGES_PER_BATCH) {
  const [claim] = await pool.query(
    `UPDATE website_pulls SET claimed_until = NOW(3) + INTERVAL ${CLAIM_SECONDS} SECOND
      WHERE id = ? AND dealer_id = ? AND status = 'running' AND (claimed_until IS NULL OR claimed_until < NOW(3))`,
    [Number(pullId) || 0, dealerId]);
  const [rows] = await pool.query('SELECT * FROM website_pulls WHERE id = ? AND dealer_id = ?', [Number(pullId) || 0, dealerId]);
  const pull = rows[0];
  if (!pull) throw new HttpError(404, 'Pull not found.');
  if (!claim.affectedRows) return pull;

  const pages = parsed(pull.pages_json, []);
  const seen = new Set(parsed(pull.seen_json, []));
  const errors = parsed(pull.errors_json, []);
  const cars = [];
  for (const url of pages.slice(pull.next_index, pull.next_index + batch)) {
    const r = await siteFetch(url);
    if ((r.code ?? 0) !== 200) { errors.push(dcsPageError(url, 'could not be loaded (HTTP ' + (r.code ?? 0) + ')')); continue; }
    try {
      const car = normalPulled(carFromDcs(dcsParseVdp(String(r.body), url)));
      if (!seen.has(car.vin) && !cars.some((c) => c.vin === car.vin)) cars.push(car);
    } catch (err) {
      errors.push(err.status === 400 ? dcsPageError(url, 'has no VIN, so it was skipped') : dcsPageError(url, 'has no year, make or model on the site (it may have been sold)'));
    }
  }
  const next = Math.min(pull.next_index + batch, pages.length);
  const finished = next >= pages.length;
  await tx(pool, async (conn) => {
    const { added, changed, vins } = await upsertPulled(conn, dealerId, cars, 'website');
    for (const v of vins) seen.add(v);
    let gone = 0;
    if (finished) {
      const list = [...seen];
      const [g] = await conn.query(
        `UPDATE vehicles SET missing_since = NOW(3) WHERE dealer_id = ? AND source = 'website' AND status = 'active' AND missing_since IS NULL${list.length ? ' AND vin NOT IN (?)' : ''}`,
        list.length ? [dealerId, list] : [dealerId]);
      gone = g.affectedRows;
    }
    await conn.query(
      `UPDATE website_pulls SET next_index = ?, seen_json = ?, errors_json = ?, added = added + ?, changed = changed + ?, gone = ?, claimed_until = NULL,
              status = ?, finished_at = ? WHERE id = ?`,
      [next, json([...seen]), json(errors.slice(0, MAX_ERRORS)), added, changed, gone, finished ? 'done' : 'running', finished ? new Date() : null, pull.id]);
  });
  const [after] = await pool.query('SELECT * FROM website_pulls WHERE id = ?', [pull.id]);
  return after[0];
}

/**
 * Cars from the browser snapshot reader (tools/inventory-snapshot.js, docs/INVENTORY_SYNC.md) in the portal's shape,
 * for sites that block us. Cars without a VIN, and stock-number-only entries, are listed as skipped.
 */
export function snapshotCars(snapshot) {
  if (!Array.isArray(snapshot) || !snapshot.length) throw new HttpError(400, 'Send the snapshot: a list of cars.');
  const cars = [], skipped = [];
  for (const s of snapshot) {
    const stock = String(s?.stock ?? '').trim();
    if (s?.list_only === true) { skipped.push(`${stock || 'A car'}: only its stock number is known yet`); continue; }
    if (!s?.vin) { skipped.push(`${stock || 'A car'}: no VIN`); continue; }
    const prices = (Array.isArray(s.prices) ? s.prices : [s.price]).map(Number).filter((p) => Number.isFinite(p) && p > 0);
    cars.push({ vin: s.vin, stock_no: stock, year: s.year, make: s.make, model: s.model, trim: s.trim, color: s.color, drivetrain: s.drivetrain,
      mileage: s.mileage, price: prices.length ? Math.max(...prices) : null, description: s.description, page_url: s.page_url,
      photos: Array.isArray(s.photo_urls) ? s.photo_urls : [], keep_photos: s.keep_photos === true || !Array.isArray(s.photo_urls) });
  }
  return { cars, skipped };
}
