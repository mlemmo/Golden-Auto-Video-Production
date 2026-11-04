// Dealer details: name, website, city, phone and time zone, edited by eShield staff and the dealer's owners and admins.
// They are the studio's own client details (one database), so the videos use them straight away: the dealer name,
// city and website are said in the script and the phone shows on the closing card.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { TIMEZONES } from './App.jsx';

const FIELDS = [['name', 'Dealer name'], ['website', 'Website'], ['city', 'City'], ['phone', 'Phone']];
const fromDealer = (d) => ({ name: d.name ?? '', website: (d.website ?? '').replace(/^https:\/\//, ''), city: d.city ?? '', phone: d.phone ?? '', timezone: d.timezone ?? 'America/Los_Angeles' });

export function DealerDetails({ dealerId, onSaved }) {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('GET', `/api/dealers/${dealerId}`).then((d) => { setForm(fromDealer(d.dealer)); setSaved(fromDealer(d.dealer)); }, (e) => setError(e.message));
  }, [dealerId]);
  if (!form) return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</section>;
  const field = (k) => ({ id: `dealer-${k}`, value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setNote('');
    const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== saved[k]));
    try {
      const { dealer } = await api('PATCH', `/api/dealers/${dealerId}`, body);
      setForm(fromDealer(dealer)); setSaved(fromDealer(dealer));
      setNote('Saved. New scripts use these details straight away.');
      onSaved(dealer);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  const dirty = Object.keys(form).some((k) => form[k] !== saved[k]);
  return (
    <form className="card form dealer-details" onSubmit={save}>
      <h2>Dealer details</h2>
      <p className="muted small">Your videos say the dealer name, city and website, and show the phone number on the closing card.</p>
      <div className="grid">
        {FIELDS.map(([k, label]) => <label key={k}>{label}<input {...field(k)} required={k === 'name' || k === 'website'} placeholder={k === 'website' ? 'www.example.com' : undefined} /></label>)}
        <label>Time zone<select {...field('timezone')}>
          {!TIMEZONES.some(([tz]) => tz === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
          {TIMEZONES.map(([tz, label]) => <option key={tz} value={tz}>{label}</option>)}
        </select></label>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="ok">{note}</p>}
      <div className="actions"><button disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save details'}</button></div>
    </form>
  );
}
