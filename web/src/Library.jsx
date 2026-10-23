// The Library: every finished video and still for the clients this account may use, in a clean full-page gallery for
// showing customers — by category (AI videos, slideshows, footage, stills) and, across clients, one section per
// client; watch inline, open a large player (with full screen) or picture, download.
import { cloneElement, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { useStatus, DangerButton } from './ui.jsx';
import { SocialPost } from './SocialPost.jsx';
import { AdRequest } from './AdRequest.jsx';

const REELS = ['instagram_reels', 'facebook_reels'];
const FORMAT = { instagram_reels: 'Reels 9:16', facebook_reels: 'Reels 9:16', facebook_feed: 'Feed 4:5', square: 'Square 1:1', youtube: 'YouTube 16:9' };
const money = (p) => (p == null ? 'Call for price' : '$' + Math.round(p).toLocaleString('en-US'));
/** Share a video's public page: the phone's share sheet when there is one, else copy the link. */
async function shareVideo(v, say) {
  const url = location.origin + '/v/' + v.id;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: v.vehicle, url }); return; }
    await navigator.clipboard.writeText(url);
    say('Link copied: ' + url);
  } catch (e) { if (e?.name !== 'AbortError') window.prompt('Copy this link:', url); }
}
const fileName = (v, ext = '.mp4') => `${v.vehicle} ${v.stock}`.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + ext;
// Library categories: [id, tab label, what an empty one says].
const KIND = { ai: 'AI video', slideshow: 'Slideshow', footage: 'My footage' };
const CATEGORIES = [['all', 'All'], ['ai', 'AI videos'], ['slideshow', 'Slideshows'], ['footage', 'My footage'], ['stills', 'Stills']];
const EMPTY = { all: 'Nothing finished yet.', ai: 'No AI videos yet.', slideshow: 'No slideshow videos yet.', footage: 'No videos from your footage yet.',
  stills: 'No stills yet. Build a photo slideshow with a showroom background: the car pictures it makes appear here, ready for image ads.' };

