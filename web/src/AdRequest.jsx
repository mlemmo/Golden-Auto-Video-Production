// "Run as ad": request a paid Meta (Facebook & Instagram) and/or TikTok ad for a finished video (ad_* actions,
// src/lib/ads.js). Meta requests are created PAUSED in the dealer's ad account by the ads worker (Meta's Marketing API)
// and spend only after Switch on; TikTok requests are launched by hand (docs/ADS_LAUNCH.md). Shows the video's requests
// with their status and results.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const NAME = { meta: 'Meta (Facebook & Instagram)', tiktok: 'TikTok' };
export const STATUS = { requested: 'Requested — waiting to be created (paused)', launching: 'Creating the ad (paused)…', launched_paused: 'Created, paused — press Switch on to run it',
  active: 'Running', paused: 'Paused', ended: 'Ended', failed: 'Failed', canceled: 'Cancelled' };
const MIN = { meta: 5, tiktok: 20 };
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const money = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const managerLink = (p, a, x) => (p === 'meta' && x.campaign_id ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a.meta_account.replace('act_', '')}&selected_campaign_ids=${x.campaign_id}`
  : p === 'tiktok' && x.campaign_id ? `https://ads.tiktok.com/i18n/perf/campaign?aadvid=${a.tiktok_account}` : '');

