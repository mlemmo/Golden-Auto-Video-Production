// Clients (dealers): storage, website checks and analysis, dealer details for scripts and speech.
// Golden Auto is the first client and keeps the original 'inventory' state; other
// clients use 'inventory:<id>'. Adding a client analyses its website and recommends how to import its inventory.
import { DEALER_DEFAULT } from './scripts.js';
import { lower, str, trim, strlen, truthy, gmdateC, parseUrl } from './text.js';
import { state, save } from './db.js';
import { clientWebsite, clientFetch, clientAnalyze } from '../../../shared/website.js';

// Website fetching and analysis live in shared/website.js (the portal uses them too).
export { clientWebsite, isPublicIPv4, pinnedLookup, clientFetch, CLIENT_PLATFORMS, CLIENT_FEED_PLATFORMS, clientAnalyze, CLIENT_DCS_EFFORT } from '../../../shared/website.js';

export const CLIENT_DEFAULT = 'golden-auto';

/** How a website is said: "eleasereturns.com" for client "eLease Returns" → "e lease returns dot com". */
export function clientWebsiteSpoken(website, name) {
  const host = lower(website).replace(/^www\./, '');
  const dot = host.lastIndexOf('.');
  if (dot === -1) return host;
  const label = host.slice(0, dot), tld = host.slice(dot + 1);
  const words = trim(name.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')).split(/[\t\n\v\f\r ]+/);
  const said = lower(words.join('')) === label.replace(/[-.]/g, '') ? lower(words.join(' ')) : label.replace(/[-.]/g, ' ');
  return said + ' dot ' + tld;
}

/** The host part of the addresses clients are stored with ("https://www.example.com"). */
function urlHost(url) {
  const m = url.match(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/);
  return m && m[1] !== '' ? m[1] : null;
}

/**
 * Dealer details used in scripts and speech: name, city, website as shown and as spoken. Golden Auto's are fixed;
 * other clients default to their client name, the city found on their website and the website they were added with.
 */
const GOLDEN_SPOKEN = 'my golden auto dot net';
export function clientDetails(client) {
  const d = client.details ?? {};
  const phone = str(d.phone ?? '');
  // Golden Auto: Golden Auto / San Ramon / mygoldenauto.net until its details are edited.
  if (client.id === CLIENT_DEFAULT) {
    return { name: str(d.name ?? DEALER_DEFAULT.name), city: str(d.city ?? DEALER_DEFAULT.city), website: str(d.website ?? DEALER_DEFAULT.website),
      website_spoken: str(d.website_spoken ?? GOLDEN_SPOKEN), phone };
  }
  const name = str(d.name ?? client.name);
  const website = str(d.website ?? str(urlHost(str(client.website))).replace(/^www\./, ''));
  return {
    name,
    city: str(d.city ?? client.dealer?.city ?? client.analysis?.dealer?.city ?? ''),
    website,
    website_spoken: str(d.website_spoken ?? clientWebsiteSpoken(website, name)),
    phone,
  };
}
/**
 * Websites the voice says as written in the dealer details ({shown: spoken}, see withSpeechSites). Golden Auto's own
 * mygoldenauto.net is handled by the speech rules themselves unless its details changed the website or how it is said.
 */
export function clientSpeechSites(clientId, dealer) {
  const own = clientId === CLIENT_DEFAULT && dealer.website === DEALER_DEFAULT.website && dealer.website_spoken === GOLDEN_SPOKEN;
  return own ? {} : { [dealer.website]: dealer.website_spoken };
}

// ---- Storage ----------------------------------------------------------------------------------------------------

export function clientsLoad(db) {
  let c = state(db, 'clients');
  if (!c || !truthy(c.items)) {
    c = { items: [{ id: CLIENT_DEFAULT, name: 'Golden Auto', website: 'https://www.mygoldenauto.net', created_at: gmdateC(),
      analysis: { platform: 'DealerCenter', best: 'dealercenter_snapshot', note: 'Existing setup: DealerCenter website snapshot (browser) and DealerCenter photos.' } }] };
    save(db, 'clients', c);
  }
  return c;
}
export function clientFind(db, id) {
  for (const c of clientsLoad(db).items) if (c.id === id) return c;
  throw new Error('Client not found.');
}
/** Inventory state key for a client; Golden Auto keeps the original key so existing data and tools keep working. */
export function clientInventoryKey(client) {
  if (client === CLIENT_DEFAULT || client === '') return 'inventory';
  if (!/^[a-z0-9-]{1,40}$/.test(client)) throw new Error('Invalid client.');
  return 'inventory:' + client;
}
export function clientInventory(db, client) { return state(db, clientInventoryKey(client)) ?? { vehicles: [] }; }

const ws = (s) => trim(s.replace(/[\t\n\v\f\r ]+/g, ' '));

export function clientSaveDetails(db, id, input) {
  const clean = (k) => ws(str(input?.[k] ?? ''));
  const d = { name: clean('name'), city: clean('city'), website: lower(clean('website').replace(/^(https?:\/\/)?(www\.)?/i, '')), website_spoken: lower(clean('website_spoken')), phone: clean('phone') };
  d.website = d.website.replace(/\/+$/, '');
  if (d.name === '' || strlen(d.name) > 80) throw new Error('Enter the dealer name as it should be said and shown.');
  if (strlen(d.city) > 60 || /[<>"]/.test(d.name + d.city)) throw new Error('Check the city.');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d.website)) throw new Error('Enter the website as shown in ads, e.g. example.com.');
  if (d.website_spoken === '') d.website_spoken = id === CLIENT_DEFAULT && d.website === DEALER_DEFAULT.website ? GOLDEN_SPOKEN : clientWebsiteSpoken(d.website, d.name);
  if (strlen(d.website_spoken) > 120 || !/^[a-z0-9 .'-]+$/.test(d.website_spoken)) throw new Error('Write the spoken website in plain words, e.g. “example dot com”.');
  // Phone is optional: digits with the usual separators, 7 to 15 digits.
  const digits = d.phone.replace(/\D/g, '').length;
  if (d.phone !== '' && (!/^\+?[0-9 ().-]+$/.test(d.phone) || digits < 7 || digits > 15)) throw new Error('Enter the phone number like 925-555-1234, or leave it empty.');
  const c = clientsLoad(db);
  for (const x of c.items) if (x.id === id) { x.details = d; save(db, 'clients', c); return x; }
  throw new Error('Client not found.');
}

const strcaseeq = (a, b) => lower(a) === lower(b);

export async function clientAdd(db, name, website, fetchFn = clientFetch) {
  name = ws(str(name));
  if (name === '' || strlen(name) > 80) throw new Error('Enter the client name (up to 80 characters).');
  website = clientWebsite(website);
  let c = clientsLoad(db);
  for (const x of c.items) {
    if (strcaseeq(x.name, name)) throw new Error('A client with this name already exists; select it from the list.');
    if ((parseUrl(x.website) || {}).host === (parseUrl(website) || {}).host) throw new Error('This website already belongs to client “' + x.name + '”.');
  }
  let base = trim(lower(name).replace(/[^a-z0-9]+/g, '-'), '-') || 'client';
  base = base.slice(0, 32);
  const ids = c.items.map((x) => x.id);
  let id = base, n = 2;
  while (ids.includes(id)) id = base + '-' + n++;
  const client = { id, name, website, created_at: gmdateC() };
  client.analysis = await clientAnalyze(website, fetchFn);
  // The analysis waited on the network: add to the latest list, not the one read before it.
  c = clientsLoad(db);
  if (c.items.some((x) => x.id === id || strcaseeq(x.name, name))) throw new Error('A client with this name already exists; select it from the list.');
  c.items.push(client); save(db, 'clients', c);
  return client;
}
export async function clientReanalyze(db, id, fetchFn = clientFetch) {
  const found = clientFind(db, id);
  const analysis = await clientAnalyze(found.website, fetchFn);
  const c = clientsLoad(db);
  for (const x of c.items) if (x.id === id) { x.analysis = analysis; save(db, 'clients', c); return x; }
  throw new Error('Client not found.');
}
