// Post a finished video to the dealer's Facebook Page and Instagram as a Reel, now or at a chosen time
// (social_* actions, src/lib/social.js). The social worker publishes within a minute of the time; this panel shows
// each post's progress and links, and lets the user cancel a scheduled post or retry a failed one.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const NAME = { facebook: 'Facebook', instagram: 'Instagram' };
export const STATUS = { scheduled: 'Scheduled', uploading: 'Uploading', processing: 'Processing at Meta', publishing: 'Publishing', published: 'Published',
  failed: 'Failed', check: 'Check the page', canceled: 'Cancelled' };
export const PENDING = ['scheduled', 'uploading', 'processing', 'publishing'];
export const when = (t) => (t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
/** datetime-local value for a time, in the viewer's time zone. */
const localInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function SocialPost({ v, onClose, say }) {
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [fb, setFb] = useState(true);
  const [ig, setIg] = useState(true);
  const [caption, setCaption] = useState('');
  const [mode, setMode] = useState('now');
  const [at, setAt] = useState(() => localInput(Date.now() + 3600000));
  const [again, setAgain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => api('social_list', { id: v.id }).then((r) => setPosts(r.posts)).catch((e) => say(e.message, true));
  useEffect(() => {
    api('social_status', { id: v.id }).then((s) => { setStatus(s); setCaption(s.caption); setFb(s.facebook); setIg(s.instagram); }).catch((e) => say(e.message, true));
    refresh();
  }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While something is on its way, the list refreshes every 20 seconds.
  const pending = posts.some((p) => Object.values(p.platforms).some((x) => PENDING.includes(x.status)));
  useEffect(() => { if (!pending) return undefined; const t = setInterval(refresh, 20000); return () => clearInterval(t); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = [fb && 'facebook', ig && 'instagram'].filter(Boolean);
  const target = chosen.map((p) => NAME[p]).join(' and ');
  async function act(action, data) {
    setBusy(true);
    try { const r = await api(action, data); if (r.message) say(r.message); await refresh(); return true; }
    catch (e) { say(e.message, true); return false; } finally { setBusy(false); }
  }
  async function post() {
    const ok = await act('social_post', { id: v.id, platforms: chosen, caption, when: mode === 'now' ? 'now' : new Date(at).toISOString(), again });
    if (ok) { setConfirm(false); setAgain(false); }
  }
  const none = status && !status.facebook && !status.instagram;
  return (
    <div className="player-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="social-panel" role="dialog" aria-label={'Post ' + v.vehicle}>
        <div className="social-head"><h3>Post to Facebook &amp; Instagram</h3><button type="button" className="secondary small" onClick={onClose}>Close</button></div>
        <p className="hint">{v.vehicle}</p>
        {!status ? <p className="hint">Loading…</p> : !status.eligible ? <p className="note-important">{status.reason}</p> : (
          <>
            {none && <p className="note-important">Facebook and Instagram are not connected for this dealer yet. Choose the dealer at the top of the dashboard, open View details and press Connect Facebook &amp; Instagram.</p>}
            <div className="social-platforms">
              <label className="check"><input type="checkbox" checked={fb} disabled={!status.facebook} onChange={(e) => { setFb(e.target.checked); setConfirm(false); }} />Facebook Page{!status.facebook && ' (not connected)'}</label>
              <label className="check"><input type="checkbox" checked={ig} disabled={!status.instagram} onChange={(e) => { setIg(e.target.checked); setConfirm(false); }} />Instagram{!status.instagram && ' (not connected)'}</label>
            </div>
            <label>Caption
              <textarea rows={6} maxLength={2200} value={caption} onChange={(e) => { setCaption(e.target.value); setConfirm(false); }} />
              <small className="hint">{caption.length} / 2200 · posted as a Reel on both</small>
            </label>
            <div className="social-when">
              <label className="check"><input type="radio" name="socialWhen" checked={mode === 'now'} onChange={() => { setMode('now'); setConfirm(false); }} />Post now</label>
              <label className="check"><input type="radio" name="socialWhen" checked={mode === 'later'} onChange={() => { setMode('later'); setConfirm(false); }} />Schedule</label>
              {mode === 'later' && <input type="datetime-local" aria-label="Post at" value={at} min={localInput(Date.now() + 11 * 60000)} max={localInput(Date.now() + 29 * 86400000)} onChange={(e) => { setAt(e.target.value); setConfirm(false); }} />}
            </div>
            {posts.some((p) => Object.values(p.platforms).some((x) => ['published', 'check'].includes(x.status))) && (
              <label className="check"><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />Post again (this video was posted before)</label>
            )}
            {!confirm
              ? <button type="button" disabled={busy || !chosen.length || !caption.trim() || (mode === 'later' && !at)} onClick={() => setConfirm(true)}>{mode === 'now' ? 'Post now…' : 'Schedule…'}</button>
              : (
                <div className="social-confirm note-important">
                  <p>This will publish <b>publicly</b> to {target} {mode === 'now' ? <b>now</b> : <>on <b>{when(new Date(at))}</b></>}.</p>
                  <div className="actions">
                    <button type="button" id="socialConfirm" disabled={busy} onClick={post}>{mode === 'now' ? 'Yes, post now' : 'Yes, schedule'}</button>
                    <button type="button" className="secondary" onClick={() => setConfirm(false)}>Back</button>
                  </div>
                </div>
              )}
          </>
        )}
        {posts.length > 0 && (
          <div className="social-list">
            <h4>Posts of this video</h4>
            {posts.map((p) => (
              <div key={p.id} className="job">
                <small>{(Object.values(p.platforms).some((x) => x.status === 'scheduled') ? 'For ' : '') + when(p.scheduled_at) + (p.created_by ? ' · ' + p.created_by : '')}</small>
                {Object.entries(p.platforms).map(([k, x]) => (
                  <div key={k} className="social-row">
                    <span><b>{NAME[k]}</b>: {STATUS[x.status] ?? x.status}</span>
                    {x.url && <a href={x.url} target="_blank" rel="noreferrer">Open</a>}
                    {x.error && <small className="hint">{x.error}</small>}
                  </div>
                ))}
                <div className="actions">
                  {Object.values(p.platforms).some((x) => x.status === 'scheduled') && <button type="button" className="secondary small" disabled={busy} onClick={() => act('social_cancel', { id: p.id })}>Cancel</button>}
                  {Object.values(p.platforms).some((x) => x.status === 'failed') && <button type="button" className="secondary small" disabled={busy} onClick={() => act('social_retry', { id: p.id })}>Retry</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
