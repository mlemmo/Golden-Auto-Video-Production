// Dealer details: name, website, city, state, phone and time zone, edited by eShield staff and the dealer's owners and
// admins (staff also change the short name). The video studio uses the name, city, website and phone in scripts and
// picks up changes when staff open this dealer's orders there.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { TIMEZONES } from './App.jsx';

const FIELDS = [['name', 'Dealer name'], ['website', 'Website'], ['city', 'City'], ['state', 'State'], ['phone', 'Phone']];

export function DealerDetails({ dealerId, isStaff, onSaved }) {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fromDealer = (d) => ({ name: d.name ?? '', slug: d.slug ?? '', website: (d.website ?? '').replace(/^https:\/\//, ''), city: d.city ?? '', state: d.state ?? '', phone: d.phone ?? '', timezone: d.timezone ?? 'America/Los_Angeles' });
  useEffect(() => {
    api('GET', `/api/dealers/${dealerId}`).then((d) => { setForm(fromDealer(d.dealer)); setSaved(fromDealer(d.dealer)); }, (e) => setError(e.message));
  }, [dealerId]);
  if (!form) return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</section>;
  const field = (k) => ({ id: `dealer-${k}`, value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setNote('');
    // Send only what changed, so an owner never sends the staff-only short name.
    const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== saved[k]));
    try {
      const { dealer } = await api('PATCH', `/api/dealers/${dealerId}`, body);
      setForm(fromDealer(dealer)); setSaved(fromDealer(dealer));
      setNote('Saved. The video studio uses the new details from the next order it opens.');
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
        {FIELDS.map(([k, label]) => <label key={k}>{label}<input {...field(k)} required={k === 'name'} placeholder={k === 'website' ? 'www.example.com' : undefined} /></label>)}
        <label>Time zone<select {...field('timezone')}>
          {!TIMEZONES.some(([tz]) => tz === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
          {TIMEZONES.map(([tz, label]) => <option key={tz} value={tz}>{label}</option>)}
        </select></label>
        {isStaff && <label>Short name <span className="muted small">(staff only)</span><input {...field('slug')} maxLength={80} required /></label>}
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="ok">{note}</p>}
      <div className="actions"><button disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save details'}</button></div>
    </form>
  );
}
