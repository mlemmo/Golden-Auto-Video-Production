// Inventory pushed by the worker after a DMS pull: upsert by dealer + VIN; with `complete`, active cars missing
// from the list are marked sold. Milestone 2 enqueues render jobs for new or changed cars.
import { createHash } from 'node:crypto';
import { tx, json } from './db.js';
import { HttpError } from './errors.js';

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const int = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const text = (v, max) => (v === null || v === undefined ? null : String(v).slice(0, max));

export function normalVehicle(v) {
  const vin = String(v?.vin ?? '').trim().toUpperCase();
  if (!VIN.test(vin)) throw new HttpError(400, `Invalid VIN: ${String(v?.vin ?? '').slice(0, 20)}`);
  const out = {
    vin, stock_no: text(v.stock_no, 40), year: int(v.year), make: text(v.make, 60), model: text(v.model, 80), trim: text(v.trim, 120),
    mileage: int(v.mileage), price: int(v.price), photos: Array.isArray(v.photos) ? v.photos.map(String) : [],
    features: Array.isArray(v.features) ? v.features.map(String) : [],
  };
  out.source_hash = createHash('sha256').update(JSON.stringify(out)).digest('hex');
  return out;
}

export async function syncInventory(pool, dealerId, vehicles, { complete = false } = {}) {
  if (!Array.isArray(vehicles)) throw new HttpError(400, 'vehicles must be a list');
  const list = vehicles.map(normalVehicle);
  return tx(pool, async (conn) => {
    const [existing] = await conn.query('SELECT vin, source_hash, status FROM vehicles WHERE dealer_id = ? FOR UPDATE', [dealerId]);
    const before = new Map(existing.map((r) => [r.vin, r]));
    let added = 0, changed = 0;
    for (const v of list) {
      const old = before.get(v.vin);
      if (!old) added++;
      else if (old.source_hash !== v.source_hash || old.status !== 'active') changed++;
      await conn.query(
        `INSERT INTO vehicles (dealer_id, vin, stock_no, year, make, model, trim, mileage, price, status, photos_json, features_json, source_hash, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?, NOW(3))
         ON DUPLICATE KEY UPDATE stock_no = VALUES(stock_no), year = VALUES(year), make = VALUES(make), model = VALUES(model),
           trim = VALUES(trim), mileage = VALUES(mileage), price = VALUES(price), status = 'active', photos_json = VALUES(photos_json),
           features_json = VALUES(features_json), source_hash = VALUES(source_hash), last_seen_at = NOW(3)`,
        [dealerId, v.vin, v.stock_no, v.year, v.make, v.model, v.trim, v.mileage, v.price, json(v.photos), json(v.features), v.source_hash]);
    }
    let sold = 0;
    if (complete) {
      const vins = list.map((v) => v.vin);
      const [r] = await conn.query(
        `UPDATE vehicles SET status = 'sold' WHERE dealer_id = ? AND status = 'active'${vins.length ? ' AND vin NOT IN (?)' : ''}`,
        vins.length ? [dealerId, vins] : [dealerId]);
      sold = r.affectedRows;
    }
    return { received: list.length, added, changed, sold };
  });
}
