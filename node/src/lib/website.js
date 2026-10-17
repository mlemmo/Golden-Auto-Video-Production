// Golden Auto's website reader (DealerCenter website, mygoldenauto.net) and the "Refresh inventory" action for every
// client. Port of private/app.php (request, jsonp, inventory) and the sync action in public/index.php. Note: the
// website blocks this server via Cloudflare today, so Golden Auto's refresh reports that error, exactly as in PHP;
// its inventory comes from the DealerCenter snapshot sync instead.
import { parseHtml } from './dom.js';
import { lower, str } from './php.js';
import { highestPrice } from './price.js';
import { CLIENT_DEFAULT, clientFind, clientInventoryKey } from './clients.js';
import { clientImportDcs } from './importers.js';
import { state, save } from './db.js';
import { gmdateC } from './php.js';

/** request($url) for plain GETs: https only, no redirects, 45 s, 8 MB; any non-2xx status is an error. */
export async function requestText(url) {
  if (!String(url).startsWith('https://')) throw new Error('HTTPS is required.');
  let res;
  try { res = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json,text/html', 'User-Agent': 'GoldenAutoInventoryVideo/1.0' }, signal: AbortSignal.timeout(45000) }); }
  catch { throw new Error('Remote request failed (HTTP 0).'); }
  if (res.status < 200 || res.status >= 300) throw new Error('Remote request failed (HTTP ' + res.status + ').');
  const body = await res.text();
  if (Buffer.byteLength(body) > 8000000) throw new Error('Remote response is too large.');
  return body;
}

/** jsonp(): a JSONP or JSON response as an array/object; anything else is an error, as in PHP. */
export function jsonp(s) {
  s = s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
  const m = s.match(/^[a-zA-Z_$][A-Za-z0-9_$]*[\t\n\v\f\r ]*\(([\s\S]*)\)[\t\n\v\f\r ]*;?$/);
  if (m) s = m[1];
  let d;
  try { d = JSON.parse(s); } catch { throw new Error('Syntax error'); }
  if (d === null || typeof d !== 'object') throw new Error('Inventory response is invalid.');
  return d;
}

/** rawurlencode(): like encodeURIComponent, but also ! ' ( ) * are encoded (and ~ is not). */
export const rawurlencode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const phpString = (v) => (Array.isArray(v) || (v && typeof v === 'object') ? 'Array' : str(v));

/** inventory($source): Golden Auto's vehicle list from its DealerCenter website. getText(url) is replaceable in tests. */
export async function goldenInventory(source, getText = requestText) {
  const doc = parseHtml(await getText(source));
  let url = null;
  for (const n of doc.findAll((e) => e.tag === 'script' && e.has('src'))) {
    const src = n.attr('src');
    if (src.includes('cb=dws_inventory_listing_') && src.startsWith('/inv-scripts-v2/inv/vehicles?')) { url = source + src; break; }
  }
  if (!url) throw new Error('Website inventory format changed; reader needs updating.');
  const d = jsonp(await getText(url));
  let vehicles = Array.isArray(d) ? undefined : d.Vehicles;
  if (vehicles === null || vehicles === undefined || typeof vehicles !== 'object') throw new Error('No readable vehicle list returned.');
  const list = Array.isArray(vehicles) ? vehicles : Object.values(vehicles);
  const total = d.TotalRecordCount ?? list.length;
  if (Number(total) > list.length) throw new Error('Inventory exceeds this page; add pagination before syncing.');
  const out = list.map((v) => {
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const parts = [v.Make, v.Model, v.StockNumber].map((s) => rawurlencode(lower(phpString(s).replaceAll(' ', '-'))));
    return { ...v, url: source + '/inventory/' + parts.join('/') + '/', price: highestPrice(v), description: '', photos: [] };
  });
  return Array.isArray(vehicles) ? out : Object.fromEntries(Object.keys(vehicles).map((k, i) => [k, out[i]]));
}

/**
 * The "Refresh inventory" action (sync) for the selected client: Golden Auto's website reader (cars imported by
 * ZIP that the website does not list are kept), or the Dealer Car Search import for clients on that platform.
 */
export async function syncInventory(db, cfg, client, { getText = requestText, fetchFn } = {}) {
  if (client !== CLIENT_DEFAULT) {
    const c = clientFind(db, client);
    if ((c.analysis?.platform ?? '') !== 'Dealer Car Search' || !c.analysis?.reachable)
      throw new Error('Inventory import for this client is not set up yet. See its recommended import option above; until then, import cars with the form under Tools.');
    return clientImportDcs(db, c, fetchFn);
  }
  let list = await goldenInventory(String(cfg.source), getText);
  if (!Array.isArray(list)) list = Object.values(list);
  const old = state(db, 'inventory') ?? {};
  const stocks = list.map((v) => v.StockNumber);
  for (const v of old.vehicles ?? []) if ((v.source ?? '') === 'zip' && !stocks.includes(v.StockNumber)) list.push(v);
  const checked = gmdateC();
  save(db, 'inventory', { vehicles: list, checked_at: checked });
  return { vehicles: list, checked_at: checked };
}