export function Library({ open, onClose }) {
  const [, say] = useStatus('library');
  const [data, setData] = useState(null);
  const [client, setClient] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [playing, setPlaying] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [posting, setPosting] = useState(null);
  const [advertising, setAdvertising] = useState(null);
  // Grid (large cards) or list (small thumbnails, several can be selected and deleted together); remembered per browser.
  const [view, setViewRaw] = useState(() => { try { return localStorage.getItem('library-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const setView = (v) => { setViewRaw(v); try { localStorage.setItem('library-view', v); } catch { /* not stored */ } };
  const [selected, setSelected] = useState(() => new Set());   // keys "video:<id>" / "still:<id>"
  const [deleting, setDeleting] = useState(false);
  // Pages sized to the screen: as many whole cards (or list rows) as fit below the filters, measured from the real
  // layout and again whenever the window or the view changes; back to page 1 when the filters change.
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(12);
  const scrollRef = useRef(null), firstRef = useRef(null), pagerRef = useRef(null);
  useEffect(() => { setPage(0); }, [client, q, category, view]);
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = scrollRef.current, first = firstRef.current;
      if (!box || !first) return;
      const holder = first.parentElement, style = getComputedStyle(holder);
      const gap = parseFloat(style.rowGap) || 0;
      const cols = view === 'list' ? 1 : Math.max(1, style.gridTemplateColumns.split(' ').filter(Boolean).length);
      const top = holder.getBoundingClientRect().top - box.getBoundingClientRect().top;
      // Room left for items: below the filters, above the pager (and its margin and the page's bottom padding).
      const room = box.clientHeight - top - (pagerRef.current?.offsetHeight ?? 34) - 56;
      const rows = Math.max(1, Math.floor((room + gap) / (first.offsetHeight + gap)));
      setPerPage((n) => (n === cols * rows ? n : cols * rows));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (scrollRef.current) ro.observe(scrollRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [open, view, data, category, client, q]);
  const { readOnly } = useStudio();
  useEffect(() => { if (open) api('library').then(setData).catch((e) => say(e.message, true)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') (advertising ? setAdvertising(null) : posting ? setPosting(null) : playing ? setPlaying(null) : viewing ? setViewing(null) : onClose()); };
    document.addEventListener('keydown', esc); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, playing, viewing, posting, advertising, onClose]);
  // Delete a video (job_delete): gone from the Library, the Videos step and this server; never undone.
  const remove = async (v) => {
    try {
      const r = await api('job_delete', { id: v.id });
      const d = await api('library');
      setData(d);
      if (playing?.id === v.id) setPlaying(null);
      say(r.message || 'Video deleted.');
    } catch (e) { say(e.message, true); }
  };
  const removeStill = async (x) => {
    try {
      const r = await api('still_delete', { id: x.id });
      setData((d) => ({ ...d, stills: d.stills.filter((s) => s.id !== x.id) }));
      if (viewing?.id === x.id) setViewing(null);
      say(r.message || 'Still deleted.');
    } catch (e) { say(e.message, true); }
  };
  /**
   * Delete everything selected, one at a time: stills first (deleting a slideshow video also removes its own stills),
   * then videos. Ones the server refuses (a post still scheduled, a render running) stay and are reported.
   */
  const removeSelected = async (keys) => {
    setDeleting(true);
    const order = [...keys].sort((a, b) => (a.startsWith('still:') ? 0 : 1) - (b.startsWith('still:') ? 0 : 1));
    let done = 0; const failed = [];
    for (const key of order) {
      const [type, ...rest] = key.split(':'); const id = rest.join(':');
      try { await api(type === 'still' ? 'still_delete' : 'job_delete', { id }); done++; }
      catch (e) { if (!(type === 'still' && /not found/i.test(e.message))) failed.push(e.message); else done++; }
    }
    try { setData(await api('library')); } catch (e) { say(e.message, true); }
    setSelected(new Set()); setDeleting(false);
    setPlaying(null); setViewing(null);
    if (failed.length) say(`Deleted ${done} of ${order.length}. Not deleted: ${[...new Set(failed)].join(' ')}`, true);
    else say(`Deleted ${done} item${done === 1 ? '' : 's'}.`);
  };
  if (!open) return null;
  const names = Object.fromEntries((data?.clients ?? []).map((c) => [c.id, c.name]));
  const match = (v) => (!client || v.client === client) && (!q || `${v.vehicle} ${v.stock}`.toLowerCase().includes(q.toLowerCase()));
  // Everything matching the client and search, newest first: { type: 'video' | 'still', cat, item }.
  const items = [...(data?.videos ?? []).map((v) => ({ type: 'video', cat: v.kind ?? 'ai', item: v })), ...(data?.stills ?? []).map((x) => ({ type: 'still', cat: 'stills', item: x }))]
    .filter((x) => match(x.item)).sort((a, b) => String(b.item.created_at).localeCompare(String(a.item.created_at)));
  const count = (c) => items.filter((x) => c === 'all' || x.cat === c).length;
  const matching = items.filter((x) => category === 'all' || x.cat === category);
  const pages = Math.max(1, Math.ceil(matching.length / perPage));
  const at = Math.min(page, pages - 1);
  const shown = matching.slice(at * perPage, (at + 1) * perPage);
  const keyOf = (x) => x.type + ':' + x.item.id;
  const shownKeys = shown.map(keyOf);
  const picked = shownKeys.filter((k) => selected.has(k));   // only what is on screen can be deleted
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const toggle = (k, on) => setSelected((cur) => { const next = new Set(cur); if (on) next.add(k); else next.delete(k); return next; });
  const pickAll = (on) => setSelected(on ? new Set(shownKeys) : new Set());
  const pickBox = (x) => !readOnly && (
    <input type="checkbox" className="library-pick" aria-label={'Select ' + x.item.vehicle} checked={selected.has(keyOf(x))} onChange={(e) => toggle(keyOf(x), e.target.checked)} />
  );
  // The first item on the page is measured to size the pages.
  const withRef = (el, title, i) => (i === 0 && title === (sections[0]?.[0] ?? null) ? cloneElement(el, { ref: firstRef }) : el);
  const listRow = (x) => {
    const v = x.item, video = x.type === 'video';
    return (
      <div key={keyOf(x)} className={'library-row' + (selected.has(keyOf(x)) ? ' picked' : '')}>
        {pickBox(x)}
        <button type="button" className="library-mini" aria-label={(video ? 'Play ' : 'View ') + v.vehicle} onClick={() => (video ? setPlaying(v) : setViewing(v))}>
          {video && !v.poster ? <video src={v.url + '#t=1'} preload="metadata" muted playsInline /> : <img src={video ? v.poster : v.url} alt="" loading="lazy" />}
        </button>
        <div className="library-row-main">
          <strong>{v.vehicle}</strong>
          <small>{[video ? KIND[v.kind ?? 'ai'] : 'Still' + (v.background ? ' · ' + v.background : ''), FORMAT[v.format], v.duration ? v.duration + ' s' : '', money(v.price)].filter(Boolean).join(' · ')}</small>
        </div>
        <small className="library-row-date">{v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}</small>
        <div className="actions">
          <button type="button" className="small secondary" onClick={() => (video ? setPlaying(v) : setViewing(v))}>{video ? 'Watch' : 'View'}</button>
          <a className="button small secondary-link" href={v.url} download={fileName(v, video ? '.mp4' : '.jpg')}>Download</a>
        </div>
      </div>
    );
  };
  // Across several clients: one section per client (in the client list's order); one client: a single grid.
  const sections = !client && (data?.clients.length ?? 0) > 1
    ? data.clients.map((c) => [c.name, shown.filter((x) => x.item.client === c.id)]).filter(([, xs]) => xs.length)
    : [[null, shown]];
  const meta = (v, extra) => [extra, FORMAT[v.format], v.duration ? v.duration + ' s' : '', v.created_at ? new Date(v.created_at).toLocaleDateString() : ''].filter(Boolean).join(' · ');
  const videoCard = (v) => (
    <article key={v.id} className={'library-card' + (selected.has('video:' + v.id) ? ' picked' : '')}>
      {pickBox({ type: 'video', item: v })}
      <button type="button" className="library-thumb" aria-label={'Play ' + v.vehicle} onClick={() => setPlaying(v)}>
        {v.poster ? <img src={v.poster} alt="" loading="lazy" /> : <video src={v.url + '#t=1'} preload="metadata" muted playsInline />}
        <span className="play" aria-hidden="true">▶</span>
      </button>
      <div className="library-meta">
        <strong>{v.vehicle}</strong>
        <span className="library-price">{money(v.price)}</span>
        <small>{meta(v, KIND[v.kind ?? 'ai'])}</small>
        {v.speech_check?.ok === false && <span className="badge bad" title={v.speech_check.issues.map((x) => x.message).join('\n')}>⚠ Speech check: {v.speech_check.issues.length} difference{v.speech_check.issues.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="actions">
        <button type="button" className="small" onClick={() => setPlaying(v)}>Watch</button>
        <a className="button small secondary-link" href={v.url} download={fileName(v)}>Download</a>
        <button type="button" className="secondary small share-btn" onClick={() => shareVideo(v, say)}>Share</button>
        {!readOnly && <button type="button" className="secondary small" title={REELS.includes(v.format) ? 'Post to Facebook & Instagram' : 'Make the Reels 9:16 format to post'} onClick={() => setPosting(v)}>Post</button>}
        {!readOnly && <button type="button" className="secondary small" onClick={() => setAdvertising(v)}>Run as ad</button>}
        {!readOnly && <DangerButton label="Delete" what={`this video of the ${v.vehicle}`} detail="It is removed from the Library, the Videos list and this server. Copies you downloaded or posts already published on Facebook or Instagram are not affected." onConfirm={() => remove(v)} />}
      </div>
    </article>
  );
  const stillCard = (x) => (
    <article key={x.id} className={'library-card' + (selected.has('still:' + x.id) ? ' picked' : '')}>
      {pickBox({ type: 'still', item: x })}
      <button type="button" className="library-thumb still" aria-label={'View ' + x.vehicle} onClick={() => setViewing(x)}>
        <img src={x.url} alt={x.vehicle} loading="lazy" />
      </button>
      <div className="library-meta">
        <strong>{x.vehicle}</strong>
        <span className="library-price">{money(x.price)}</span>
        <small>{meta(x, x.background ? 'Still · ' + x.background : 'Still')}</small>
      </div>
      <div className="actions">
        <button type="button" className="small" onClick={() => setViewing(x)}>View</button>
        <a className="button small secondary-link" href={x.url} download={fileName(x, '.jpg')}>Download</a>
        {!readOnly && <DangerButton label="Delete" what={`this still of the ${x.vehicle}`} detail="The picture is removed from the Library and this server. Videos made with it are not changed." onConfirm={() => removeStill(x)} />}
      </div>
    </article>
  );
  return (
    <div className="library" id="library" role="dialog" aria-modal="true" aria-label="Library" ref={scrollRef}>
      <div className="tool-window-head">
        <h2>Library</h2>
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
          <span className="library-count">{data ? `${matching.length} item${matching.length === 1 ? '' : 's'}` : 'Loading…'}</span>
          <span className="library-view" role="group" aria-label="View">
            <button type="button" className={'small' + (view === 'grid' ? '' : ' secondary')} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button>
            <button type="button" className={'small' + (view === 'list' ? '' : ' secondary')} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </span>
        </div>
        {!readOnly && data && shown.length > 0 && (
          <div className="library-select">
            <label className="check"><input type="checkbox" checked={allPicked} onChange={(e) => pickAll(e.target.checked)} />Select all {shown.length}</label>
            {picked.length > 0 && <>
              <span>{picked.length} selected</span>
              <button type="button" className="small secondary" onClick={() => pickAll(false)}>Clear</button>
              {deleting ? <span>Deleting…</span> : (
                <DangerButton label={`Delete selected (${picked.length})`} what={`${picked.length} selected item${picked.length === 1 ? '' : 's'}`}
                  detail="Videos are removed from the Library, the Videos list and this server (with their stills unless another video uses them); stills are removed from the Library and this server. Downloads and published posts are not affected. A video with a post scheduled or still being made is skipped."
                  onConfirm={() => removeSelected(picked)} />
              )}
            </>}
          </div>
        )}
        <div className="library-tabs" role="tablist" aria-label="Category">
          {CATEGORIES.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={category === id} className={'library-tab' + (category === id ? ' on' : '')} onClick={() => setCategory(id)}>
              {label}<span className="library-tab-count">{data ? count(id) : ''}</span>
            </button>
          ))}
        </div>
        {data && !matching.length && <p className="hint">{q || client ? 'Nothing matches.' : EMPTY[category]}</p>}
        {sections.map(([title, xs]) => (
          <section key={title ?? 'all'} className="library-section">
            {title && <h3 className="library-section-title">{title}<small>{xs.length}</small></h3>}
            {view === 'list'
              ? <div className="library-list">{xs.map((x, i) => withRef(listRow(x), title, i))}</div>
              : <div className="library-grid">{xs.map((x, i) => withRef(x.type === 'still' ? stillCard(x.item) : videoCard(x.item), title, i))}</div>}
          </section>
        ))}
        {pages > 1 && <Pager at={at} pages={pages} onPage={(n) => { setPage(n); scrollRef.current?.scrollTo({ top: 0 }); }}
          from={at * perPage + 1} to={at * perPage + shown.length} total={matching.length} pagerRef={pagerRef} />}
      </div>
      {playing && <Player v={playing} client={names[playing.client]} onClose={() => setPlaying(null)} onShare={() => shareVideo(playing, say)} onPost={readOnly ? null : () => setPosting(playing)} />}
      {viewing && <StillViewer x={viewing} client={names[viewing.client]} onClose={() => setViewing(null)} />}
      {posting && <SocialPost v={posting} say={say} onClose={() => setPosting(null)} />}
      {advertising && <AdRequest v={advertising} say={say} onClose={() => setAdvertising(null)} />}
    </div>
  );
}

/** Page buttons: Previous, the page numbers (with … between far ones), Next, and which items are shown. */
function Pager({ at, pages, onPage, from, to, total, pagerRef }) {
  const near = new Set([0, pages - 1, at - 1, at, at + 1].filter((n) => n >= 0 && n < pages));
  const list = [...near].sort((a, b) => a - b);
  return (
    <nav className="library-pager" aria-label="Pages" ref={pagerRef}>
      <button type="button" className="secondary small" disabled={at === 0} onClick={() => onPage(at - 1)}>‹ Previous</button>
      {list.map((n, i) => (
        <span key={n}>
          {i > 0 && n - list[i - 1] > 1 && <span className="library-pager-gap">…</span>}
          <button type="button" className={'small' + (n === at ? '' : ' secondary')} aria-current={n === at ? 'page' : undefined} onClick={() => onPage(n)}>{n + 1}</button>
        </span>
      ))}
      <button type="button" className="secondary small" disabled={at === pages - 1} onClick={() => onPage(at + 1)}>Next ›</button>
      <small>{from}–{to} of {total}</small>
    </nav>
  );
}

/** A still shown large, with Download. */
function StillViewer({ x, client, onClose }) {
  return (
    <div className="player-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="player" role="dialog" aria-label={x.vehicle}>
        <img src={x.url} alt={x.vehicle} className="still-large" />
        <div className="player-info">
          <div><strong>{x.vehicle}</strong><span>{money(x.price)}{client ? ' · ' + client : ''}</span></div>
          <div className="actions">
            <a className="button" href={x.url} download={fileName(x, '.jpg')}>Download</a>
            <button type="button" className="secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Large player for presenting: plays at once; Full screen and Download beside it. */
function Player({ v, client, onClose, onShare, onPost }) {
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
            <button type="button" className="secondary" id="playerShare" onClick={onShare}>Share</button>
            {onPost && <button type="button" className="secondary" id="playerPost" onClick={onPost}>Post</button>}
            <button type="button" className="secondary" id="playerClose" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
