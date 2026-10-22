// Top-bar windows for everything posted and advertised, across the clients this account may use:
// Posts (Facebook & Instagram posts: scheduled, in progress, published, problems) and Ads (paid ad requests and ads).
// They read social_list / ad_list; Cancel and Retry are the same actions as in the Library's panels.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { useStatus } from './ui.jsx';
import { NAME as POST_NAME, STATUS as POST_STATUS, PENDING as POST_PENDING, when } from './SocialPost.jsx';
import { NAME as AD_NAME, STATUS as AD_STATUS, money, managerLink } from './AdRequest.jsx';

const POST_FILTERS = [['', 'All'], ['pending', 'Scheduled & in progress'], ['published', 'Published'], ['problem', 'Problems']];
const AD_FILTERS = [['', 'All'], ['requested', 'Waiting to launch'], ['launched_paused', 'Paused'], ['active', 'Running'], ['ended', 'Ended'], ['problem', 'Problems']];

/** Full-page window shared by both: header, client and status filters, auto-refresh while something is under way. */
function Window({ id, title, open, onClose, load, filters, children }) {
  const [, say] = useStatus(id);
  const s = useStudio();
  const [rows, setRows] = useState(null);
  const [client, setClient] = useState('');
  const [filter, setFilter] = useState('');
  const refresh = () => load().then(setRows).catch((e) => say(e.message, true));
  useEffect(() => { if (open) refresh(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(refresh, 30000);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc); document.body.style.overflow = 'hidden';
    return () => { clearInterval(t); document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const clients = s.clients.items ?? [];
  const names = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  const act = async (action, data) => { try { const r = await api(action, data); if (r.message) say(r.message); await refresh(); } catch (e) { say(e.message, true); } };
  return (
    <div className="library" id={id} role="dialog" aria-modal="true" aria-label={title}>
      <div className="tool-window-head">
        <h2>{title}</h2>
        <div className="actions"><button type="button" className="secondary small" onClick={refresh}>Refresh</button><button type="button" className="secondary" onClick={onClose}>Close</button></div>
      </div>
      <div className="library-body">
        <div className="usage-filters">
          {clients.length > 1 && (
            <select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}>{filters.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        {rows === null ? <p className="hint">Loading…</p> : children({ rows: rows.filter((r) => !client || r.client === client), filter, names, act })}
      </div>
    </div>
  );
}

const postMatches = (p, f) => {
  const st = Object.values(p.platforms).map((x) => x.status);
  return !f || (f === 'pending' && st.some((x) => POST_PENDING.includes(x))) || (f === 'published' && st.includes('published')) || (f === 'problem' && st.some((x) => ['failed', 'check'].includes(x)));
};

export function PostsWindow({ open, onClose }) {
  return (
    <Window id="postsWindow" title="Posts — Facebook & Instagram" open={open} onClose={onClose} filters={POST_FILTERS} load={() => api('social_list', {}).then((r) => r.posts)}>
      {({ rows, filter, names, act }) => {
        const shown = rows.filter((p) => postMatches(p, filter));
        if (!shown.length) return <p className="hint">No posts here yet. Post a finished video from the Library (Post).</p>;
        return (
          <div className="activity-list">
            {shown.map((p) => (
              <article key={p.id} className="activity-row">
                <div className="activity-main">
                  <strong>{p.vehicle}</strong>
                  <small>{[names[p.client], (Object.values(p.platforms).some((x) => x.status === 'scheduled') ? 'for ' : '') + when(p.scheduled_at), p.created_by].filter(Boolean).join(' · ')}</small>
                  <small className="hint activity-caption">{p.caption}</small>
                </div>
                <div className="activity-platforms">
                  {Object.entries(p.platforms).map(([k, x]) => (
                    <div key={k} className={'activity-status status-' + x.status}>
                      <b>{POST_NAME[k]}</b> {POST_STATUS[x.status] ?? x.status}
                      {x.url && <> · <a href={x.url} target="_blank" rel="noreferrer">Open</a></>}
                      {x.error && <small className="hint">{x.error}</small>}
                    </div>
                  ))}
                  <div className="actions">
                    {Object.values(p.platforms).some((x) => x.status === 'scheduled') && <button type="button" className="secondary small" onClick={() => act('social_cancel', { id: p.id })}>Cancel</button>}
                    {Object.values(p.platforms).some((x) => x.status === 'failed') && <button type="button" className="secondary small" onClick={() => act('social_retry', { id: p.id })}>Retry</button>}
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

const adMatches = (a, f) => {
  const st = Object.values(a.platforms).map((x) => x.status);
  return !f || (f === 'problem' ? st.includes('failed') || Object.values(a.platforms).some((x) => x.error && x.status === 'requested') : st.includes(f));
};

export function AdsWindow({ open, onClose }) {
  return (
    <Window id="adsWindow" title="Ads — Meta & TikTok" open={open} onClose={onClose} filters={AD_FILTERS} load={() => api('ad_list', {}).then((r) => r.ads)}>
      {({ rows, filter, names, act }) => {
        const shown = rows.filter((a) => adMatches(a, filter));
        const live = shown.flatMap((a) => Object.values(a.platforms)).filter((x) => x.status === 'active').length;
        const spend = shown.flatMap((a) => Object.values(a.platforms)).reduce((n, x) => n + (x.stats?.spend ?? 0), 0);
        return (
          <>
            <p className="activity-summary">{`${shown.length} request${shown.length === 1 ? '' : 's'} · ${live} running · ${money(spend)} spent so far`}</p>
            {!shown.length && <p className="hint">No ads here yet. Request one from the Library (Run as ad).</p>}
            <div className="activity-list">
              {shown.map((a) => (
                <article key={a.id} className="activity-row">
                  <div className="activity-main">
                    <strong>{a.vehicle}</strong>
                    <small>{[names[a.client], `${money(a.daily_budget)}/day`, `${a.start_date} to ${a.end_date}`, `${a.radius_miles ?? Math.round(a.radius_km / 1.609344)} mi around ${a.radius_address}`, a.created_by].filter(Boolean).join(' · ')}</small>
                  </div>
                  <div className="activity-platforms">
                    {Object.entries(a.platforms).map(([k, x]) => (
                      <div key={k} className={'activity-status status-' + x.status}>
                        <b>{AD_NAME[k]}</b> {AD_STATUS[x.status] ?? x.status}
                        {managerLink(k, a, x) && <> · <a href={managerLink(k, a, x)} target="_blank" rel="noreferrer">Ads Manager</a></>}
                        {x.stats && <small className="hint">{`${money(x.stats.spend)} spent · ${x.stats.impressions.toLocaleString()} views · ${x.stats.clicks.toLocaleString()} clicks`}</small>}
                        {x.error && <small className="hint">{x.error}</small>}
                      </div>
                    ))}
                    {Object.values(a.platforms).some((x) => x.status === 'requested') && <div className="actions"><button type="button" className="secondary small" onClick={() => act('ad_cancel', { id: a.id })}>Cancel request</button></div>}
                    {!Object.values(a.platforms).some((x) => ['requested', 'launching'].includes(x.status)) && <div className="actions"><button type="button" className="secondary small" onClick={() => { if (window.confirm('Remove this ad from the list? Do this only after deleting or stopping it in Meta Ads Manager (or TikTok). Nothing is changed in the ad account.')) act('ad_remove', { id: a.id, confirm_deleted: true }); }}>Remove from list</button></div>}
                  </div>
                </article>
              ))}
            </div>
          </>
        );
      }}
    </Window>
  );
}
