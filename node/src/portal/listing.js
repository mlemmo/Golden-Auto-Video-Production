// A dealer's cars, read live from their website when they open the Cars page (Sawyer, 2026-11-03: customers' cars are
// not stored; only cars that are ordered are kept, with the order). A read is held in memory for 15 minutes, never
// saved, so moving between pages does not read the site again; "Refresh" reads it now. Readers come from shared/. Only Dealer Car Search sites can be read today; others are asked to add cars by
// hand or contact eShield.
import { clientAnalyze } from '../../../shared/website.js';
import { dcsVehiclePages, dcsParseVdp, dcsPageError } from '../../../shared/dcs.js';
import { MAX_PHOTOS, VIN } from './cars.js';

export const HOLD_MS = 15 * 60_000;
const PARALLEL = 4;
const CONTACT = "Add your cars by hand, or contact eShield and we'll import them for you.";

/** A car read from a Dealer Car Search page, as the Cars page and the order form use it (its first 30 photos). */
function carFromDcs(v) {
  return { vin: String(v.Vin ?? '').toUpperCase(), stock_no: v.StockNumber || null, year: v.Year, make: v.Make, model: v.Model, trim: v.Trim || null,
    color: v.ExteriorColor || null, drivetrain: v.Drivetrain || null, mileage: v.Odometer ?? null, price: v.price ?? null,
    description: v.description || null, page_url: v.url, photos: (v.photo_sources ?? []).slice(0, MAX_PHOTOS) };
}

/** Reads every vehicle page, a few at a time; a VIN listed twice keeps its first listing, in the website's order. */
async function readPages(pages, siteFetch) {
  const found = [], errors = [];
  let next = 0;
  async function lane() {
    while (next < pages.length) {
      const index = next++, url = pages[index];
      const r = await siteFetch(url);
      if ((r.code ?? 0) !== 200) { errors.push(dcsPageError(url, 'could not be loaded (HTTP ' + (r.code ?? 0) + ')')); continue; }
      let car;
      try { car = carFromDcs(dcsParseVdp(String(r.body), url)); }
      catch { errors.push(dcsPageError(url, 'has no year, make or model on the site (it may have been sold)')); continue; }
      if (!VIN.test(car.vin)) { errors.push(dcsPageError(url, 'has no VIN, so it was skipped')); continue; }
      found.push({ index, car });
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, lane));
  const seen = new Set(), cars = [];
  for (const { car } of found.sort((a, b) => a.index - b.index)) if (!seen.has(car.vin)) { seen.add(car.vin); cars.push(car); }
  return { cars, errors };
}

/** Reads one website: { status: ok | blocked | unsupported | failed, message, cars, errors, website }. */
export async function readWebsite(site, siteFetch) {
  let website = String(site).replace(/\/+$/, '');
  let analysis = await clientAnalyze(website, siteFetch);
  // Some sites only answer on www. (mygoldenauto.net without www redirects to itself): try that before giving up.
  const host = new URL(website).host;
  if (!analysis.reachable && !analysis.blocked && !host.startsWith('www.')) {
    const www = await clientAnalyze('https://www.' + host, siteFetch);
    if (www.reachable || www.blocked) { website = 'https://www.' + host; analysis = www; }
  }
  const none = { cars: [], errors: [], website };
  if (analysis.blocked) return { ...none, status: 'blocked', message: `Your website blocks automatic reading. ${CONTACT}` };
  if (!analysis.reachable) return { ...none, status: 'failed', message: `We could not read ${website}: ${analysis.problem}. Check the website address in Dealer details.` };
  if (analysis.platform !== 'Dealer Car Search') {
    return { ...none, status: 'unsupported', message: `We can't read ${analysis.platform ? analysis.platform + ' websites' : 'this kind of website'} automatically yet. ${CONTACT}` };
  }
  let pages;
  try { pages = await dcsVehiclePages(website, analysis.sitemap, siteFetch); }
  catch (err) { return { ...none, status: 'failed', message: err.message }; }
  return { ...(await readPages(pages, siteFetch)), status: 'ok', message: null, website };
}

/**
 * The live listing with its 15-minute memory: forDealer(dealer, { fresh }) → the read plus read_at. Two people opening
 * the page at once share one read.
 */
export function websiteListing(siteFetch, { holdMs = HOLD_MS, now = () => Date.now() } = {}) {
  const held = new Map();
  return {
    async forDealer(dealer, { fresh = false } = {}) {
      if (!dealer.website) return { status: 'none', message: 'No website is saved for your dealer. Add it in Dealer details, or add cars by hand.', cars: [], errors: [], read_at: null };
      const key = dealer.id + ' ' + dealer.website;
      const hit = held.get(key);
      if (hit?.read && !fresh && now() - hit.at < holdMs) return hit.read;
      if (hit?.pending) return hit.pending;
      const pending = readWebsite(dealer.website, siteFetch).then((r) => ({ ...r, read_at: new Date(now()).toISOString() }));
      held.set(key, { ...hit, pending });
      try {
        const read = await pending;
        held.set(key, { at: now(), read });
        for (const [k, v] of held) if (now() - (v.at ?? 0) > holdMs && !v.pending) held.delete(k);
        return read;
      } catch (err) {
        held.delete(key);
        throw err;
      }
    },
  };
}
