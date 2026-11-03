// "Customer orders" (admins, once the LotSpotlight portal is connected): paid orders placed by dealers on the portal.
// Open in studio copies the ordered car and its photos into that dealer's client here, marks the order in progress
// on the portal, and opens the car in step 1 (src/lib/orders.js on the server).
import { useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { Window } from './Activity.jsx';
import { useStatus } from './ui.jsx';

const FILTERS = [['', 'Paid and in progress'], ['paid', 'Waiting to start'], ['in_progress', 'In progress']];
const STATUS = { paid: 'Paid · waiting to start', in_progress: 'In progress' };
const dollars = (n) => (n === null || n === undefined ? 'no price' : '$' + Number(n).toLocaleString('en-US'));
const miles = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US') + ' mi');
const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function OrdersWindow({ open, onClose }) {
  const s = useStudio();
  const [, say] = useStatus('ordersWindow');
  const load = async () => {
    const r = await api('portal_orders');
    if (!r.configured) say('The LotSpotlight portal is not connected (config "portal").', true);
    return r.orders;
  };
  // Not inside s.run: step 1 opens the car with s.run once the client's cars have loaded, and run allows one at a time.
  const [opening, setOpening] = useState(false);
  const openOrder = async (o) => {
    if (opening || s.busy) return;
    setOpening(true);
    say(`Copying order ${o.id} from the portal…`);
    try {
      const r = await api('portal_order_open', { id: o.id });
      s.setOpenStock(r.stock);
      await s.switchClient(r.client);
      say(r.message);
      onClose();
    } catch (e) { say(e.message, true); } finally { setOpening(false); }
  };
  return (
    <Window id="ordersWindow" title="Customer orders — LotSpotlight portal" open={open} onClose={onClose} filters={FILTERS} load={load}>
      {({ rows, filter }) => {
        const shown = rows.filter((o) => !filter || o.status === filter);
        if (!shown.length) return <p className="hint">No paid orders here. Orders appear once a dealer has ordered and paid on the portal.</p>;
        return (
          <div className="activity-list">
            {shown.map((o) => (
              <article key={o.id} className="activity-row">
                <div className="activity-main">
                  <strong>{o.vehicle.title || o.vehicle.vin}</strong>
                  <small>{[o.dealer, `${o.product_name}, ${o.length_s} s`, `order ${o.id}`, when(o.paid_at || o.created_at), o.ordered_by].filter(Boolean).join(' · ')}</small>
                  <small className="hint">{[o.vehicle.stock && 'stock ' + o.vehicle.stock, 'VIN ' + o.vehicle.vin, dollars(o.vehicle.price), miles(o.vehicle.mileage), `${o.vehicle.photos} photo${o.vehicle.photos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>
                  {o.notes && <small className="hint activity-caption">Customer notes: {o.notes}</small>}
                </div>
                <div className="activity-platforms">
                  <div className={'activity-status status-' + o.status}><b>{STATUS[o.status] ?? o.status}</b></div>
                  <div className="actions">
                    <button type="button" className="small" disabled={s.busy || opening} onClick={() => openOrder(o)}>{o.status === 'paid' ? 'Open in studio' : 'Open again'}</button>
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
