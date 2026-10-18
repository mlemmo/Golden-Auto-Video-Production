// Website importer for clients on Dealer Car Search sites (e.g. eLease Returns). Port of private/importers.php
// (dcsParseVdp, clientImportDcs). Every vehicle page listed in the sitemap (/vdp/<id>/...) is read for its tracking
// object (year, make, model, price, id) and detail list (trim, colour, engine, mileage, stock, VIN). Photos are left to
// the photo worker (still PHP: it copies, re-encodes and sorts them with the local image model).
import { parseHtml, hasClassToken } from './dom.js';
import { htmlEntityDecode } from './html.js';
import { trim, upper, toInt, toFloat, isNumeric, truthy, quote, gmdateC, U_SPACE, strlen } from './php.js';
import { clientFetch, clientInventoryKey, clientsLoad } from './clients.js';
import { state, save } from './db.js';

export const DCS_PHOTO_LIMIT = 150;
export const DCS_MAX_CARS = 150;
const uSpaces = new RegExp(U_SPACE + '+', 'gu');

/** substr($s, strlen($prefix)) on bytes, as PHP does. */
function cutBytes(s, prefix) { return Buffer.from(s, 'utf8').subarray(strlen(prefix)).toString('utf8'); }

/** Vehicle facts from one Dealer Car Search vehicle page, in the app's inventory shape (photos still remote). */
export function dcsParseVdp(html, url) {
  const u = {};
  const m = html.match(/init_utag_data[\t\n\v\f\r ]*=[\t\n\v\f\r ]*\{([\s\S]*?)\};/);
  if (m) for (const p of m[1].matchAll(/"(product_[a-z_]+|site_[a-z_]+)":[\t\n\v\f\r ]*"([^"]*)"/g)) u[p[1]] = htmlEntityDecode(p[2]);
  const doc = parseHtml(html);
  const opt = {};
  for (const li of doc.findAll((e) => e.tag === 'li' && e.attr('class').startsWith('detailOpt'))) {
    const labelEl = li.children.find((c) => typeof c !== 'string' && c.tag === 'label');
    const labelText = labelEl ? labelEl.textContent : '';
    const label = trim(labelText, ': \t\n');
    const value = trim(cutBytes(li.textContent, labelText).replace(uSpaces, ' '));
    if (label !== '' && value !== '' && !Object.hasOwn(opt, label)) opt[label] = value;
  }
  let notes = '';
  for (const n of doc.findAll((e) => hasClassToken(e, 'i05r_detailNotes'))) notes = trim(n.textContent.replace(uSpaces, ' '));
  notes = trim(notes.replace(/^Vehicle Description[\t\n\v\f\r ]*/i, ''));
  const year = toInt(u.product_year ?? 0), make = trim(String(u.product_make ?? '')), model = trim(String(u.product_model ?? ''));
  if (year < 1900 || make === '' || model === '') throw new Error('Vehicle page is missing year, make or model: ' + url);
  // Highest positive advertised price: the tracking price and the displayed price (never a form, e.g. a loan calculator).
  const prices = [];
  if (isNumeric(u.product_price ?? null) && toFloat(u.product_price) > 0) prices.push(toFloat(u.product_price));
  for (const n of doc.findAll((e) => e.attr('class').includes('price') && !e.hasAncestor('form'))) {
    const pm = n.textContent.match(/^[\t\n\v\f\r ]*\$[\t\n\v\f\r ]*([0-9,]+(?:\.[0-9]{1,2})?)[\t\n\v\f\r ]*$/);
    if (pm && toFloat(pm[1].replaceAll(',', '')) > 0) prices.push(toFloat(pm[1].replaceAll(',', '')));
  }
  // Trim on these sites carries dealer notes after asterisks ("S COUPE**LIFT**..."): keep the trim itself.
  const trimName = trim(String(opt.Trim ?? '').split('*')[0]);
  const id = String(u.product_id ?? '');
  const re = new RegExp('https://imagescdn\\.dealercarsearch\\.com/Media/[0-9]+/' + quote(id) + '/[A-Za-z0-9_-]+\\.(?:jpg|jpeg|png|webp)', 'gi');
  const photos = [...new Set([...html.matchAll(re)].map((x) => x[0]))];
  const miles = String(opt.Mileage ?? '').replace(/[^0-9]/g, '');
  const stockRaw = trim(String(opt['Stock #'] ?? ''));
  const stock = truthy(stockRaw) ? stockRaw : id;
  const vin = trim(String(opt.Vin ?? ''));
  const dealer = {};
  for (const [k, v] of [['name', u.site_company_name], ['city', u.site_company_city], ['state', u.site_company_state], ['telephone', u.site_phone_main]]) if (truthy(v)) dealer[k] = v;
  const best = prices.length ? Math.max(...prices) : null;
  return {
    source: 'dcs', dcs_id: id, StockNumber: stock, Vin: truthy(vin) ? vin : 'stock:' + stock,
    Year: year, Make: upper(make), Model: upper(model), Trim: trimName, ExteriorColor: String(opt.Color ?? ''),
    InteriorColor: String(opt['Interior Color'] ?? opt.Interior ?? ''), Engine: String(opt.Engine ?? ''), Transmission: String(opt.Transmission ?? ''),
    Drivetrain: String(opt['Drive Train'] ?? ''), Odometer: miles === '' ? null : toInt(miles), Condition: String(u.product_condition ?? ''),
    VehiclePrice: best ?? 0, price: best, description: notes, url, photo_sources: photos, dealer,
  };
}

