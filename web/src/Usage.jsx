// Admin: the Usage dashboard — who did what, paid activity per day, estimated spend, recent activity.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStatus } from './ui.jsx';

// Activity kinds in a fixed order with their chart colours (validated on the dark surface: dataviz palette slots 1–4).
const KINDS = [['generate', 'AI videos', 'var(--series-1)'], ['narration_preview', 'Voice previews', 'var(--series-2)'],
  ['narration_lipsync', 'Lip-syncs', 'var(--series-3)'], ['footage_build', 'Footage videos', 'var(--series-4)']];
const ACTION = { generate: 'AI video', spokesperson_picture: 'AI spokesperson picture', spokesperson_save_draft: 'AI spokesperson saved', narration_preview: 'Voice preview', narration_lipsync: 'Lip-sync', footage_build: 'Footage video', finish: 'Captions re-rendered',
  narration_approve: 'Voice approved', job_delete: 'Video deleted', narration_delete: 'Preview deleted', narration_lipsync_delete: 'Lip-sync deleted', sync: 'Inventory import',
  import: 'ZIP import', client_add: 'Client added', client_details: 'Dealer details saved', client_analyze: 'Website analysed', spokesperson_upload: 'Spokesperson added',
  spokesperson_default: 'Default spokesperson', spokesperson_delete: 'Spokesperson deleted', user_create: 'Account created', user_update: 'Account changed',
  user_delete: 'Account deleted', password_change: 'Password changed', sign_in: 'Signed in', sign_in_failed: 'Failed sign-in' };
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export function UsageTool({ active }) {
  const [, say] = useStatus('usage');
  const [f, setF] = useState({ days: 30, client: '', user: '' });
  const [r, setR] = useState(null);
  const [names, setNames] = useState({ clients: [], users: [] });
  useEffect(() => {
    if (!active) return;
    api('users_list').then((d) => setNames({ clients: d.clients, users: d.users.map((u) => u.email) })).catch(() => {});
  }, [active]);
  useEffect(() => {
    if (!active) return;
    api('usage', f).then(setR).catch((e) => say(e.message, true));
  }, [active, f.days, f.client, f.user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return <section className="tool-section" id="usagePanel"><p>Loading usage…</p></section>;
  const clientName = Object.fromEntries(names.clients.map((c) => [c.id, c.name]));
  const userOptions = [...new Set([...names.users, ...r.users.map((u) => u.email)])].sort();
  const t = r.totals;
  return (
    <section className="tool-section usage" id="usagePanel">
      <div className="usage-filters">
        <div className="seg" role="group" aria-label="Period">
          {[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']].map(([d, l]) => (
            <button key={d} type="button" className={'secondary small' + (f.days === d ? ' on' : '')} aria-pressed={f.days === d} onClick={() => setF({ ...f, days: d })}>{l}</button>
          ))}
        </div>
        <select aria-label="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
          <option value="">All clients</option>{names.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="User" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}>
          <option value="">All users</option>{userOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="tiles">
        <Tile label="Estimated spend" value={money(t.cost)} note="AI videos at the estimated rate" />
        <Tile label="AI videos" value={t.generate} />
        <Tile label="Voice previews" value={t.narration_preview} />
        <Tile label="Lip-syncs" value={t.narration_lipsync} />
        <Tile label="Footage videos" value={t.footage_build} />
        <Tile label="Active users" value={t.active_users} note={`${t.sign_ins} sign-ins · ${t.failed_sign_ins} failed`} />
      </div>
      <h3>Paid activity per day</h3>
      <DailyChart days={r.per_day} />
      <h3>By user</h3>
      <Table head={['User', 'AI videos', 'Voice previews', 'Lip-syncs', 'Footage', 'Est. spend', 'Sign-ins', 'Last active']}
        rows={r.users.map((u) => [u.email, u.generate, u.narration_preview, u.narration_lipsync, u.footage_build, money(u.cost), u.sign_ins, when(u.last_active)])} />
      <h3>By client</h3>
      <Table head={['Client', 'AI videos', 'Voice previews', 'Lip-syncs', 'Footage', 'Est. spend']}
        rows={r.clients.map((c) => [clientName[c.id] ?? c.id, c.generate, c.narration_preview, c.narration_lipsync, c.footage_build, money(c.cost)])} />
      <h3>Recent activity</h3>
      <Table head={['When', 'User', 'What', 'Client', 'Details']}
        rows={r.recent.map((x) => [when(x.at), x.user, ACTION[x.action] ?? x.action, clientName[x.client] ?? x.client ?? '',
          [x.detail.vehicle ?? x.detail.stock, x.detail.duration ? x.detail.duration + ' s' : '', x.detail.email, x.cost ? 'est. ' + money(x.cost) : '', x.detail.backfilled ? 'from before tracking' : ''].filter(Boolean).join(' · ')])} />
      <p className="hint">Estimated cost per AI video: {money(r.costs.generate_30)} for 30 seconds, {money(r.costs.generate_15)} for 15 seconds (change in config cost_estimates). Voice previews and lip-syncs are counted, not priced. “before accounts” = made before sign-in accounts existed.</p>
    </section>
  );
}

function Tile({ label, value, note }) {
  return <div className="tile"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
function Table({ head, rows }) {
  if (!rows.length) return <p className="hint">Nothing in this period.</p>;
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

/** Stacked bars per day (one colour per kind, 2px gaps, rounded tops), legend, hover tooltip, table view. */
function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const W = 960, H = 240, L = 34, B = 26, T = 10;
  const totals = days.map((d) => KINDS.reduce((n, [k]) => n + d[k], 0));
  const max = Math.max(1, ...totals), step = max <= 5 ? 1 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step, plotH = H - B - T, slot = (W - L) / Math.max(1, days.length), bw = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v) => T + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(days.length / 10);
  return (
    <div className="chart">
      <div className="chart-head">
        <div className="legend">{KINDS.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l}</span>)}</div>
        <button type="button" className="secondary small" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      {asTable ? (
        <Table head={['Day', ...KINDS.map(([, l]) => l), 'Est. spend']} rows={days.filter((d, i) => totals[i]).map((d) => [d.day, ...KINDS.map(([k]) => d[k]), money(d.cost)])} />
      ) : (
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Paid activity per day, stacked by kind">
            {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
              <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} className="axis" textAnchor="end">{v}</text></g>
            ))}
            {days.map((d, i) => {
              const x = L + i * slot + (slot - bw) / 2;
              let acc = 0;
              const segs = KINDS.filter(([k]) => d[k]).map(([k, , c]) => { const y0 = y(acc), y1 = y(acc + d[k]); acc += d[k]; return { k, c, y: y1, h: Math.max(0, y0 - y1 - 2) }; });
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)}>
                  <rect x={L + i * slot} y={T} width={slot} height={plotH} fill="transparent" />
                  {segs.map((sg, j) => <rect key={sg.k} x={x} y={sg.y} width={bw} height={sg.h} rx={j === segs.length - 1 ? 4 : 0} fill={sg.c} />)}
                  {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 8} className="axis" textAnchor="middle">{d.day.slice(5)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%` }}>
              <strong>{days[hover].day}</strong>
              {KINDS.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l}: {days[hover][k]}</span>)}
              <span>Est. spend: {money(days[hover].cost)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
