// Accounts: the account menu in the top bar, "Change password", and the admin's "Manage users" window.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { DangerButton, useStatus } from './ui.jsx';

export const ROLE_NAME = { admin: 'Admin', user: 'User', viewer: 'Viewer' };
const ROLE_HINT = {
  admin: 'Everything, plus users and clients',
  user: 'Makes videos for the clients below, including paid steps',
  viewer: 'Sees and downloads videos for the clients below; changes nothing',
};

/** Top bar: who is signed in, with Change password and Sign out. */
export function AccountMenu({ onSignOut }) {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const me = s.me;
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="secondary small" id="accountMenu" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="label-short">👤</span><span className="label-long">{me.name || me.email}</span>
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <div className="menu-who"><strong>{me.name || me.email}</strong><small>{me.email} · {ROLE_NAME[me.role]}</small></div>
          <button type="button" role="menuitem" className="menu-item" id="changePassword" onClick={() => { setOpen(false); s.setTool('account'); }}><strong>Change password</strong></button>
          <button type="button" role="menuitem" className="menu-item" id="logout" onClick={onSignOut}><strong>Sign out</strong></button>
        </div>
      )}
    </div>
  );
}

/** Change your own password (the current one is required). */
export function PasswordTool() {
  const [, say] = useStatus('account');
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.again) { say('The two new passwords are different.', 'warn'); return; }
    try { say((await api('password_change', { current: f.current, password: f.password })).message); setF({ current: '', password: '', again: '' }); }
    catch (err) { say(err.message, true); }
  };
  return (
    <section className="tool-section" id="accountPanel">
      <form id="passwordForm" onSubmit={submit} className="narrow-form">
        <label>Current password<input type="password" required autoComplete="current-password" value={f.current} onChange={set('current')} /></label>
        <label>New password (at least 10 characters)<input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
        <label>New password again<input type="password" required minLength={10} autoComplete="new-password" value={f.again} onChange={set('again')} /></label>
        <div className="actions"><button id="passwordSave">Change password</button></div>
      </form>
    </section>
  );
}

/** Admin: every account, add one, edit role / clients / active / password, delete. */
export function UsersTool({ active }) {
  const s = useStudio();
  const [, say] = useStatus('users');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);   // account id, or 'new'
  const load = async () => { try { setData(await api('users_list')); } catch (e) { say(e.message, true); } };
  useEffect(() => { if (active) load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <section className="tool-section" id="usersPanel"><p>Loading accounts…</p></section>;
  const clientName = Object.fromEntries(data.clients.map((c) => [c.id, c.name]));
  const save = async (action, body) => {
    try { say((await api(action, body)).message); setEditing(null); await load(); } catch (e) { say(e.message, true); }
  };
  return (
    <section className="tool-section" id="usersPanel">
      <p className="hint">There is no registration page: accounts are added here. Users and viewers see only the clients ticked for them; admins see every client.</p>
      {editing === 'new' ? <UserForm clients={data.clients} onCancel={() => setEditing(null)} onSave={(b) => save('user_create', b)} />
        : <div className="actions"><button type="button" id="userAdd" onClick={() => setEditing('new')}>Add account</button></div>}
      <div className="list" id="usersList">
        {data.users.map((u) => (editing === u.id
          ? <UserForm key={u.id} user={u} self={u.id === s.me.id} clients={data.clients} onCancel={() => setEditing(null)} onSave={(b) => save('user_update', { id: u.id, ...b })} />
          : (
            <div key={u.id} className={'job user-row' + (u.active ? '' : ' inactive')}>
              <div className="job-head">
                <strong>{u.name ? `${u.name} · ` : ''}{u.email}{u.id === s.me.id ? ' (you)' : ''}</strong>
                <span className={'badge ' + (u.active ? (u.role === 'admin' ? 'busy' : 'ok') : 'bad')}>{u.active ? ROLE_NAME[u.role] : 'Switched off'}</span>
              </div>
              <small>{u.role === 'admin' ? 'All clients' : u.clients.length ? u.clients.map((c) => clientName[c] ?? c).join(', ') : 'No clients yet'}
                {' · '}{u.last_sign_in ? 'last signed in ' + new Date(u.last_sign_in).toLocaleString() : 'never signed in'}</small>
              <div className="actions">
                <button type="button" className="secondary small" onClick={() => setEditing(u.id)}>Edit</button>
                {u.id !== s.me.id && <DangerButton label="Delete" what={`the account ${u.email}`} detail="They can no longer sign in. Videos they made stay." onConfirm={() => save('user_delete', { id: u.id })} />}
              </div>
            </div>
          )))}
      </div>
    </section>
  );
}

function UserForm({ user, self, clients, onSave, onCancel }) {
  const [f, setF] = useState({ email: user?.email ?? '', name: user?.name ?? '', role: user?.role ?? 'user', clients: user?.clients ?? [], active: user?.active ?? true, password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleClient = (id) => setF({ ...f, clients: f.clients.includes(id) ? f.clients.filter((c) => c !== id) : [...f.clients, id] });
  const submit = (e) => {
    e.preventDefault();
    const b = { email: f.email, name: f.name, role: f.role, clients: f.clients, active: f.active };
    if (f.password) b.password = f.password;
    onSave(b);
  };
  return (
    <form className="studio user-form" onSubmit={submit}>
      <h3>{user ? 'Edit account' : 'Add account'}</h3>
      <div className="import-grid">
        <label>Email<input type="email" required maxLength={120} autoComplete="off" value={f.email} onChange={set('email')} /></label>
        <label>Name (optional)<input maxLength={80} autoComplete="off" value={f.name} onChange={set('name')} /></label>
        <label>Role
          <select value={f.role} disabled={self} onChange={set('role')}>
            {['admin', 'user', 'viewer'].map((r) => <option key={r} value={r}>{ROLE_NAME[r]} — {ROLE_HINT[r]}</option>)}
          </select>
        </label>
        <label>{user ? 'New password (leave empty to keep)' : 'Starting password (at least 10 characters)'}
          <input type="text" minLength={10} required={!user} autoComplete="off" value={f.password} onChange={set('password')} /></label>
      </div>
      {f.role !== 'admin' && (
        <fieldset className="client-picks"><legend>Clients this account may use</legend>
          {clients.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={f.clients.includes(c.id)} onChange={() => toggleClient(c.id)} />{c.name}</label>)}
        </fieldset>
      )}
      {user && !self && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Account switched on (untick to stop this person signing in)</label>}
      <p className="hint">Give the person their password yourself; they can change it under their name in the top bar.</p>
      <div className="actions"><button>{user ? 'Save account' : 'Create account'}</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