/** Year and name of a car from its sitemap address (/vdp/<id>/Used-2020-MercedesBenz-S560-for-sale-in-…), or ''. */
export function dcsSitemapName(url) {
  let path; try { path = new URL(url).pathname; } catch { path = url.split(/[?#]/)[0]; }
  let slug = path.replace(/\/+$/, '').split('/').pop() ?? '';
  try { slug = decodeURIComponent(slug); } catch { /* keep as is */ }
  const m = slug.match(/(?:^|-)((?:19|20)\d{2})-(.+?)(?:-for-sale(?:-.*)?)?$/s);
  return m ? m[1] + ' ' + m[2].replaceAll('-', ' ') : '';
}
/** Import error for one vehicle page from the sitemap, naming the car the sitemap gives. */
export function dcsPageError(url, problem) {
  const name = dcsSitemapName(url);
  return (name !== '' ? name : 'A vehicle') + ' is listed in the website’s sitemap, but its page ' + problem + ': ' + url;
}

/**
 * Import a Dealer Car Search client's inventory from its website. Cars that left the site stay listed as inactive.
 * Photos are left to the photo worker: a car whose photo set is new or changed is marked photos_pending.
 * Returns { vehicles, checked_at, report: { added, updated, gone, errors } }.
 */
export async function clientImportDcs(db, client, fetchFn = clientFetch) {
  const sitemap = String(client.analysis?.sitemap ?? '') || client.website + '/sitemap';
  const s = await fetchFn(sitemap);
  if ((s.code ?? 0) !== 200) throw new Error('Could not read the website’s sitemap (HTTP ' + (s.code ?? 0) + ').');
  const pages = [...new Set([...String(s.body).matchAll(/<loc>[\t\n\v\f\r ]*(https:\/\/[^<\t\n\v\f\r ]+\/vdp\/[0-9]+\/[^<\t\n\v\f\r ]*)[\t\n\v\f\r ]*<\/loc>/gi)].map((x) => x[1]))].slice(0, DCS_MAX_CARS);
  if (!pages.length) throw new Error('The sitemap lists no vehicle pages.');
  const key = clientInventoryKey(client.id);
  const old = state(db, key) ?? { vehicles: [] };
  const byStock = new Map();
  for (const v of old.vehicles ?? []) byStock.set(String(v.StockNumber), v);
  const seen = new Set(), errors = [];
  let added = 0, updated = 0, dealer = null;
  for (const url of pages) {
    const r = await fetchFn(url);
    if ((r.code ?? 0) !== 200) { errors.push(dcsPageError(url, 'could not be loaded (HTTP ' + (r.code ?? 0) + ')')); continue; }
    let v;
    try { v = dcsParseVdp(String(r.body), url); } catch { errors.push(dcsPageError(url, 'has no year, make or model on the site (it may have been sold)')); continue; }
    dealer ??= v.dealer; delete v.dealer;
    const prev = byStock.get(v.StockNumber) ?? null;
    // Photos are copied and sorted by the photo worker; until then the car keeps the photos it had.
    const same = prev !== null && JSON.stringify(prev.photo_sources_done ?? null) === JSON.stringify(v.photo_sources);
    v.photos = prev?.photos ?? [];
    v.photos_pending = !same;
    for (const k of ['photo_sources_done', 'photo_labels', 'photos_checked_at', 'sheet_photos']) if (prev && Object.hasOwn(prev, k) && prev[k] !== null) v[k] = prev[k];
    v.active = true; v.imported_at = prev?.imported_at ?? gmdateC(); v.detail_checked_at = gmdateC();
    prev ? updated++ : added++;
    // A car that moved stock numbers keeps its place; a new one goes last, as in PHP's array.
    byStock.set(v.StockNumber, v); seen.add(v.StockNumber);
  }
  let gone = 0;
  for (const [stock, v] of byStock) if (!seen.has(stock) && (v.active ?? true) !== false) { v.active = false; gone++; }
  const checked = gmdateC();
  const vehicles = [...byStock.values()];
  save(db, key, { vehicles, checked_at: checked, import: 'dcs' });
  if (dealer && Object.keys(dealer).length) {
    const c = clientsLoad(db);
    for (const x of c.items) if (x.id === client.id) x.dealer = dealer;
    save(db, 'clients', c);
  }
  return { vehicles, checked_at: checked, report: { added, updated, gone, errors } };
}
