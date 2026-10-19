// Step 1: the client (dealer) and its inventory. Each client has its own inventory, voice previews and videos.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { miles, price } from './ui.jsx';

const METHOD_TITLE = { feed: 'Daily inventory feed', website_dealercenter: 'Website reader', website_structured: 'Website import',
  browser_snapshot: 'Browser snapshot', zip: 'Manual import', dealercenter_snapshot: 'DealerCenter website snapshot' };
const SYNC_SECTIONS = [['added', 'Added'], ['removed', 'Removed — no longer in DealerCenter (hidden, videos kept)'], ['returned', 'Back in inventory'],
  ['price_changed', 'Price changed — review the script'], ['photos_updated', 'Photos updated — asset sheet rebuilt'], ['sheet_views', 'Asset sheet views changed'],
  ['waiting_photos', 'Waiting for photos'], ['updated', 'Details updated'], ['sheet_errors', 'Asset sheet problems']];

export default function VehicleStep() {
  const s = useStudio();
  const [, say] = s.statuses.vehicle;
  const c = s.client;
  return (
    <section className="panel" id="stepVehicle">
      <div className="step-head"><span className="step-num">1</span><div><h2>Choose a vehicle</h2><p id="syncTime">{inventoryLine(s.inventory)}</p></div></div>
      {c?.id === 'golden-auto' && <SyncLog />}
      <SyncButton say={say} />
      <Inventory say={say} />
    </section>
  );
}

/** The client (dealer) the studio is working for: menu, add a client, import details and dealer details in scripts. */
export function ClientPanel() {
  const s = useStudio();
  const c = s.client;
  return (
    <section className="panel client-panel" id="clientPanel" aria-label="Client">
      <ClientBar />
      {c && <ClientDetails key={'details-' + c.id} />}
    </section>
  );
}

function inventoryLine(a) {
  if (!a) return 'Loading your inventory…';
  const active = (a.vehicles ?? []).filter((v) => v.active !== false), pending = active.filter((v) => v.photos_pending).length;
  return (a.dealercenter_checked_at ? `${active.length} vehicles · DealerCenter synced ${new Date(a.dealercenter_checked_at).toLocaleString()}`
    : a.checked_at ? `${active.length} vehicles · checked ${new Date(a.checked_at).toLocaleString()}` : `${active.length} vehicles`)
    + (pending ? ` · photos importing for ${pending} (updates automatically)` : '');
}

