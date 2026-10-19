// Step 1: the client (dealer) and its inventory. Each client has its own inventory, voice previews and videos.
import { useState } from 'react';
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
      <ClientBar />
      {c && <ClientInfo key={'info-' + c.id} />}
      {c && <DealerDetails key={'dealer-' + c.id + JSON.stringify(c.script_details)} />}
      <div className="step-head"><span className="step-num">1</span><div><h2>Choose a vehicle</h2><p id="syncTime">{inventoryLine(s.inventory)}</p></div></div>
      {c?.id === 'golden-auto' && <SyncLog />}
      <SyncButton say={say} />
      <Inventory say={say} />
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
    <>
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
    </>
  );
}

function ClientInfo() {
  const s = useStudio();
  const [, say] = s.statuses.vehicle;
  const c = s.client, a = c.analysis || {};
  const [open, setOpen] = useState(false);
  const analyze = () => s.run(async () => {
    say('Analyzing the website…');
    try {
      const r = await api('client_analyze', { id: c.id });
      s.setClients((cl) => ({ ...cl, items: cl.items.map((x) => (x.id === r.client.id ? r.client : x)) }));
      setOpen(true); say('Website analyzed.');
    } catch (e) { say(e.message, true); }
  });
  return (
    <details id="clientInfo" className="sub" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary id="clientSummary">{`${c.name} · ${c.website.replace('https://', '')} · import: ${METHOD_TITLE[a.best] || 'not checked yet'}`}</summary>
      <div id="clientAnalysis">
        {a.note && <p>{a.note}</p>}
        {a.platform && <p>Website platform: {a.platform}</p>}
        {a.dealer && <p>Dealer details found: {Object.values(a.dealer).join(', ')}</p>}
        {a.signals?.length > 0 && <><b>What the website shows</b><ul>{a.signals.map((sig, i) => <li key={i}>{sig}</li>)}</ul></>}
        {a.options?.length > 0 && <><b>Import options, best first</b><ol>{a.options.map((o, i) => <li key={i}><strong>{o.title}</strong><p>{o.why}</p><small>{o.effort}</small></li>)}</ol></>}
        {a.checked_at && <small>Checked {new Date(a.checked_at).toLocaleString()}</small>}
      </div>
      {c.id !== 'golden-auto' && <button type="button" className="secondary small" id="clientAnalyze" disabled={s.busy} onClick={analyze}>Analyze website again</button>}
    </details>
  );
}

function DealerDetails() {
  const s = useStudio();
  const [, say] = s.statuses.vehicle;
  const c = s.client, d = c.script_details || {}, fixed = c.id === 'golden-auto';
  const [form, setForm] = useState({ name: d.name || '', city: d.city || '', website: d.website || '', website_spoken: d.website_spoken || '' });
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const save = (e) => {
    e.preventDefault();
    s.run(async () => {
      try {
        const r = await api('client_details', form);
        s.setClients((cl) => ({ ...cl, items: cl.items.map((x) => (x.id === r.client.id ? r.client : x)) }));
        say('Dealer details saved. Reopen a vehicle to redraft its script with them.');
      } catch (err) { say(err.message, true); }
    });
  };
  return (
    <details id="dealerInfo" className="sub">
      <summary id="dealerSummary">{`Dealer details in scripts — ${d.name}${d.city ? ' in ' + d.city : ''} · ${d.website}`}</summary>
      <p className="hint" id="dealerFixed" hidden={!fixed}>Golden Auto’s scripts say “Golden Auto in San Ramon” and mygoldenauto.net.</p>
      <form id="dealerForm" hidden={fixed} onSubmit={save}>
        <div className="import-grid">
          <label>Dealer name in scripts<input name="name" maxLength={80} required {...field('name')} /></label>
          <label>City<input name="city" maxLength={60} {...field('city')} /></label>
          <label>Website as shown<input name="website" maxLength={100} required placeholder="example.com" {...field('website')} /></label>
          <label>Website as spoken<input name="website_spoken" maxLength={120} placeholder="example dot com" {...field('website_spoken')} /></label>
        </div>
        <p className="hint">Scripts say “here at <i>name</i> in <i>city</i>” and “Book your test drive today at <i>website</i>”; the voice says the website as written in “as spoken”. Reopen a vehicle after saving to redraft its script.</p>
        <button id="dealerSave" className="secondary" disabled={s.busy}>Save dealer details</button>
      </form>
    </details>
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
