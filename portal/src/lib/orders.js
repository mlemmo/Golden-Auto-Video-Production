// Video orders (approved plan, Milestone 2). An order freezes the car as it was ordered; the video is made from that
// copy. Status: awaiting_payment → paid → in_progress → ready_for_review → approved / rejected, or cancelled.
// Until Stripe (Milestone 3), eShield staff release an order by hand (paid_via 'staff').
import { json, tx } from './db.js';
import { HttpError } from './errors.js';
import { getVehicle, vehicleSnapshot } from './vehicles.js';

export const PRODUCTS = {
  ai_video: { name: 'AI spokesperson video', lengths: [15, 30] },
  slideshow: { name: 'Photo slideshow', lengths: [15, 30, 60] },
};
export const STATUSES = ['awaiting_payment', 'paid', 'in_progress', 'ready_for_review', 'approved', 'rejected', 'cancelled'];
const MAX_NOTES = 2000;

const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Public shape of an order (the car as ordered, without the database's JSON column name). */
export function orderView(o) {
  const { vehicle_snapshot_json, ...rest } = o;
  return { ...rest, product_name: PRODUCTS[o.product]?.name ?? o.product, vehicle: parsed(vehicle_snapshot_json) };
}

export async function placeOrder(db, dealer, user, input) {
  const product = String(input?.product ?? '');
  const length = Number(input?.length_s);
  if (!PRODUCTS[product]) throw new HttpError(400, 'Choose a video type.');
  if (!PRODUCTS[product].lengths.includes(length)) throw new HttpError(400, `Choose a length: ${PRODUCTS[product].lengths.join(', ')} seconds.`);
  const notes = String(input?.notes ?? '').trim();
  if (notes.length > MAX_NOTES) throw new HttpError(400, `Notes can be up to ${MAX_NOTES} characters.`);
  const vehicle = await getVehicle(db, dealer.id, input?.vehicle_id);
  if (!vehicle.photos.length) throw new HttpError(400, 'Add at least one photo of this car before ordering a video.');
  const [r] = await db.query(
    'INSERT INTO orders (dealer_id, vehicle_id, product, length_s, notes, vehicle_snapshot_json, ordered_by) VALUES (?,?,?,?,?,?,?)',
    [dealer.id, vehicle.id, product, length, notes || null, json(vehicleSnapshot(vehicle)), user.id]);
  return r.insertId;
}

export async function getOrder(db, id, dealerId = null) {
  const [rows] = await db.query(
    `SELECT o.*, d.name AS dealer_name, d.slug AS dealer_slug, d.website AS dealer_website, u.email AS ordered_by_email
       FROM orders o JOIN dealers d ON d.id = o.dealer_id LEFT JOIN users u ON u.id = o.ordered_by
      WHERE o.id = ?${dealerId === null ? '' : ' AND o.dealer_id = ?'}`,
    dealerId === null ? [Number(id) || 0] : [Number(id) || 0, dealerId]);
  if (!rows.length) throw new HttpError(404, 'Order not found.');
  return rows[0];
}

/** Orders of one dealer, or (dealerId null, staff) of every dealer; optionally only some statuses. */
export async function listOrders(db, { dealerId = null, statuses = null, limit = 200 } = {}) {
  const where = [], args = [];
  if (dealerId !== null) { where.push('o.dealer_id = ?'); args.push(dealerId); }
  if (statuses?.length) { where.push('o.status IN (?)'); args.push(statuses); }
  const [rows] = await db.query(
    `SELECT o.*, d.name AS dealer_name, d.slug AS dealer_slug, d.website AS dealer_website, u.email AS ordered_by_email
       FROM orders o JOIN dealers d ON d.id = o.dealer_id LEFT JOIN users u ON u.id = o.ordered_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ?`,
    [...args, limit]);
  return rows;
}

/** Statuses from a query such as ?status=paid,in_progress (unknown ones refused). */
export function statusFilter(value) {
  if (value === undefined || value === '') return null;
  const list = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  if (list.some((s) => !STATUSES.includes(s))) throw new HttpError(400, `Unknown status. Use: ${STATUSES.join(', ')}.`);
  return list;
}

/**
 * Moves an order from one of `from` to `to` in one step (two clicks or two workers cannot both do it); extra columns
 * are set at the same time. Returns the order, or throws 409 with `conflict` when it is in another status.
 */
export async function moveOrder(pool, id, from, to, extra = {}, conflict = 'This order has moved on; reload to see where it is.') {
  return tx(pool, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Order not found.');
    if (!from.includes(rows[0].status)) throw new HttpError(409, conflict);
    const cols = Object.keys(extra);
    await conn.query(`UPDATE orders SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`, [to, ...cols.map((c) => extra[c]), id]);
    return { ...rows[0], status: to, ...extra };
  });
}
