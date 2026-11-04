// Orders: a dealer's own orders (customers), and every dealer's orders for eShield staff, who release an order as paid
// until payment is built (Milestone 3). Lists refresh every 10 seconds (SiteGround has no WebSockets).
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export const ORDER_STATUS = {
  awaiting_payment: 'Awaiting payment', paid: 'Paid', in_progress: 'In progress', ready_for_review: 'Ready for your review',
  approved: 'Approved', rejected: 'Changes asked: eShield will contact you', cancelled: 'Cancelled',
};
const FORMAT = { instagram_reels: 'Vertical 9:16 (Reels, Stories, TikTok)', facebook_reels: 'Vertical 9:16', facebook_feed: 'Feed 4:5', youtube: 'Wide 16:9 (YouTube)', square: 'Square 1:1' };
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

/** An order's videos (once sent) with Approve and Ask for changes, and what happened so far. */
function OrderDetail({ dealerId, o, canOrder, onChanged }) {
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function answer(path, body) {
    setBusy(true); setError('');
    try { await api('POST', `/api/dealers/${dealerId}/orders/${o.id}/${path}`, body); setAsking(false); setReason(''); onChanged(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const reviewing = o.status === 'ready_for_review';
  return (
    <div className="order-detail">
      {o.remake && <p className="note small">You asked for changes: “{o.remake.reason}”. We are making the new version.</p>}
      {o.status === 'rejected' && <p className="note small">You asked for changes again: “{o.rejections.at(-1)?.reason}”. eShield will contact you about the next step.</p>}
      {o.videos.length === 0 ? <p className="muted small">Your video appears here when it is ready.</p> : (
        <div className="video-grid">
          {o.videos.map((v) => (
            <figure key={v.job_id}>
              <video src={v.url} poster={v.poster ?? undefined} controls preload="none" playsInline />
              <figcaption>{FORMAT[v.format] ?? v.format}{v.duration ? ` · ${v.duration} s` : ''} · <a href={v.url} target="_blank" rel="noreferrer">Open to download</a></figcaption>
            </figure>
          ))}
        </div>
      )}
      {o.delivered_at && <p className="muted small">Sent {when(o.delivered_at)}{o.approved_at ? ` · approved ${when(o.approved_at)} by ${o.approved_by}` : ''}</p>}
      {reviewing && canOrder && !asking && (
        <div className="actions">
          <button disabled={busy} onClick={() => answer('approve', {})}>Approve</button>
          <button className="secondary" disabled={busy} onClick={() => setAsking(true)}>Ask for changes</button>
          <span className="muted small">{o.free_remakes_left > 0 ? 'One remake is included.' : 'Further changes are arranged with eShield.'}</span>
        </div>
      )}
      {asking && (
        <div className="form">
          <label>What should change?<textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the price should be $14,995; leave out the interior photos" autoFocus /></label>
          <div className="actions">
            <button disabled={busy || !reason.trim()} onClick={() => answer('reject', { reason })}>Send</button>
            <button className="link" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function Orders({ dealerId, canOrder }) {
  const { rows, error, setError, load } = usePolled(`/api/dealers/${dealerId}/orders`);
  const [openId, setOpenId] = useState(null);
  async function cancel(o) {
    try { await api('POST', `/api/dealers/${dealerId}/orders/${o.id}/cancel`, {}); load(); } catch (e) { setError(e.message); }
  }
  return (
    <section className="card">
      <h2>Orders</h2>
      <p className="muted small">Order a video from a car on the Cars tab. When it is ready it appears here to watch: approve it, or ask for changes (one remake is included).</p>
      {error && <p className="error">{error}</p>}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No orders yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Car</th><th>Video</th><th>Status</th><th>Ordered</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <Fragment key={o.id}>
              <tr className={o.status === 'ready_for_review' ? 'attention' : undefined}>
                <td>{o.id}</td>
                <td>{carTitle(o.vehicle)}{o.notes && <div className="muted small">{o.notes}</div>}</td>
                <td>{o.product_name}, {o.length_s} s</td>
                <td><StatusPill status={o.status} />{o.remake && <div className="muted small">Remake in progress</div>}</td>
                <td>{when(o.created_at)}<div className="muted small">{o.ordered_by_email}</div></td>
                <td className="nowrap">
                  <button className="link" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{openId === o.id ? 'Hide' : o.status === 'ready_for_review' ? 'Review' : 'View'}</button>
                  {canOrder && o.status === 'awaiting_payment' && <button className="link" onClick={() => cancel(o)}>Cancel</button>}
                </td>
              </tr>
              {openId === o.id && <tr><td colSpan={6}><OrderDetail dealerId={dealerId} o={o} canOrder={canOrder} onChanged={load} /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

const STAFF_FILTERS = [['awaiting_payment,paid,in_progress,ready_for_review,rejected', 'Open orders'], ['awaiting_payment', 'Awaiting payment'], ['paid', 'Paid, not started'], ['in_progress', 'In progress'], ['ready_for_review', 'Waiting for the customer'], ['rejected', 'Rejected again'], ['approved', 'Approved'], ['', 'All orders']];

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
                {['awaiting_payment', 'paid', 'in_progress', 'ready_for_review', 'rejected'].includes(o.status) && <button className="link" onClick={() => act(o, 'cancel')}>Cancel</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
