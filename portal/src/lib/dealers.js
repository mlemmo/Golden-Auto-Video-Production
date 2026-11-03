// Dealer details: checked the same way when eShield staff add a dealer and when staff or the dealer's owners and
// admins edit one. Only staff change the short name (it names the dealer in links and in the video app).
import { HttpError } from './errors.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const DEALER_FIELDS = ['name', 'slug', 'website', 'city', 'state', 'phone', 'timezone'];
const TIMEZONES = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []);

/** "www.example.com/used" or "http://example.com" → "https://www.example.com" / "https://example.com". */
export function cleanWebsite(value) {
  let s = String(value ?? '').trim();
  if (s === '') return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { u = null; }
  const host = u?.hostname.toLowerCase() ?? '';
  if (!u || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /(?:^|\.)(localhost|local|internal)$/.test(host)) {
    throw new HttpError(400, 'Enter the website like www.example.com.');
  }
  return 'https://' + host;
}

/** The dealer fields present in input, checked (all of name and slug with `creating`). */
export function cleanDealer(input, { creating = false, staff = false } = {}) {
  const out = {};
  const has = (k) => creating || Object.hasOwn(input ?? {}, k);
  const text = (k) => String(input?.[k] ?? '').trim();
  if (has('name')) {
    out.name = text('name');
    if (!out.name || out.name.length > 190) throw new HttpError(400, 'Enter the dealer name.');
  }
  if (has('slug')) {
    if (!staff) throw new HttpError(403, 'Only eShield staff can change the short name.');
    out.slug = text('slug').toLowerCase();
    if (!SLUG.test(out.slug)) throw new HttpError(400, 'The short name may use lowercase letters, numbers and dashes.');
  }
  if (has('website')) out.website = cleanWebsite(input?.website);
  if (has('city')) {
    out.city = text('city') || null;
    if (out.city && (out.city.length > 80 || /[<>"]/.test(out.city))) throw new HttpError(400, 'Check the city.');
  }
  if (has('state')) {
    out.state = text('state') || null;
    if (out.state && (out.state.length > 40 || /[<>"]/.test(out.state))) throw new HttpError(400, 'Check the state.');
  }
  if (has('phone')) {
    out.phone = text('phone') || null;
    const digits = (out.phone ?? '').replace(/\D/g, '').length;
    if (out.phone && (!/^\+?[0-9 ().-]+$/.test(out.phone) || digits < 7 || digits > 15)) throw new HttpError(400, 'Enter the phone number like 925-555-1234, or leave it empty.');
  }
  if (has('timezone')) {
    out.timezone = text('timezone') || 'America/Los_Angeles';
    if (TIMEZONES.size && !TIMEZONES.has(out.timezone)) throw new HttpError(400, 'Choose a time zone from the list.');
  }
  return out;
}
