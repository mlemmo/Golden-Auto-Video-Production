// Video orders. /api/dealers/:dealerId/orders: viewers see the dealer's orders; owners and admins place and cancel
// them (orders will cost money from Milestone 3). /api/staff/orders: eShield staff see every dealer's orders and, until
// payment is built, release an order as paid.
import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { accessChecks } from '../lib/access.js';
import { getOrder, listOrders, moveOrder, orderView, placeOrder, PRODUCTS, statusFilter } from '../lib/orders.js';

export function orderRoutes({ pool }) {
  const r = Router();
  const { dealerAccess } = accessChecks(pool);

  r.get('/:dealerId/products', async (req, res) => {
    await dealerAccess(req, 'viewer');
    res.json({ products: PRODUCTS });
  });

  r.get('/:dealerId/orders', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ orders: (await listOrders(pool, { dealerId: dealer.id, statuses: statusFilter(req.query.status) })).map(orderView) });
  });

  r.post('/:dealerId/orders', async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'admin');
    const id = await placeOrder(pool, dealer, user, req.body);
    const order = await getOrder(pool, id, dealer.id);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'order_place', targetType: 'order', targetId: id, details: { product: order.product, length_s: order.length_s, vehicle_id: order.vehicle_id }, ip: req.ip });
    res.status(201).json({ order: orderView(order) });
  });

  r.get('/:dealerId/orders/:orderId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ order: orderView(await getOrder(pool, req.params.orderId, dealer.id)) });
  });

  // Customers cancel before payment; staff can cancel any order that has not been delivered yet.
  r.post('/:dealerId/orders/:orderId/cancel', async (req, res) => {
    const { user, dealer, role } = await dealerAccess(req, 'admin');
    const order = await getOrder(pool, req.params.orderId, dealer.id);
    const from = role === 'staff' ? ['awaiting_payment', 'paid', 'in_progress'] : ['awaiting_payment'];
    await moveOrder(pool, order.id, from, 'cancelled', {}, role === 'staff' ? 'This order can no longer be cancelled.' : 'Paid orders can only be cancelled by eShield. Contact us.');
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'order_cancel', targetType: 'order', targetId: order.id, details: { from: order.status }, ip: req.ip });
    res.json({ order: orderView(await getOrder(pool, order.id, dealer.id)) });
  });

  return r;
}

export function staffRoutes({ pool }) {
  const r = Router();
  const { staffOnly } = accessChecks(pool);

  r.get('/orders', async (req, res) => {
    staffOnly(req);
    res.json({ orders: (await listOrders(pool, { statuses: statusFilter(req.query.status) })).map(orderView) });
  });

  r.get('/orders/:orderId', async (req, res) => {
    staffOnly(req);
    res.json({ order: orderView(await getOrder(pool, req.params.orderId)) });
  });

  // Stands in for payment until Stripe (Milestone 3).
  r.post('/orders/:orderId/release', async (req, res) => {
    const user = staffOnly(req);
    const order = await getOrder(pool, req.params.orderId);
    await moveOrder(pool, order.id, ['awaiting_payment'], 'paid', { paid_via: 'staff', paid_at: new Date() }, 'Only orders awaiting payment can be released.');
    await audit(pool, { dealerId: order.dealer_id, userId: user.id, action: 'order_release', targetType: 'order', targetId: order.id, ip: req.ip });
    res.json({ order: orderView(await getOrder(pool, order.id)) });
  });

  return r;
}
