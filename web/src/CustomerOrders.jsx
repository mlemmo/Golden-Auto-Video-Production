// "Orders" (admins, once the LotSpotlight portal is in use here): orders dealers placed on the portal (same database,
// src/lib/orders.js on the server). Open in studio copies the ordered car and its photos into that dealer's client,
// marks the order in progress and opens the car in step 1 with the order's length and type. Once a video of that car
// is finished, tick it and Send to customer: they approve it or ask for changes on the portal (one free remake, then
// a second rejection comes back here for you to decide).
import { useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { Window } from './Activity.jsx';
import { useStatus } from './ui.jsx';

const FILTERS = [['', 'All open orders'], ['paid', 'Waiting to start'], ['in_progress', 'In progress'], ['ready_for_review', 'Waiting for the customer'], ['rejected', 'Rejected again: your call']];
const STATUS = { paid: 'Paid · waiting to start', in_progress: 'In progress', ready_for_review: 'Sent · waiting for the customer', rejected: 'Rejected again · your call' };
const KIND = { ai: 'AI video', slideshow: 'Slideshow', footage: 'Footage' };
const FORMAT = { instagram_reels: '9:16', facebook_reels: '9:16', facebook_feed: '4:5', youtube: '16:9', square: '1:1' };
const dollars = (n) => (n === null || n === undefined ? 'no price' : '$' + Number(n).toLocaleString('en-US'));
const miles = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US') + ' mi');
const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** The finished videos of an order's car, ticked to send (the ones already sent start ticked). */
function Deliver({ o, onSent }) {
  const [, say] = useStatus('ordersWindow');
  const [pick, setPick] = useState(() => new Set(o.finished.filter((f) => f.sent).map((f) => f.id)));
  const [busy, setBusy] = useState(false);
  if (o.status === 'paid') return null;
  if (!o.finished.length) return <small className="hint">No finished video of this car yet. Make it in the steps, then send it from here.</small>;
  const toggle = (id) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = async () => {
    setBusy(true);
    try { say((await api('portal_order_deliver', { id: o.id, videos: [...pick] })).message); onSent(); } catch (e) { say(e.message, true); }
    setBusy(false);
  };
  return (
    <div className="order-deliver">
      {o.finished.map((f) => (
        <label key={f.id} className="order-video">
          <input type="checkbox" checked={pick.has(f.id)} onChange={() => toggle(f.id)} />
          {f.poster ? <img src={f.poster} alt="" loading="lazy" /> : <span className="thumb" aria-hidden="true" />}
          <small>{[KIND[f.kind] ?? f.kind, FORMAT[f.format] ?? f.format, f.duration && f.duration + ' s', when(f.created_at)].filter(Boolean).join(' · ')}{f.sent ? ' · sent' : ''}</small>
          <a href={f.url} target="_blank" rel="noreferrer">Watch</a>
        </label>
      ))}
      <button type="button" className="small" disabled={busy || !pick.size} onClick={send}>{o.status === 'ready_for_review' ? 'Send again' : 'Send to customer'}</button>
    </div>
  );
}

export function OrdersWindow({ open, onClose }) {
  const s = useStudio();
  const [, say] = useStatus('ordersWindow');
  const [reload, setReload] = useState(0);
  const load = async () => (await api('portal_orders')).orders;
  // Not inside s.run: step 1 opens the car with s.run once the client's cars have loaded, and run allows one at a time.
  const [opening, setOpening] = useState(false);
  const openOrder = async (o) => {
    if (opening || s.busy) return;
    setOpening(true);
    say(`Copying order ${o.id} from the portal…`);
    try {
      const r = await api('portal_order_open', { id: o.id });
      await s.switchClient(r.client);
      // After the switch (it restores the client's last choices): the order's length and type, then open the car,
      // whose script is drafted for that length.
      s.applyOrder(r);
      s.setOpenStock(r.stock);
      say(r.message, r.notes ? 'warn' : false);
      onClose();
    } catch (e) { say(e.message, true); } finally { setOpening(false); }
  };
  return (
    <Window key={reload} id="ordersWindow" title="Customer orders — LotSpotlight portal" open={open} onClose={onClose} filters={FILTERS} load={load}>
      {({ rows, filter }) => {
        const shown = rows.filter((o) => !filter || o.status === filter);
        if (!shown.length) return <p className="hint">No open orders here. Orders appear once a dealer has ordered and paid on the portal.</p>;
        return (
          <div className="activity-list">
            {shown.map((o) => (
              <article key={o.id} className="activity-row">
                <div className="activity-main">
                  <strong>{o.vehicle.title || o.vehicle.vin}</strong>
                  <small>{[o.dealer, `${o.product_name}, ${o.length_s} s`, `order ${o.id}`, when(o.paid_at || o.created_at), o.ordered_by].filter(Boolean).join(' · ')}</small>
                  <small className="hint">{[o.vehicle.stock && 'stock ' + o.vehicle.stock, 'VIN ' + o.vehicle.vin, dollars(o.vehicle.price), miles(o.vehicle.mileage), `${o.vehicle.photos} photo${o.vehicle.photos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>
                  {o.notes && <small className="hint activity-caption">Customer notes: {o.notes}</small>}
                  {o.remake && <small className="note-important">Free remake asked for: {o.remake.reason}</small>}
                  {o.status === 'rejected' && o.rejections.map((r, i) => <small key={i} className="note-important">Rejected {when(r.at)}: {r.reason}</small>)}
                  <Deliver o={o} onSent={() => setReload((n) => n + 1)} />
                </div>
                <div className="activity-platforms">
                  <div className={'activity-status status-' + o.status}><b>{STATUS[o.status] ?? o.status}</b>{o.delivered_at && <small className="hint">sent {when(o.delivered_at)}</small>}</div>
                  <div className="actions">
                    <button type="button" className="small secondary" disabled={s.busy || opening} onClick={() => openOrder(o)}>{o.status === 'paid' ? 'Open in studio' : 'Open again'}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        );
      }}
    </Window>
  );
}
