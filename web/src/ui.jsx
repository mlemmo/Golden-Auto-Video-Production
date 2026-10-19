// Small shared pieces: status pop-ups, delete buttons, prices.
import { useCallback, useState } from 'react';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import { addNotice, dismissAll, dismissNotice, useNotices } from './notices.js';

export const SECTION_NAME = { vehicle: 'Clients & vehicles', sheet: 'Car photos', generate: 'Generate', videos: 'Videos', captions: 'Captions',
  studio: 'Voice previews', builder: 'Lip-sync builder', spokesperson: 'Spokespersons', import: 'ZIP import',
  users: 'Users', account: 'Your account', usage: 'Usage', library: 'Library' };

/**
 * A section's status messages, shown as pop-ups (react-hot-toast): [null, say(text, kind)].
 *   say('Working…')        spinner until the section's next message replaces it
 *   say('Done.')           tick, closes after 5 s
 *   say(text, 'warn')      input reminder (amber), closes after 8 s
 *   say(text, true)        important failure: stays on screen and in Notifications until dismissed
 */
export function useStatus(section) {
  const say = useCallback((text, kind = false) => {
    const id = 'status-' + section;
    if (!text) toast.dismiss(id);
    else if (kind === 'warn') { toast(text, { id, duration: 8000, icon: '⚠️', className: 'popup popup-warn' }); addNotice(section, text, renderNotice, 'warn'); }
    else if (kind) { toast.dismiss(id); addNotice(section, text, renderNotice); }
    else if (/…$/.test(text)) toast.loading(text, { id, duration: Infinity });
    else toast.success(text, { id, duration: 5000 });
  }, [section]);
  return [null, say];
}
function renderNotice(n) {
  return (
    <div className="notice">
      <span><b>{SECTION_NAME[n.section] ?? n.section}</b>{n.count > 1 ? ` (×${n.count})` : ''}{'\n' + n.text}</span>
      <button type="button" className="small notice-dismiss" onClick={() => dismissNotice(n.id)}>Dismiss</button>
    </div>
  );
}

/** Where the pop-ups appear: bottom right (bottom centre on phones), clear of the header buttons, in the dashboard's colours. */
export function Popups() {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
  return (
    <Toaster position={narrow ? 'bottom-center' : 'bottom-right'} gutter={10} containerStyle={{ bottom: 20 }}
      toastOptions={{
        className: 'popup',
        style: { background: '#1b2230', color: '#f4f4f5', border: '1px solid #303744', borderRadius: 12, padding: '12px 14px', maxWidth: 440, fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', boxShadow: '0 10px 30px rgba(0,0,0,.45)' },
        success: { iconTheme: { primary: '#7bd36a', secondary: '#1b2230' } },
        error: { iconTheme: { primary: '#ff7a6b', secondary: '#1b2230' }, style: { borderColor: '#c0503f', background: '#2a1b1d' } },
        loading: { iconTheme: { primary: '#efbd64', secondary: '#303744' } },
      }}>
      {(t) => (
        <ToastBar toast={t}>
          {/* Click closes progress, success and reminder pop-ups; failures close only with their Dismiss button. */}
          {({ icon, message }) => <div onClick={() => t.type !== 'error' && toast.dismiss(t.id)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: t.type === 'error' ? 'default' : 'pointer' }} role={t.type === 'error' ? 'alert' : 'status'}>{icon}{message}</div>}
        </ToastBar>
      )}
    </Toaster>
  );
}

/** Header button: failures not yet dismissed, with a list to read and dismiss them. */
export function Notifications() {
  const notices = useNotices();
  const [open, setOpen] = useState(false);
  // Green: nothing to review; yellow: warnings only; red: at least one failure.
  const state = notices.some((n) => n.level === 'error') ? 'error' : notices.length ? 'warn' : 'clear';
  const label = { error: 'Notifications: failures to review', warn: 'Notifications: warnings', clear: 'Notifications: all clear' }[state];
  return (
    <div className="notices">
      <button type="button" className={'secondary small notices-' + state} id="notifications" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="label-short">🔔</span><span className="label-long">Notifications</span>{notices.length ? <span className="notice-count">{notices.length}</span> : null}
      </button>
      {open && (
        <div className="notices-panel" role="dialog" aria-label="Notifications">
          <div className="notices-head"><strong>Notifications</strong>
            {notices.length > 0 && <button type="button" className="secondary small" onClick={dismissAll}>Dismiss all</button>}
          </div>
          {!notices.length && <p>All clear: no failures or warnings.</p>}
          {notices.map((n) => (
            <div key={n.id} className={'notice-item notice-' + (n.level ?? 'error')}>
              <small>{SECTION_NAME[n.section] ?? n.section} · {n.at.toLocaleTimeString()}{n.count > 1 ? ` · ×${n.count}` : ''}</small>
              <p>{n.text}</p>
              <button type="button" className="secondary small" onClick={() => dismissNotice(n.id)}>Dismiss</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every delete goes through one confirmation. */
export function DangerButton({ label, what, detail, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    if (!confirm(`Delete ${what}?\n\n${detail}\n\nThis cannot be undone.`)) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return <button type="button" className="secondary danger small" disabled={busy} onClick={click}>{label}</button>;
}

export function price(v) {
  return v.price == null ? 'Call for price' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v.price);
}
export const miles = (v) => (v.Odometer == null ? 'Mileage not entered' : Number(v.Odometer).toLocaleString());
export const vehicleName = (v) => `${v.Year} ${v.Make} ${v.Model}`;

/** External link opened in a new tab. */
export function Link({ href, children, className }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

/** Newest first by created_at (ISO dates sort as text). */
export const newestFirst = (items) => [...items].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));

/** A list showing only its newest item, with the older ones behind "Show N older …" (noun: "video"). */
export function LatestFirst({ items, render, noun }) {
  const [all, setAll] = useState(false);
  const older = items.length - 1;
  return (
    <>
      {(all ? items : items.slice(0, 1)).map(render)}
      {older > 0 && (
        <button type="button" className="secondary small show-older" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${older} older ${noun}${older === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  );
}
