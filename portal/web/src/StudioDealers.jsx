// eShield staff: the video studio's dealers (its clients, sent by the studio), each added to the portal with one click
// using the studio's details. Shown above the Add dealer form; a dealer already on the portal says so.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export function StudioDealers({ onAdded }) {
  const [clients, setClients] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api('GET', '/api/staff/studio-clients').then((d) => setClients(d.clients), (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function add(c) {
    setBusy(c.client_id); setError('');
    try { onAdded((await api('POST', `/api/staff/studio-clients/${encodeURIComponent(c.client_id)}/add`, {})).dealer); }
    catch (e) { setError(e.message); load(); }
    setBusy('');
  }
  if (clients === null) return error ? <p className="error">{error}</p> : null;
  const waiting = clients.filter((c) => !c.dealer_id);
  return (
    <section className="card">
      <h2>Dealers in the video studio</h2>
      {clients.length === 0 ? <p className="muted">The studio has not sent its dealers yet. They appear here once the studio is connected (it sends them when it starts).</p> : (
        <>
          <p className="muted small">{waiting.length ? 'Add a studio dealer to the portal with its details from the studio. You can edit them afterwards under Dealer details.' : 'Every studio dealer is on the portal.'}</p>
          <table>
            <tbody>{clients.map((c) => (
              <tr key={c.client_id}>
                <td><strong>{c.name}</strong><div className="muted small">{[c.website?.replace('https://', ''), c.city, c.car_count !== null && `${c.car_count} cars in the studio`].filter(Boolean).join(' · ')}</div></td>
                <td className="nowrap">{c.dealer_id ? <span className="pill order-paid">On the portal{c.dealer_name && c.dealer_name !== c.name ? ` as ${c.dealer_name}` : ''}</span>
                  : <button className="small" disabled={!!busy} onClick={() => add(c)}>{busy === c.client_id ? 'Adding…' : 'Add to portal'}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