export function AdRequest({ v, onClose, say }) {
  const [st, setSt] = useState(null);
  const [ads, setAds] = useState([]);
  const [f, setF] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => api('ad_list', { id: v.id }).then((r) => setAds(r.ads)).catch((e) => say(e.message, true));
  useEffect(() => {
    api('ad_status', { id: v.id }).then((s) => {
      setSt(s);
      setF({ meta: s.meta, tiktok: s.tiktok && s.reels, daily_budget: Math.max(s.settings.daily_budget, s.tiktok && s.reels ? MIN.tiktok : MIN.meta), days: s.settings.days,
        start_date: today(), radius_address: s.settings.radius_address, radius_miles: s.settings.radius_miles, ...s.draft });
    }).catch((e) => say(e.message, true));
    refresh();
  }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setConfirm(false); };
  const platforms = f ? ['meta', 'tiktok'].filter((p) => f[p]) : [];
  const total = f ? Number(f.daily_budget || 0) * Number(f.days || 0) * platforms.length : 0;
  async function act(action, data) {
    setBusy(true);
    try { const r = await api(action, data); if (r.message) say(r.message); await refresh(); return true; }
    catch (e) { say(e.message, true); return false; } finally { setBusy(false); }
  }
  const submit = async () => {
    const ok = await act('ad_request', { id: v.id, platforms, daily_budget: Number(f.daily_budget), days: Number(f.days), start_date: f.start_date,
      radius_address: f.radius_address, radius_miles: Number(f.radius_miles), text: f.text, headline: f.headline, tiktok_text: f.tiktok_text, link: f.link });
    if (ok) setConfirm(false);
  };
  return (
    <div className="player-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="social-panel" role="dialog" aria-label={'Run ' + v.vehicle + ' as an ad'}>
        <div className="social-head"><h3>Run as ad</h3><button type="button" className="secondary small" onClick={onClose}>Close</button></div>
        <p className="hint">{v.vehicle} · paid ad in the dealer's own ad account. It is created <b>paused</b>; nothing is spent until you confirm it is switched on.</p>
        {!st || !f ? <p className="hint">Loading…</p> : !st.eligible ? <p className="note-important">{st.reason}</p> : (
          <>
            {!st.meta && !st.tiktok && <p className="note-important">No ad accounts are set for this dealer yet. An admin adds them under the dealer's View details → Paid ads.</p>}
            <div className="social-platforms">
              <label className="check"><input type="checkbox" checked={!!f.meta} disabled={!st.meta} onChange={set('meta')} />{NAME.meta}{!st.meta && ' (not set up)'}</label>
              <label className="check"><input type="checkbox" checked={!!f.tiktok} disabled={!st.tiktok || !st.reels} onChange={set('tiktok')} />TikTok{!st.tiktok ? ' (not set up)' : !st.reels ? ' (needs Reels 9:16)' : ''}</label>
            </div>
            <div className="import-grid">
              <label>Daily budget ($)<input type="number" min={f.tiktok ? MIN.tiktok : MIN.meta} max="1000" step="1" value={f.daily_budget} onChange={set('daily_budget')} /></label>
              <label>Days<input type="number" min="1" max="30" step="1" value={f.days} onChange={set('days')} /></label>
              <label>Start date<input type="date" min={today()} value={f.start_date} onChange={set('start_date')} /></label>
              <label>Radius (miles)<input type="number" min="1" max="50" value={f.radius_miles} onChange={set('radius_miles')} /></label>
            </div>
            <label>Target people around<input value={f.radius_address} placeholder="Dealership street address" onChange={set('radius_address')} /></label>
            {f.meta && <label>Ad text (Meta)<textarea rows={4} maxLength={2000} value={f.text} onChange={set('text')} /></label>}
            {f.meta && <label>Headline (Meta)<input maxLength={80} value={f.headline} onChange={set('headline')} /></label>}
            {f.tiktok && <label>TikTok caption<input maxLength={100} value={f.tiktok_text} onChange={set('tiktok_text')} /><small className="hint">{f.tiktok_text.length} / 100 · no emoji</small></label>}
            <label>Link<input type="url" value={f.link} onChange={set('link')} /></label>
            <small className="hint">Avoid financing, payment or credit wording: Meta restricts targeting for those ads.</small>
            {!confirm
              ? <button type="button" disabled={busy || !platforms.length} onClick={() => setConfirm(true)}>Request ad…</button>
              : (
                <div className="social-confirm note-important">
                  <p>Request a {platforms.map((p) => NAME[p]).join(' and ')} ad: {money(f.daily_budget)} a day for {f.days} day{Number(f.days) === 1 ? '' : 's'}
                    {platforms.length > 1 ? ' on each' : ''}, from {f.start_date} — up to <b>{money(total)}</b> in total. It is created paused; you confirm before it spends.</p>
                  <div className="actions">
                    <button type="button" disabled={busy} onClick={submit}>Yes, request it</button>
                    <button type="button" className="secondary" onClick={() => setConfirm(false)}>Back</button>
                  </div>
                </div>
              )}
          </>
        )}
        {ads.length > 0 && (
          <div className="social-list">
            <h4>Ads of this video</h4>
            {ads.map((a) => (
              <div key={a.id} className="job">
                <small>{`${money(a.daily_budget)}/day · ${a.start_date} to ${a.end_date} · ${a.radius_miles ?? Math.round(a.radius_km / 1.609344)} mi · ${a.created_by}`}</small>
                {Object.entries(a.platforms).map(([p, x]) => (
                  <div key={p} className="social-row">
                    <span><b>{NAME[p]}</b>: {STATUS[x.status] ?? x.status}</span>
                    {managerLink(p, a, x) && <a href={managerLink(p, a, x)} target="_blank" rel="noreferrer">Open in Ads Manager</a>}
                    {x.stats && <small className="hint">{`${money(x.stats.spend)} spent · ${x.stats.impressions.toLocaleString()} views · ${x.stats.clicks.toLocaleString()} clicks`}</small>}
                    {x.want && <small className="hint">{x.want === 'active' ? 'Switching on…' : 'Pausing…'}</small>}
                    {x.error && <small className="hint">{x.error}</small>}
                    {p === 'meta' && !x.want && (
                      <span className="actions">
                        {['launched_paused', 'paused'].includes(x.status) && <button type="button" className="small" disabled={busy}
                          onClick={() => { if (window.confirm(`Switch on? It spends up to ${money(a.daily_budget)} a day until ${a.end_date}.`)) act('ad_switch_on', { id: a.id }); }}>Switch on</button>}
                        {x.status === 'active' && <button type="button" className="secondary small" disabled={busy} onClick={() => act('ad_pause', { id: a.id })}>Pause</button>}
                        {x.status === 'failed' && <button type="button" className="secondary small" disabled={busy} onClick={() => act('ad_retry', { id: a.id })}>Retry</button>}
                      </span>
                    )}
                  </div>
                ))}
                {Object.values(a.platforms).some((x) => x.status === 'requested') && <div className="actions"><button type="button" className="secondary small" disabled={busy} onClick={() => act('ad_cancel', { id: a.id })}>Cancel request</button></div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
