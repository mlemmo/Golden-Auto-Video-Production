// Inventory pushed by the worker after a DMS pull: upsert by dealer + VIN (lib/vehicles.js keeps the customer's own
// edits); with `complete`, active DMS cars missing from the list are marked sold.
import { tx } from './db.js';
import { HttpError } from './errors.js';
import { normalPulled, upsertPulled } from './vehicles.js';

export { normalPulled as normalVehicle };

export async function syncInventory(pool, dealerId, vehicles, { complete = false } = {}) {
  if (!Array.isArray(vehicles)) throw new HttpError(400, 'vehicles must be a list');
  const list = vehicles.map(normalPulled);
  return tx(pool, async (conn) => {
    const { added, changed, vins } = await upsertPulled(conn, dealerId, list, 'dms');
    let sold = 0;
    if (complete) {
      const [r] = await conn.query(
        `UPDATE vehicles SET status = 'sold' WHERE dealer_id = ? AND status = 'active' AND source = 'dms'${vins.length ? ' AND vin NOT IN (?)' : ''}`,
        vins.length ? [dealerId, vins] : [dealerId]);
      sold = r.affectedRows;
    }
    return { received: list.length, added, changed, sold };
  });
}
