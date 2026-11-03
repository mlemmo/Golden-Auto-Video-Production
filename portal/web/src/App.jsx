// Milestone 1 portal screens: sign in, pick a dealer (eShield staff see every dealer and can add one), see its jobs (refreshed every
// 5 seconds; SiteGround has no WebSockets) and members. Staff can send a test job to check the worker connection.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const POLL_MS = 5000;
const ROLE_NAMES = { staff: 'eShield staff', owner: 'Owner', admin: 'Admin', approver: 'Approver', viewer: 'Viewer' };
const canManage = (role) => ['staff', 'owner', 'admin'].includes(role);
const when = (t) => (t ? new Date(t).toLocaleString() : '');

function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onSignedIn(await api('POST', '/api/auth/login', { email, password })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <form className="card login" onSubmit={submit}>
      <h1>LotSpotlight</h1>
      <p className="muted">Every car in the spotlight.</p>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function Jobs({ dealerId, isStaff }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => api('GET', `/api/dealers/${dealerId}/jobs`).then((d) => { setJobs(d.jobs); setError(''); }, (e) => setError(e.message)), [dealerId]);
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);
  async function ping() {
    try { await api('POST', `/api/dealers/${dealerId}/jobs/ping`, {}); load(); } catch (e) { setError(e.message); }
  }
  return (
    <section className="card">
      <div className="row"><h2>Jobs</h2>{isStaff && <button onClick={ping}>Send test job</button>}</div>
      {error && <p className="error">{error}</p>}
      {jobs.length === 0 ? <p className="muted">No jobs yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Type</th><th>Status</th><th>Tries</th><th>Worker</th><th>Updated</th></tr></thead>
          <tbody>{jobs.map((j) => (
            <tr key={j.id}><td>{j.id}</td><td>{j.type}</td><td><span className={`status ${j.status}`}>{j.status}</span>{j.error && <div className="error small">{j.error}</div>}</td><td>{j.attempts}</td><td>{j.leased_by ?? ''}</td><td>{when(j.updated_at)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

const TIMEZONES = [
  ['America/Los_Angeles', 'Pacific'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Chicago', 'Central'],
  ['America/New_York', 'Eastern'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
];
/** "Golden Auto Sales" → "golden-auto-sales": the short name the server accepts (lowercase letters, numbers, dashes). */
const slugFrom = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

/** eShield staff only: creates a dealer (POST /api/dealers; the server checks staff, the short name and the website). */
function AddDealer({ onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [website, setWebsite] = useState('');
  const [timezone, setTimezone] = useState(TIMEZONES[0][0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onAdded((await api('POST', '/api/dealers', { name, slug, website, timezone })).dealer); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Add a dealer</h2>
      <label>Dealer name<input value={name} maxLength={190} required autoFocus
        onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugFrom(e.target.value)); }} /></label>
      <label>Short name<input value={slug} maxLength={80} required
        onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true); }} />
        <span className="muted small">Lowercase letters, numbers and dashes. It can't be reused.</span></label>
      <label>Website <span className="muted small">(optional)</span><input type="url" placeholder="https://" value={website}
        onChange={(e) => setWebsite(e.target.value.trim())} /></label>
      <label>Time zone<select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {TIMEZONES.map(([tz, label]) => <option key={tz} value={tz}>{label}</option>)}
      </select></label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={busy}>{busy ? 'Adding…' : 'Add dealer'}</button>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function Members({ dealerId }) {
  const [users, setUsers] = useState(null);
  useEffect(() => { api('GET', `/api/dealers/${dealerId}/users`).then((d) => setUsers(d.users), () => setUsers([])); }, [dealerId]);
  if (!users) return null;
  return (
    <section className="card">
      <h2>People</h2>
      {users.length === 0 ? <p className="muted">Nobody has been added yet.</p> : (
        <table><tbody>{users.map((u) => <tr key={u.id}><td>{u.name || u.email}</td><td className="muted">{u.email}</td><td>{ROLE_NAMES[u.role]}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [dealerId, setDealerId] = useState(() => { try { return Number(localStorage.getItem('dealer')) || null; } catch { return null; } });
  const [adding, setAdding] = useState(false);
  useEffect(() => { api('GET', '/api/auth/me').then(setMe, () => setMe(null)); }, []);
  useEffect(() => { try { if (dealerId) localStorage.setItem('dealer', String(dealerId)); } catch { /* private window */ } }, [dealerId]);

  if (me === undefined) return <p className="muted center">Loading…</p>;
  if (!me) return <Login onSignedIn={setMe} />;
  const dealer = me.dealers.find((d) => d.id === dealerId) ?? me.dealers[0];
  async function signOut() { await api('POST', '/api/auth/logout', {}).catch(() => {}); setMe(null); }
  function dealerAdded(d) {
    const dealers = [...me.dealers, { id: d.id, name: d.name, slug: d.slug, status: d.status, role: 'staff' }];
    setMe({ ...me, dealers: dealers.sort((a, b) => a.name.localeCompare(b.name)) });
    setDealerId(d.id);
    setAdding(false);
  }

  return (
    <div className="page">
      <header>
        <strong>LotSpotlight</strong>
        {me.dealers.length > 1 && (
          <select value={dealer?.id ?? ''} onChange={(e) => setDealerId(Number(e.target.value))}>
            {me.dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {me.user.is_staff && me.dealers.length > 0 && !adding && <button className="link" onClick={() => setAdding(true)}>Add dealer</button>}
        <span className="spacer" />
        <span className="muted">{me.user.email}</span>
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      {me.user.is_staff && (adding || !dealer) ? (
        <>
          {!dealer && <p className="muted">There are no dealers yet. Add the first one.</p>}
          <AddDealer onAdded={dealerAdded} onCancel={dealer ? () => setAdding(false) : null} />
        </>
      ) : !dealer ? <p className="card muted">Your account is not linked to a dealer yet. Ask your dealer's owner or eShield to add you.</p> : (
        <main>
          <h1>{dealer.name} <span className="muted small">{ROLE_NAMES[dealer.role]}</span></h1>
          <Jobs dealerId={dealer.id} isStaff={me.user.is_staff} />
          {canManage(dealer.role) && <Members dealerId={dealer.id} />}
        </main>
      )}
    </div>
  );
}
