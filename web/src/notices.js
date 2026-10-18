// Important failures that must be acknowledged: each stays on screen and in the Notifications list until the user
// dismisses it (either place clears both). The same message from the same section is counted, not repeated.
import { useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';

let items = [];          // [{ id, section, text, at, count }]
const listeners = new Set();
const emit = () => { items = [...items]; for (const l of listeners) l(); };

export function addNotice(section, text, render) {
  const same = items.find((n) => n.section === section && n.text === text);
  if (same) { same.count++; same.at = new Date(); }
  else items.unshift({ id: 'notice-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), section, text, at: new Date(), count: 1 });
  const n = same ?? items[0];
  emit();
  // Shown until dismissed (render draws the message with its Dismiss button).
  toast.error((t) => render(n, t), { id: n.id, duration: Infinity });
}
export function dismissNotice(id) {
  items = items.filter((n) => n.id !== id);
  toast.dismiss(id);
  emit();
}
export function dismissAll() { for (const n of items) toast.dismiss(n.id); items = []; emit(); }
export function useNotices() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => items);
}
