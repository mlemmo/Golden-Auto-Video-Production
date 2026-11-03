// Orders: a dealer's own orders (customers), and every dealer's orders for eShield staff, who release an order as paid
// until payment is built (Milestone 3). Lists refresh every 10 seconds (SiteGround has no WebSockets).
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export const ORDER_STATUS = {
  awaiting_payment: 'Awaiting payment', paid: 'Paid', in_progress: 'In progress', ready_for_review: 'Ready for review',
  approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
const POLL_MS = 10000;
const when = (t) => (t ? new Date(t).toLocaleString() : '');
export const carTitle = (v) => [v?.year, v?.make, v?.model, v?.trim].filter(Boolean).join(' ') || v?.vin || 'Car';
export const StatusPill = ({ status }) => <span className={`pill order-${status}`}>{ORDER_STATUS[status] ?? status}</span>;

function usePolled(path) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api('GET', path).then((d) => { setRows(d.orders); setError(''); }, (e) => setError(e.message)), [path]);
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);
  return { rows, error, setError, load };
}

export function Orders({ dealerId, canOrder }) {
  const { rows, error, setError, load } = usePolled(`/api/dealers/${dealerId}/orders`);
  async function cancel(o) {
    try { await api('POST', `/api/dealers/${dealerId}/orders/${o.id}/cancel`, {}); load(); } catch (e) { setError(e.message); }
  }
  return (
    <section className="card">
      <h2>Orders</h2>
      <p className="muted small">Order a video from a car on the Cars tab. Payment comes next; until then eShield starts paid orders by hand.</p>
      {error && <p className="error">{error}</p>}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No orders yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Car</th><th>Video</th><th>Status</th><th>Ordered</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{carTitle(o.vehicle)}{o.notes && <div className="muted small">{o.notes}</div>}</td>
              <td>{o.product_name}, {o.length_s} s</td>
              <td><StatusPill status={o.status} /></td>
              <td>{when(o.created_at)}<div className="muted small">{o.ordered_by_email}</div></td>
              <td>{canOrder && o.status === 'awaiting_payment' && <button className="link" onClick={() => cancel(o)}>Cancel</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

const STAFF_FILTERS = [['awaiting_payment,paid,in_progress', 'Open orders'], ['awaiting_payment', 'Awaiting payment'], ['paid', 'Paid, not started'], ['in_progress', 'In progress'], ['', 'All orders']];

export function StaffOrders() {
  const [filter, setFilter] = useState(STAFF_FILTERS[0][0]);
  const { rows, error, setError, load } = usePolled(`/api/staff/orders${filter ? `?status=${filter}` : ''}`);
  async function act(o, what) {
    try {
      if (what === 'release') await api('POST', `/api/staff/orders/${o.id}/release`, {});
      else await api('POST', `/api/dealers/${o.dealer_id}/orders/${o.id}/cancel`, {});
      load();
    } catch (e) { setError(e.message); }
  }
  return (
    <section className="card">
      <div className="row">
        <h2>All orders</h2>
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {STAFF_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <p className="muted small">Paid orders also appear under Orders in the video studio, where "Open in studio" copies the car there.</p>
      {error && <p className="error">{error}</p>}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No orders here.</p> : (
        <table>
          <thead><tr><th>#</th><th>Dealer</th><th>Car</th><th>Video</th><th>Status</th><th>Ordered</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.dealer_name}</td>
              <td>{carTitle(o.vehicle)}<div className="muted small">VIN {o.vehicle?.vin} · {o.vehicle?.photos?.length ?? 0} photos</div>{o.notes && <div className="muted small">{o.notes}</div>}</td>
              <td>{o.product_name}, {o.length_s} s</td>
              <td><StatusPill status={o.status} />{o.studio_ref && <div className="muted small">{o.studio_ref}</div>}</td>
              <td>{when(o.created_at)}<div className="muted small">{o.ordered_by_email}</div></td>
              <td className="nowrap">
                {o.status === 'awaiting_payment' && <button className="small" onClick={() => act(o, 'release')}>Release as paid</button>}
                {['awaiting_payment', 'paid', 'in_progress'].includes(o.status) && <button className="link" onClick={() => act(o, 'cancel')}>Cancel</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
