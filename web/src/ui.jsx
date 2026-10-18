// Small shared pieces: status pop-ups, delete buttons, prices.
import { useCallback, useState } from 'react';
import toast, { Toaster, ToastBar } from 'react-hot-toast';

/**
 * A section's status messages, shown as pop-ups (react-hot-toast): [null, say(text, isError)]. One pop-up per
 * section: a new message replaces the section's previous one. "…" at the end means work in progress (spinner,
 * stays until the result replaces it); results close after a few seconds; errors stay longer and close on click.
 */
export function useStatus(section) {
  const say = useCallback((text, error = false) => {
    const id = 'status-' + section;
    if (!text) toast.dismiss(id);
    else if (error) toast.error(text, { id, duration: 10000 });
    else if (/…$/.test(text)) toast.loading(text, { id, duration: Infinity });
    else toast.success(text, { id, duration: 5000 });
  }, [section]);
  return [null, say];
}

/** Where the pop-ups appear: top right (top centre on phones), in the dashboard's colours. Click one to close it. */
export function Popups() {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
  return (
    <Toaster position={narrow ? 'top-center' : 'top-right'} gutter={10} containerStyle={{ top: 72 }}
      toastOptions={{
        className: 'popup',
        style: { background: '#1b2230', color: '#f4f4f5', border: '1px solid #303744', borderRadius: 12, padding: '12px 14px', maxWidth: 440, fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', boxShadow: '0 10px 30px rgba(0,0,0,.45)' },
        success: { iconTheme: { primary: '#7bd36a', secondary: '#1b2230' } },
        error: { iconTheme: { primary: '#ff7a6b', secondary: '#1b2230' }, style: { borderColor: '#7a3434' } },
        loading: { iconTheme: { primary: '#efbd64', secondary: '#303744' } },
      }}>
      {(t) => (
        <ToastBar toast={t}>
          {({ icon, message }) => <div onClick={() => toast.dismiss(t.id)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }} role="status">{icon}{message}</div>}
        </ToastBar>
      )}
    </Toaster>
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
