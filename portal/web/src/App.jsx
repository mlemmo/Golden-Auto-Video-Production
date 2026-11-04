// Portal screens: sign in (studio accounts and dealer customers), pick a dealer (eShield staff see every dealer and can
// add one), then tabs: Cars (Cars.jsx), Orders (Orders.jsx), People and Dealer details for owners and admins, and every
// dealer's orders for staff. The API is the studio's own server (node/src/portal/api.js); lists refresh by polling.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Cars } from './Cars.jsx';
import { Orders, StaffOrders } from './Orders.jsx';
import { DealerDetails } from './DealerDetails.jsx';

const ROLE_NAMES = { staff: 'eShield staff', owner: 'Owner', admin: 'Can order', approver: 'Approver', viewer: 'View only' };
const canManage = (role) => ['staff', 'owner', 'admin'].includes(role);
/** Tabs this person sees: everyone Cars and Orders; owners and admins People and Dealer details; staff every dealer's orders. */
const tabsFor = (role, isStaff) => [
  ['cars', 'Cars'], ['orders', 'Orders'],
  ...(canManage(role) ? [['people', 'People'], ['dealer', 'Dealer details']] : []),
  ...(isStaff ? [['all-orders', 'All dealers’ orders']] : []),
];

export const TIMEZONES = [
  ['America/Los_Angeles', 'Pacific'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Chicago', 'Central'],
  ['America/New_York', 'Eastern'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
];

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

/** eShield staff: a new dealer (it becomes a client in the studio too; its website is checked there). */
function AddDealer({ onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onAdded((await api('POST', '/api/dealers', { name, website })).dealer); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Add a new dealer</h2>
      <p className="muted small">Dealers are shared with the video studio: one added here shows up there too, and the studio's dealers are already listed in the dealer picker.</p>
      <label>Dealer name<input value={name} maxLength={80} required autoFocus onChange={(e) => setName(e.target.value)} /></label>
      <label>Website<input placeholder="www.example.com" value={website} required onChange={(e) => setWebsite(e.target.value.trim())} /></label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={busy}>{busy ? 'Checking the website…' : 'Add dealer'}</button>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

/** Who can use this dealer on the portal; owners (and staff) add people who can order or only look. */
function People({ dealerId, canAdd }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'owner' });
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => api('GET', `/api/dealers/${dealerId}/users`).then((d) => setUsers(d.users), (e) => setError(e.message)), [dealerId]);
  useEffect(() => { load(); }, [load]);
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  async function add(e) {
    e.preventDefault();
    setError(''); setNote('');
    try {
      const r = await api('POST', `/api/dealers/${dealerId}/users`, form);
      setNote(r.created ? `Account made for ${form.email}. Give them the password you chose; they can change it after signing in.` : `${form.email} can now use this dealer too.`);
      setForm({ email: '', name: '', password: '', role: 'owner' });
      load();
    } catch (err) { setError(err.message); }
  }
  async function remove(u) {
    setError(''); setNote('');
    try { await api('DELETE', `/api/dealers/${dealerId}/users/${u.id}`); load(); } catch (err) { setError(err.message); }
  }
  return (
    <section className="card">
      <h2>People</h2>
      <p className="muted small">eShield staff see every dealer and are not listed. People with a studio account are managed in the studio.</p>
      {users === null ? <p className="muted">Loading…</p> : users.length === 0 ? <p className="muted">Nobody else has access yet.</p> : (
        <table><tbody>{users.map((u) => (
          <tr key={u.id}>
            <td>{u.name || u.email}<div className="muted small">{u.email}</div></td>
            <td>{ROLE_NAMES[u.role]}{u.studio && <div className="muted small">studio account</div>}</td>
            <td>{canAdd && !u.studio && <button className="link" onClick={() => remove(u)}>Remove</button>}</td>
          </tr>
        ))}</tbody></table>
      )}
      {canAdd && (
        <form className="form people-form" onSubmit={add}>
          <h3>Add a person</h3>
          <div className="grid">
            <label>Email<input type="email" required {...field('email')} /></label>
            <label>Name<input {...field('name')} /></label>
            <label>Password <span className="muted small">(new accounts, 10+ characters)</span><input type="text" autoComplete="new-password" {...field('password')} /></label>
            <label>Access<select {...field('role')}><option value="owner">Can order and add people</option><option value="viewer">View only</option></select></label>
          </div>
          <div className="actions"><button>Add person</button></div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {note && <p className="ok">{note}</p>}
    </section>
  );
}

function ChangePassword({ onClose }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError('');
    try { await api('POST', '/api/auth/password', { current, password }); setDone(true); } catch (err) { setError(err.message); }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <div className="row"><h2>Change password</h2><button type="button" className="link" onClick={onClose}>Close</button></div>
      <p className="muted small">The same password signs you in to the video studio, if you use it.</p>
      <label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label>New password <span className="muted small">(10+ characters)</span><input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      {done ? <p className="ok">Password changed.</p> : <div className="actions"><button>Change password</button></div>}
    </form>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [dealerId, setDealerId] = useState(() => { try { return localStorage.getItem('dealer') || null; } catch { return null; } });
  const [adding, setAdding] = useState(false);
  const [account, setAccount] = useState(false);
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('tab') || 'cars'; } catch { return 'cars'; } });
  useEffect(() => { api('GET', '/api/auth/me').then(setMe, () => setMe(null)); }, []);
  useEffect(() => { try { localStorage.setItem('tab', tab); } catch { /* private window */ } }, [tab]);
  useEffect(() => { try { if (dealerId) localStorage.setItem('dealer', String(dealerId)); } catch { /* private window */ } }, [dealerId]);

  if (me === undefined) return <p className="muted center">Loading…</p>;
  if (!me) return <Login onSignedIn={setMe} />;
  const dealer = me.dealers.find((d) => d.id === dealerId) ?? me.dealers[0];
  async function signOut() { await api('POST', '/api/auth/logout', {}).catch(() => {}); setMe(null); }
  function dealerSaved(d) {
    const dealers = me.dealers.map((x) => (x.id === d.id ? { ...x, name: d.name } : x));
    setMe({ ...me, dealers: dealers.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  function dealerAdded(d) {
    setMe({ ...me, dealers: [...me.dealers, d].sort((a, b) => a.name.localeCompare(b.name)) });
    setDealerId(d.id);
    setAdding(false);
  }

  return (
    <div className="page">
      <header>
        <strong>LotSpotlight</strong>
        {me.dealers.length > 1 && (
          <select aria-label="Dealer" value={dealer?.id ?? ''} onChange={(e) => setDealerId(e.target.value)}>
            {me.dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {me.user.is_staff && me.dealers.length > 0 && !adding && <button className="link" onClick={() => setAdding(true)}>Add dealer</button>}
        <span className="spacer" />
        <button className="link muted" onClick={() => setAccount(!account)}>{me.user.email}</button>
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      {account && <ChangePassword onClose={() => setAccount(false)} />}
      {me.user.is_staff && (adding || !dealer) ? (
        <>
          {!dealer && <p className="muted">There are no dealers yet. Add the first one.</p>}
          <AddDealer onAdded={dealerAdded} onCancel={dealer ? () => setAdding(false) : null} />
        </>
      ) : !dealer ? <p className="card muted">Your account is not linked to a dealer yet. Ask your dealer's owner or eShield to add you.</p> : (
        <main>
          {tab !== 'all-orders' && <h1>{dealer.name} <span className="muted small">{ROLE_NAMES[dealer.role]}</span></h1>}
          <nav className="tabs">
            {tabsFor(dealer.role, me.user.is_staff).map(([id, label]) => <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>{label}</button>)}
          </nav>
          {(() => {
            const shown = tabsFor(dealer.role, me.user.is_staff).some(([id]) => id === tab) ? tab : 'cars';
            if (shown === 'orders') return <Orders dealerId={dealer.id} canOrder={['staff', 'owner', 'admin'].includes(dealer.role)} />;
            if (shown === 'people') return <People dealerId={dealer.id} canAdd={['staff', 'owner'].includes(dealer.role)} />;
            if (shown === 'dealer') return <DealerDetails dealerId={dealer.id} onSaved={dealerSaved} />;
            if (shown === 'all-orders') return <StaffOrders />;
            return <Cars dealerId={dealer.id} role={dealer.role} />;
          })()}
        </main>
      )}
    </div>
  );
}
