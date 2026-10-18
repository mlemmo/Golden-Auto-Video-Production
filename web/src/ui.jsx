// Small shared pieces: status lines, delete buttons, prices.
import { useCallback, useState } from 'react';

/** A section's status line: [status, say(text, isError)]. */
export function useStatus() {
  const [status, setStatus] = useState({ text: '', error: false });
  const say = useCallback((text, error = false) => setStatus({ text: text || '', error }), []);
  return [status, say];
}
export function Status({ s }) {
  return <p className={'status' + (s.error ? ' error' : '')} role="status" hidden={!s.text}>{s.text}</p>;
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
