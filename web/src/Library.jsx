// The Library: every finished video for the clients this account may use, in a clean full-page gallery for showing
// customers — watch inline, open a large player (with full screen), download.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { useStatus } from './ui.jsx';

const FORMAT = { instagram_reels: 'Reels 9:16', facebook_reels: 'Reels 9:16', facebook_feed: 'Feed 4:5', square: 'Square 1:1' };
const money = (p) => (p == null ? 'Call for price' : '$' + Math.round(p).toLocaleString('en-US'));
const fileName = (v) => `${v.vehicle} ${v.stock}`.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.mp4';

export function Library({ open, onClose }) {
  const [, say] = useStatus('library');
  const [data, setData] = useState(null);
  const [client, setClient] = useState('');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState(null);
  useEffect(() => { if (open) api('library').then(setData).catch((e) => say(e.message, true)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') (playing ? setPlaying(null) : onClose()); };
    document.addEventListener('keydown', esc); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, playing, onClose]);
  if (!open) return null;
  const names = Object.fromEntries((data?.clients ?? []).map((c) => [c.id, c.name]));
  const shown = (data?.videos ?? []).filter((v) => (!client || v.client === client) && (!q || `${v.vehicle} ${v.stock}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="library" id="library" role="dialog" aria-modal="true" aria-label="Video library">
      <div className="tool-window-head">
        <h2>Video library</h2>
        <button type="button" className="secondary" id="libraryClose" onClick={onClose}>Close</button>
      </div>
      <div className="library-body">
        <div className="usage-filters">
          {(data?.clients.length ?? 0) > 1 && (
            <select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">All clients</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input type="search" aria-label="Search" placeholder="Search by car or stock number" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="library-count">{data ? `${shown.length} video${shown.length === 1 ? '' : 's'}` : 'Loading…'}</span>
        </div>
        {data && !shown.length && <p className="hint">No finished videos yet.</p>}
        <div className="library-grid">
          {shown.map((v) => (
            <article key={v.id} className="library-card">
              <button type="button" className="library-thumb" aria-label={'Play ' + v.vehicle} onClick={() => setPlaying(v)}>
                <video src={v.url + '#t=1'} preload="metadata" muted playsInline />
                <span className="play" aria-hidden="true">▶</span>
              </button>
              <div className="library-meta">
                <strong>{v.vehicle}</strong>
                <span className="library-price">{money(v.price)}</span>
                <small>{[names[v.client], FORMAT[v.format], v.duration ? v.duration + ' s' : '', v.created_at ? new Date(v.created_at).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</small>
              </div>
              <div className="actions">
                <button type="button" className="small" onClick={() => setPlaying(v)}>Watch</button>
                <a className="button small secondary-link" href={v.url} download={fileName(v)}>Download</a>
              </div>
            </article>
          ))}
        </div>
      </div>
      {playing && <Player v={playing} client={names[playing.client]} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/** Large player for presenting: plays at once; Full screen and Download beside it. */
function Player({ v, client, onClose }) {
  const ref = useRef(null);
  const full = () => { const el = ref.current; (el.requestFullscreen ?? el.webkitEnterFullscreen)?.call(el); };
  return (
    <div className="player-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="player" role="dialog" aria-label={v.vehicle}>
        <video ref={ref} src={v.url} controls autoPlay playsInline />
        <div className="player-info">
          <div><strong>{v.vehicle}</strong><span>{money(v.price)}{client ? ' · ' + client : ''}</span></div>
          <div className="actions">
            <button type="button" className="secondary" onClick={full}>Full screen</button>
            <a className="button" href={v.url} download={fileName(v)}>Download</a>
            <button type="button" className="secondary" id="playerClose" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