function ClientBar() {
  const s = useStudio();
  const [, say] = s.statuses.vehicle;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', website: '' });
  const [switching, setSwitching] = useState(false);

  const change = async (id) => {
    if (s.busy || switching) return;
    setSwitching(true);
    try { await api('client_select', { id }); await s.showClientData(); say(`Switched to ${s.clients.items.find((c) => c.id === id)?.name || id}.`); }
    catch (e) { say(e.message, true); }
    finally { setSwitching(false); }
  };
  const add = (e) => {
    e.preventDefault();
    s.run(async () => {
      say('Adding the client and analyzing its website…');
      try {
        const r = await api('client_add', form);
        await api('client_select', { id: r.client.id });
        setForm({ name: '', website: '' }); setAdding(false);
        await s.showClientData();
        say(`${r.client.name} added.`);
      } catch (err) { say(err.message, true); }
    });
  };
  return (
    <div className="client-picker">
      <div className="client-bar">
        <label>Client
          <select id="client" value={s.clients.current ?? ''} disabled={switching} onChange={(e) => change(e.target.value)}>
            {!s.clients.items.length && <option>Loading clients…</option>}
            {s.clients.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" className="secondary small" id="addClientToggle" onClick={() => setAdding(!adding)}>Add client</button>
      </div>
      <form id="clientForm" className="studio" hidden={!adding} onSubmit={add}>
        <div className="import-grid">
          <label>Client name<input name="name" required maxLength={80} placeholder="e.g. Bay Area Motors" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Website<input name="website" required maxLength={200} placeholder="www.example.com" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
        </div>
        <p className="hint">After adding, the studio looks at the website (a few free page requests) and recommends the best way to import its inventory.</p>
        <button id="clientAdd" disabled={s.busy}>Add client and analyze website</button>
      </form>
    </div>
  );
}

/** The client's import and script details as plain text, with Edit details (and Analyze website again). */
function ClientDetails() {
  const s = useStudio();
  const [, say] = s.statuses.vehicle;
  const c = s.client, a = c.analysis || {}, d = c.script_details || {};
  const [editing, setEditing] = useState(false);
  const fromDetails = () => ({ name: d.name || '', city: d.city || '', website: d.website || '', website_spoken: d.website_spoken || '', phone: d.phone || '' });
  const [form, setForm] = useState(fromDetails);
  useEffect(() => { if (!editing) setForm(fromDetails()); }, [JSON.stringify(d), editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const update = (client) => s.setClients((cl) => ({ ...cl, items: cl.items.map((x) => (x.id === client.id ? client : x)) }));
  const save = (e) => {
    e.preventDefault();
    s.run(async () => {
      try {
        update((await api('client_details', form)).client);
        setEditing(false);
        say('Dealer details saved. Reopen a vehicle to redraft its script with them.');
      } catch (err) { say(err.message, true); }
    });
  };
  const analyze = () => s.run(async () => {
    say('Analyzing the website…');
    try { update((await api('client_analyze', { id: c.id })).client); say('Website analyzed.'); } catch (e) { say(e.message, true); }
  });
  return (
    <div className="client-details" id="clientDetails">
      <dl className="client-facts">
        <dt>Website</dt><dd>{c.website.replace('https://', '')}</dd>
        <dt>Inventory import</dt><dd>{METHOD_TITLE[a.best] || 'not checked yet'}{a.note ? ' — ' + a.note : ''}</dd>
        {a.platform && <><dt>Website platform</dt><dd>{a.platform}</dd></>}
        {a.dealer && <><dt>Found on the website</dt><dd>{Object.values(a.dealer).join(', ')}</dd></>}
        {a.signals?.length > 0 && <><dt>What the website shows</dt><dd>{a.signals.join('; ')}</dd></>}
        {a.options?.length > 0 && <><dt>Import options</dt><dd>{a.options.map((o) => o.title).join(' · ')} <small>(best first)</small></dd></>}
        <dt>In scripts</dt><dd id="dealerSummary">{`${d.name}${d.city ? ' in ' + d.city : ''} · ${d.website}`} <small>(said “{d.website_spoken}”)</small></dd>
        <dt>Phone</dt><dd>{d.phone || <small>not set</small>}</dd>
        {a.checked_at && <><dt>Website checked</dt><dd>{new Date(a.checked_at).toLocaleString()}</dd></>}
      </dl>
      {!editing && (
        <div className="actions">
          <button type="button" className="secondary small" id="editDetails" onClick={() => setEditing(true)}>Edit details</button>
          {c.id !== 'golden-auto' && <button type="button" className="secondary small" id="clientAnalyze" disabled={s.busy} onClick={analyze}>Analyze website again</button>}
        </div>
      )}
      {editing && (
        <form id="dealerForm" className="studio" onSubmit={save}>
          <div className="import-grid">
            <label>Dealer name in scripts<input name="name" maxLength={80} required autoComplete="off" {...field('name')} /></label>
            <label>City<input name="city" maxLength={60} autoComplete="off" {...field('city')} /></label>
            <label>Website as shown<input name="website" maxLength={100} required placeholder="example.com" autoComplete="off" {...field('website')} /></label>
            <label>Website as spoken<input name="website_spoken" maxLength={120} placeholder="example dot com" autoComplete="off" {...field('website_spoken')} /></label>
            <label>Phone (optional)<input name="phone" type="tel" maxLength={25} placeholder="925-555-1234" autoComplete="off" {...field('phone')} /></label>
          </div>
          <p className="hint">Scripts say “here at <i>name</i> in <i>city</i>” and “Book your test drive today at <i>website</i>”; the voice says the website as written in “as spoken”. The phone number is saved with the dealer for now; it is not used in scripts. Reopen a vehicle after saving to redraft its script.</p>
          <div className="actions">
            <button id="dealerSave" disabled={s.busy}>Save details</button>
            <button type="button" className="secondary" id="dealerCancel" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function SyncLog() {
  const { syncLog } = useStudio();
  const last = syncLog?.entries?.[0];
  if (!last) return <details id="syncLogPanel" className="sub"><summary id="syncLogSummary">Inventory changes — no DealerCenter sync yet</summary><div id="syncLog" /></details>;
  const sections = SYNC_SECTIONS.filter(([key]) => (last[key] || []).length);
  const changes = sections.reduce((n, [key]) => n + last[key].length, 0);
  return (
    <details id="syncLogPanel" className="sub">
      <summary id="syncLogSummary">{`Inventory changes — DealerCenter synced ${new Date(last.at).toLocaleString()} · ${last.active_count} active · ${changes} change${changes === 1 ? '' : 's'}`}</summary>
      <div id="syncLog">
        {sections.map(([key, label]) => <div key={key}><strong>{label} ({last[key].length})</strong><ul>{last[key].map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
        {!changes && <p>No changes since the previous sync.</p>}
      </div>
    </details>
  );
}

function SyncButton({ say }) {
  const s = useStudio();
  const c = s.client, a = c?.analysis || {};
  // Website import for clients whose site the importer supports (Dealer Car Search). Golden Auto has no button: its
  // website blocks this server (Cloudflare), so its cars come from the DealerCenter sync instead.
  if (!c || c.id === 'golden-auto' || !(a.platform === 'Dealer Car Search' && a.reachable)) return null;
  const sync = () => s.run(async () => {
    say('Refreshing current inventory…');
    try {
      const r = await api('sync');
      s.clearVehicle(); s.setInventory(r);
      const rep = r.report;
      say(rep ? `Imported from the website: ${rep.added} new, ${rep.updated} updated, ${rep.gone} no longer listed${rep.errors.length ? `, ${rep.errors.length} page(s) could not be read` : ''}. Select a vehicle.${rep.errors.length ? '\n' + rep.errors.join('\n') : ''}`
        : 'Inventory refreshed. Select a vehicle.', !!rep?.errors.length);
    } catch (e) { say(e.message, true); }
  });
  return <button id="sync" className="secondary" disabled={s.busy} onClick={sync}>Import inventory from website</button>;
}

function Inventory({ say }) {
  const s = useStudio();
  const list = s.inventory?.vehicles ?? [];
  const hidden = list.filter((v) => v.active === false).length;
  const select = (stock) => s.run(async () => {
    say('Reading vehicle details and checking its highest listed price…');
    try {
      const v = await api('detail', { stock });
      s.setChosen(v);
      s.setScript(v.scripts?.[s.duration] || v.script);
      s.setSheetUrl(v.asset_sheet?.url ?? '');
      s.setApprove(false); s.setConfirmCurrent(false);
      s.refreshNarrations().catch((e) => s.statuses.studio[1](e.message, true));
      say(v.sheet_error || `${v.Year} ${v.Make} ${v.Model} selected. Continue with the script in step 2.`);
    } catch (e) { say(e.message, true); }
  });
  return (
    <div id="inventory" className="vehicle-list">
      {hidden > 0 && <small>{hidden} vehicle{hidden > 1 ? 's' : ''} no longer in DealerCenter hidden; their videos are kept.</small>}
      {list.filter((v) => v.active !== false).map((v) => (
        <button key={v.StockNumber} className={'vehicle' + (s.chosen?.StockNumber === v.StockNumber ? ' active' : '')} data-stock={v.StockNumber} onClick={() => select(v.StockNumber)}>
          <span className="price">{price(v)}</span>
          <strong>{`${v.Year} ${v.Make} ${v.Model}`}</strong>
          <small>{`${v.Trim} · ${miles(v)} miles · #${v.StockNumber}${v.photos_pending ? ' · photos importing…' : ''}`}</small>
        </button>
      ))}
    </div>
  );
}
