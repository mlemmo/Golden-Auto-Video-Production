// Clients (dealers): storage, website checks and analysis, dealer details for scripts and speech.
// Golden Auto is the first client and keeps the original 'inventory' state; other
// clients use 'inventory:<id>'. Adding a client analyses its website and recommends how to import its inventory.
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DEALER_DEFAULT } from './scripts.js';
import { lower, str, trim, strlen, truthy, gmdateC, parseUrl } from './text.js';
import { htmlEntityDecode } from './html.js';
import { state, save } from './db.js';

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
export function clientDetails(client) {
  if (client.id === CLIENT_DEFAULT) return { ...DEALER_DEFAULT, website_spoken: 'my golden auto dot net' };
  const d = client.details ?? {};
  const name = str(d.name ?? client.name);
  const website = str(d.website ?? str(urlHost(str(client.website))).replace(/^www\./, ''));
  return {
    name,
    city: str(d.city ?? client.dealer?.city ?? client.analysis?.dealer?.city ?? ''),
    website,
    website_spoken: str(d.website_spoken ?? clientWebsiteSpoken(website, name)),
  };
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
  if (id === CLIENT_DEFAULT) throw new Error('Golden Auto’s details are fixed.');
  const clean = (k) => ws(str(input?.[k] ?? ''));
  const d = { name: clean('name'), city: clean('city'), website: lower(clean('website').replace(/^(https?:\/\/)?(www\.)?/i, '')), website_spoken: lower(clean('website_spoken')) };
  d.website = d.website.replace(/\/+$/, '');
  if (d.name === '' || strlen(d.name) > 80) throw new Error('Enter the dealer name as it should be said and shown.');
  if (strlen(d.city) > 60 || /[<>"]/.test(d.name + d.city)) throw new Error('Check the city.');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d.website)) throw new Error('Enter the website as shown in ads, e.g. example.com.');
  if (d.website_spoken === '') d.website_spoken = clientWebsiteSpoken(d.website, d.name);
  if (strlen(d.website_spoken) > 120 || !/^[a-z0-9 .'-]+$/.test(d.website_spoken)) throw new Error('Write the spoken website in plain words, e.g. “example dot com”.');
  const c = clientsLoad(db);
  for (const x of c.items) if (x.id === id) { x.details = d; save(db, 'clients', c); return x; }
  throw new Error('Client not found.');
}

/** Validates and normalises a website address to its https origin. */
export function clientWebsite(url) {
  url = trim(str(url));
  if (url !== '' && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const p = parseUrl(url) || {};
  const host = lower(p.host ?? '');
  if (!['http', 'https'].includes(lower(p.scheme ?? '')) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || p.user !== undefined || p.pass !== undefined || p.port !== undefined)
    throw new Error('Enter the dealer website, e.g. www.example.com.');
  if (/(?:^|\.)(localhost|local|internal)$/.test(host)) throw new Error('Enter a public website.');
  return 'https://' + host;
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

// ---- Fetching dealer websites -----------------------------------------------------------------------------------

/** First public IPv4 address of a host (private and reserved ranges skipped). */
export function isPublicIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19)));
}
async function publicAddress(host) {
  if (isIP(host)) return null;
  try { for (const a of await lookup(host, { all: true, family: 4 })) if (isPublicIPv4(a.address)) return a.address; } catch { /* unresolvable */ }
  return null;
}
/** DNS lookup that only ever answers the checked public address (Node asks for all addresses when it can try several). */
export const pinnedLookup = (ip) => (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4));
function getOnce(url, host, ip) {
  return new Promise((resolve) => {
    let body = Buffer.alloc(0), headers = '';
    const req = httpsRequest(url, {
      lookup: pinnedLookup(ip), servername: host, timeout: 20000,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; GoldenAutoVideoStudio/1.0; inventory check)' },
    }, (res) => {
      headers = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n` + Object.entries(res.headers).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('\r\n') + '\r\n\r\n';
      res.on('data', (d) => { body = Buffer.concat([body, d]); if (body.length > 3_000_000) { req.destroy(); resolve({ code: 0, body: '', url, headers: '', location: '' }); } });
      res.on('end', () => resolve({ code: res.statusCode, body: body.toString('utf8'), bodyBuffer: body, url, headers, location: res.headers.location ?? '' }));
      res.on('error', () => resolve({ code: 0, body: '', url, headers: '', location: '' }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ code: 0, body: '', url, headers: '', location: '' }));
    req.end();
  });
}
/**
 * Fetch a public https page: no redirects to other schemes, private addresses or other ports; 3 MB cap.
 * Returns { code, body, url, headers } (code 0 when unreachable).
 */
export async function clientFetch(url, redirects = 3) {
  for (let i = 0; i <= redirects; i++) {
    const p = parseUrl(url) || {};
    const host = lower(p.host ?? '');
    if (p.scheme !== 'https' || host === '' || p.port !== undefined || p.user !== undefined) return { code: 0, body: '', url, headers: '' };
    const ip = await publicAddress(host);
    if (!ip) return { code: 0, body: '', url, headers: '' };
    const r = await getOnce(url, host, ip);
    if (r.code >= 300 && r.code < 400 && r.location !== '') { url = new URL(r.location, url).href; continue; }
    return { code: r.code, body: r.body, bodyBuffer: r.bodyBuffer, url: r.url, headers: r.headers };  // bodyBuffer: the raw bytes (photos)
  }
  return { code: 0, body: '', url, headers: '' };
}

// ---- Website analysis -------------------------------------------------------------------------------------------

export const CLIENT_PLATFORMS = {
  DealerCenter: ['dealercenter', 'inv-scripts-v2', 'dws_inventory'],
  'Dealer.com (Cox Automotive)': ['pictures.dealer.com', 'ddc-site', 'dealer.com/', 'ws-inv-data'],
  'Dealer Inspire': ['dealerinspire', 'dealer inspire'],
  DealerOn: ['dealeron'],
  'DealerFire / DealerSocket': ['dealerfire', 'dealersocket'],
  'Dealer eProcess': ['dealereprocess'],
  'CDK Global / Sincro': ['cdkglobal', 'cobaltgroup', 'sincro'],
  'Carsforsale.com': ['carsforsale.com'],
  'Dealer Car Search': ['dealercarsearch'],
  Frazer: ['frazerweb', 'frazer.com'],
  'Dealer Spike': ['dealerspike'],
  Overfuel: ['overfuel'],
  AutoManager: ['automanager'],
};
export const CLIENT_FEED_PLATFORMS = ['DealerCenter', 'Dealer.com (Cox Automotive)', 'Dealer Inspire', 'DealerOn', 'DealerFire / DealerSocket', 'Dealer eProcess', 'CDK Global / Sincro', 'Carsforsale.com', 'Dealer Car Search', 'Frazer', 'Dealer Spike', 'Overfuel', 'AutoManager'];

/** Parsed JSON, or null for invalid JSON (also null for "null"). */
function jsonDecode(s) { try { return JSON.parse(s); } catch { return null; } }
const isList = (v) => Array.isArray(v);
const isArr = (v) => v !== null && typeof v === 'object';
/** (array)$x for a JSON value: lists and maps as they are, a scalar as a one-item list, null as an empty list. */
const toArray = (v) => (v === null || v === undefined ? [] : isArr(v) ? (Array.isArray(v) ? v : Object.values(v)) : [v]);
const strVal = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '') : null);
const intersects = (types, wanted) => types.some((t) => { const s = strVal(t); return s !== null && wanted.includes(s); });

/**
 * Look at a dealer website and recommend how to import its inventory. Free: a few public page requests.
 * fetchFn(url) → { code, body, url, headers } is replaceable in tests.
 */
export async function clientAnalyze(website, fetchFn = clientFetch) {
  const home = await fetchFn(website);
  const body = str(home.body), html = lower(body), hdr = lower(str(home.headers));
  const blocked = home.code === 403 || (home.code === 503 && hdr.includes('cloudflare')) || html.includes('cf-chl') || html.includes('just a moment...') || html.includes('attention required! | cloudflare');
  const reachable = home.code >= 200 && home.code < 300 && !blocked;
  const signals = [];
  let platform = null;
  if (reachable) {
    outer: for (const [name, marks] of Object.entries(CLIENT_PLATFORMS)) for (const m of marks) if (html.includes(m)) { platform = name; signals.push('Website code mentions “' + m + '” → ' + name); break outer; }
  }
  // schema.org data: the dealer's own details and vehicle listings.
  let dealer = null, vehiclesLd = 0;
  if (reachable) {
    for (const m of body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      const d = jsonDecode(htmlEntityDecode(trim(m[1])));
      if (!isArr(d)) continue;
      const nodes = !isList(d) && isArr(d['@graph']) ? toArray(d['@graph']) : isList(d) ? d : [d];
      for (const n of nodes) {
        if (!isArr(n)) continue;
        const t = toArray(n['@type']);
        // No dealer yet, or one whose fields were all missing (an empty array).
        if (intersects(t, ['AutoDealer', 'AutomotiveBusiness', 'LocalBusiness']) && (dealer === null || Object.keys(dealer).length === 0)) {
          const addr = isArr(n.address) && !isList(n.address) ? n.address : {};
          dealer = {};
          for (const [k, v] of [['name', n.name], ['telephone', n.telephone], ['city', addr.addressLocality], ['state', addr.addressRegion], ['street', addr.streetAddress]]) if (typeof v === 'string') dealer[k] = v;
        }
        if (intersects(t, ['Car', 'Vehicle', 'Product'])) vehiclesLd++;
      }
    }
  }
  const hasDealer = dealer !== null && Object.keys(dealer).length > 0;
  if (hasDealer) signals.push('Dealer details published on the site: ' + Object.values(dealer).join(', '));
  if (vehiclesLd) signals.push(vehiclesLd + ' vehicle listing(s) published as structured data on the home page');
  // Sitemap: how many vehicle pages the site lists.
  let vdp = 0, sitemap = null;
  if (reachable) {
    const robots = await fetchFn(website + '/robots.txt');
    const sm = str(robots.body).match(/^sitemap:[\t\n\v\f\r ]*([^\t\n\v\f\r ]+)/im);
    if (sm) sitemap = sm[1];
    const s = await fetchFn(sitemap && sitemap.startsWith(website) ? sitemap : website + '/sitemap.xml');
    if (s.code === 200) {
      sitemap = s.url;
      vdp = [...str(s.body).matchAll(/<loc>[^<]*(?:\/inventory\/|\/vehicle|\/vdp|\/used\/|\/details\/)[^<]*<\/loc>/gi)].length;
      if (vdp) signals.push('Sitemap lists ' + vdp + ' vehicle page(s)');
    }
  }
  if (blocked) signals.push('The website blocks automated requests from this server (bot protection), like mygoldenauto.net does');
  else if (!reachable) signals.push('The website could not be reached (HTTP ' + home.code + ')');

  const options = [];
  if (platform && CLIENT_FEED_PLATFORMS.includes(platform)) options.push({ method: 'feed', title: 'Daily inventory feed from ' + platform,
    why: platform + ' can send the dealer’s inventory (vehicles, prices, photos) as a daily CSV/XML file by FTP. Most reliable: no website reading, includes cars not yet online.',
    effort: 'The dealer asks ' + platform + ' support to add a feed to us; we add the reader once we have a sample file.' });
  if (platform === 'DealerCenter' && reachable) options.push({ method: 'website_dealercenter', title: 'Website reader (same as Golden Auto)',
    why: 'The site runs on DealerCenter’s website platform, which the studio already reads.', effort: 'Works now: set as the import method and refresh inventory.' });
  if (reachable && (vehiclesLd || vdp)) options.push({ method: 'website_structured', title: 'Website import from listing pages',
    why: 'The site publishes its vehicles' + (vdp ? ' in its sitemap (' + vdp + ' pages)' : '') + (vehiclesLd ? ' with structured listing data' : '') + ', which can be read without dealer setup.',
    effort: platform === 'Dealer Car Search' ? CLIENT_DCS_EFFORT : 'We build a reader for this site’s listing pages (free to run); breaks if the site layout changes.' });
  if (blocked || !reachable) options.push({ method: 'browser_snapshot', title: 'Browser snapshot (as Golden Auto today)',
    why: 'The site ' + (blocked ? 'blocks' : 'does not answer') + ' this server, but it can be read in a normal browser and the snapshot fed in.', effort: 'Manual or scheduled run in Chrome; photos are downloaded by the server.' });
  options.push({ method: 'zip', title: 'Manual import (form + photo ZIP)', why: 'Works for any dealer and for cars not online yet.', effort: 'Per car, by hand. Fine for a few cars.' });
  return { checked_at: gmdateC(), reachable, blocked, platform, dealer: hasDealer ? dealer : (dealer === null ? null : []), sitemap,
    vehicle_pages: vdp, signals, options, best: options[0].method };
}
export const CLIENT_DCS_EFFORT = 'Ready: use “Import inventory from website” in step 1 (free; reads each listing page, then copies and sorts its photos, keeping exterior shots).';
