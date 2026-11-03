// Dealer Car Search websites (e.g. eLease Returns), used by the video app's import (node/src/lib/importers.js) and the
// LotSpotlight portal's website pulls: the vehicle pages a site's sitemap lists, and the facts on one vehicle page.
// Every vehicle page (/vdp/<id>/...) carries a tracking object (year, make, model, price, id) and a detail list
// (trim, colour, engine, mileage, stock, VIN). No npm dependencies.
import { parseHtml, hasClassToken } from './dom.js';
import { htmlEntityDecode } from './html.js';
import { trim, upper, toInt, toFloat, isNumeric, truthy, quote, U_SPACE, strlen } from './text.js';

export const DCS_PHOTO_LIMIT = 150;
export const DCS_MAX_CARS = 150;
const uSpaces = new RegExp(U_SPACE + '+', 'gu');

/** The rest of s after prefix, cut by UTF-8 byte length. */
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
 * The vehicle page addresses (/vdp/<id>/...) in a Dealer Car Search site's sitemap, at most DCS_MAX_CARS.
 * sitemap: the address found by the website analysis, else <website>/sitemap. Throws with a plain message.
 */
export async function dcsVehiclePages(website, sitemap, fetchFn) {
  const s = await fetchFn(String(sitemap ?? '') || website + '/sitemap');
  if ((s.code ?? 0) !== 200) throw new Error('Could not read the website’s sitemap (HTTP ' + (s.code ?? 0) + ').');
  const pages = [...new Set([...String(s.body).matchAll(/<loc>[\t\n\v\f\r ]*(https:\/\/[^<\t\n\v\f\r ]+\/vdp\/[0-9]+\/[^<\t\n\v\f\r ]*)[\t\n\v\f\r ]*<\/loc>/gi)].map((x) => x[1]))].slice(0, DCS_MAX_CARS);
  if (!pages.length) throw new Error('The sitemap lists no vehicle pages.');
  return pages;
}
