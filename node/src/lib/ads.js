// Paid ads on Meta (Facebook + Instagram) and TikTok for a finished video ("Run as ad" in the Library), per dealer.
// The dashboard records requests (table ad_requests) and each dealer's ad settings (state ad_settings:<client>); nothing
// here calls an ad platform. Meta requests are launched by the ads worker straight through Meta's Marketing API
// (meta-ads.js): created PAUSED, switched on or paused only when a user presses Switch on / Pause (ad_switch_on,
// ad_pause), paused after the end date. TikTok requests are launched by hand in TikTok Ads Manager and recorded with
// src/cli/ad-requests.js (docs/ADS_LAUNCH.md).
import { randomBytes } from 'node:crypto';
import { jsonEncode } from './storedjson.js';
import { state, save } from './db.js';
import { trim, str, gmdateC } from './text.js';
import { CLIENT_DEFAULT, clientFind, clientDetails, clientInventory } from './clients.js';
import { adPrice } from './price.js';

export const AD_PLATFORMS = ['meta', 'tiktok'];
export const AD_PLATFORM_NAME = { meta: 'Meta (Facebook & Instagram)', tiktok: 'TikTok' };
// Request → (Meta: launching) → launched paused → active ⇄ paused → ended; or failed / canceled.
export const AD_STATUSES = ['requested', 'launching', 'launched_paused', 'active', 'paused', 'ended', 'failed', 'canceled', 'removed'];
const MIN_BUDGET = { meta: 5, tiktok: 20 };
// The dashboard uses miles (Meta's radius targeting takes 1–50 miles); the request also keeps km for TikTok Ads Manager.
export const KM_PER_MILE = 1.609344;
const REELS = ['instagram_reels', 'facebook_reels'];
// Meta puts ads about credit (financing, payments, APR) in a special category with restricted targeting.
const CREDIT_WORDS = /\b(financ\w*|credit|apr|down\s*payment|monthly\s*payment|per\s*month|\/\s*mo\b|\d+\s*\/\s*month|lease\s*(for|from)|loan\w*)\b/i;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

export function adTables(db) {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS ad_requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
}
export const adLoad = (db, id) => { adTables(db); const r = db.prepare('SELECT payload FROM ad_requests WHERE id=?').get(id); return r ? JSON.parse(r.payload) : null; };
export const adStore = (db, a) => db.prepare('INSERT INTO ad_requests (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(a.id, jsonEncode(a));
export const adLoadAll = (db) => { adTables(db); return db.prepare('SELECT payload FROM ad_requests ORDER BY rowid DESC').all().map((r) => JSON.parse(r.payload)); };

/** A dealer's ad settings (no secrets: ad account ids, Page name, defaults). */
export function adSettings(db, client) {
  const s = state(db, 'ad_settings:' + client) ?? {};
  return {
    meta_account: str(s.meta_account ?? ''), meta_page: str(s.meta_page ?? ''), tiktok_account: str(s.tiktok_account ?? ''),
    // Miles in the dashboard; settings saved in km before 2026-10-21 are converted.
    radius_address: str(s.radius_address ?? ''), radius_miles: Number(s.radius_miles ?? (s.radius_km ? Math.round(s.radius_km / KM_PER_MILE) : 15)) || 15,
    daily_budget: Number(s.daily_budget ?? 20) || 20, days: Number(s.days ?? 7) || 7,
  };
}
export function adSettingsSave(db, client, inp) {
  const meta = trim(str(inp.meta_account ?? '')), tiktok = trim(str(inp.tiktok_account ?? ''));
  if (meta && !/^act_\d{5,25}$/.test(meta)) throw new Error('The Meta ad account id looks like act_1234567890.');
  if (tiktok && !/^\d{5,25}$/.test(tiktok)) throw new Error('The TikTok advertiser id is a number.');
  const miles = Number(inp.radius_miles ?? 15), budget = Number(inp.daily_budget ?? 20), days = Number(inp.days ?? 7);
  if (!(miles >= 1 && miles <= 50)) throw new Error('The area radius must be 1–50 miles.');
  if (!(budget >= 5 && budget <= 1000)) throw new Error('The default daily budget must be $5–$1,000.');
  if (!(Number.isInteger(days) && days >= 1 && days <= 30)) throw new Error('The default number of days must be 1–30.');
  const s = { meta_account: meta, meta_page: trim(str(inp.meta_page ?? '')).slice(0, 100), tiktok_account: tiktok,
    radius_address: trim(str(inp.radius_address ?? '')).slice(0, 200), radius_miles: miles, daily_budget: budget, days };
  save(db, 'ad_settings:' + client, s);
  return adSettings(db, client);
}

function jobFor(db, id) {
  const r = db.prepare('SELECT payload FROM jobs WHERE id=?').get(str(id ?? ''));
  if (!r) throw new Error('Video not found. Reload the library.');
  return JSON.parse(r.payload);
}
// Brand and model words kept in capitals when the listing's upper case is turned into title case.
const KEEP_CAPS = new Set(['BMW', 'GMC', 'AMG', 'SUV', 'GT', 'GTI', 'TDI', 'TSI', 'XC90', 'XC60', 'XC40', 'CX-30', 'CX-5', 'CX-9', 'CR-V', 'HR-V', 'RAV4', 'XV', 'SE', 'LE', 'XLE', 'XLT', 'LT', 'LTZ', 'EX', 'LX', 'SR5', 'AWD', 'FWD', 'RWD', '4WD', '4X4', 'TRD', 'SV', 'SL', 'S', 'R']);
const titleWord = (w) => (KEEP_CAPS.has(w.toUpperCase()) || /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
export const adTitle = (s) => trim(str(s)).split(/\s+/).map(titleWord).join(' ');
const DRIVE_WORDS = { AWD: 'All-wheel drive', '4WD': 'Four-wheel drive', '4X4': 'Four-wheel drive', FWD: 'Front-wheel drive', RWD: 'Rear-wheel drive' };

/**
 * Suggested ad copy and link for a video, in the shape Meta recommends for auto ads: line 1 = the car, its miles and
 * price; line 2 = a benefit from the listing (the car's fitted highlight line, else its drive and colour); line 3 =
 * where it is and the call to action. Nothing is claimed that the listing does not say. The link is the car's own
 * page on the dealer's website when the sync knows it (page_url), else the website.
 */
export function adDraft(db, job) {
  const client = job.client ?? CLIENT_DEFAULT;
  let dealer = { name: '', city: '', website: '' };
  try { dealer = clientDetails(clientFind(db, client)); } catch { /* client removed */ }
  const car = (clientInventory(db, client).vehicles ?? []).find((v) => str(v.StockNumber) === str(job.stock));
  const site = dealer.website ? 'https://' + dealer.website.replace(/^https?:\/\//, '') : '';
  const page = [car?.page_url, car?.url].map((u) => str(u ?? '')).find((u) => /^https:\/\/[^\s]+$/.test(u));
  const link = page ?? site;
  const name = adTitle(job.vehicle);
  // Trim without the body style ("Laramie Longhorn Crew Cab 4D" → "Laramie Longhorn"); "Base" is not worth saying.
  const trimName = trim(str(car?.Trim ?? '').replace(/\b(sport utility|sedan|coupe|pickup|crew cab|quad cab|extended cab|regular cab|van|wagon|hatchback|convertible)\b.*$/gi, ''));
  const full = name + (trimName && !/^base\b/i.test(trimName) && !name.toLowerCase().includes(trimName.toLowerCase()) ? ' ' + adTitle(trimName) : '');
  const miles = car?.Odometer != null && Number(car.Odometer) >= 1000 ? Math.round(Number(car.Odometer) / 1000) + 'k miles' : '';
  const price = job.price ? adPrice(Number(job.price)) : 'Call for price';
  const line1 = full + ' — ' + [miles, price].filter(Boolean).join(', ');
  let highlight = '';
  try { highlight = str(state(db, 'intro:' + client + ':' + str(job.stock))?.highlight ?? ''); } catch { /* none */ }
  const drive = DRIVE_WORDS[str(car?.Drivetrain ?? '').toUpperCase()] ?? '';
  const color = trim(str(car?.ExteriorColor ?? ''));
  const facts = [drive, color && !/^(other|unknown)$/i.test(color) ? color.toLowerCase() + ' exterior' : ''].filter(Boolean).join(', ');
  const line2 = trim(highlight) || (facts ? facts.charAt(0).toUpperCase() + facts.slice(1) + '.' : '');
  const where = dealer.name ? 'See it at ' + dealer.name + (dealer.city ? ' in ' + dealer.city : '') : 'See it in person';
  const line3 = where + ' and book your test drive today.';
  const text = [line1, line2, line3].filter(Boolean).join('\n');
  const tiktok = (full + (dealer.name ? ' at ' + dealer.name : '') + '. Book your test drive today.').slice(0, 100);
  return { text, headline: (name + (job.price ? ' · ' + adPrice(Number(job.price)) : '')).slice(0, 80), tiktok_text: tiktok, link };
}

/**
 * An ad may only show the price the car is listed at now: the video's price (said and captioned) must match the
 * current inventory, and the car must still be in it. Returns the reason it may not run, or ''.
 */
export function adPriceProblem(db, job) {
  const car = (clientInventory(db, job.client ?? CLIENT_DEFAULT).vehicles ?? []).find((v) => str(v.StockNumber) === str(job.stock));
  if (!car || car.active === false) return 'This car is no longer in the inventory, so it cannot be advertised.';
  // Whole dollars, as the video says and shows it ($19,366.25 is advertised as $19,366).
  const dollars = (p) => (p === null || p === undefined ? null : Math.floor(Number(p)));
  if (dollars(job.price) !== dollars(car.price)) {
    const say = (p) => (p === null || p === undefined ? 'no price' : adPrice(Number(p)));
    return `The price changed since this video was made (video: ${say(job.price)}, listing now: ${say(car.price)}). Make a new video so the ad matches the listing.`;
  }
  return '';
}

const publicAd = (a) => ({ ...a });

/**
 * Actions: ad_status (settings, eligibility and suggested copy for a video), ad_request (record a request), ad_list
 * (requests of one video or all of the account's clients), ad_cancel (a request not launched yet), ad_settings_save
 * (admins). allowed = the account's client ids.
 */
/**
 * Today's date (YYYY-MM-DD) where the dealers are. Start and end dates are the dealer's calendar days: on the UTC
 * date, an evening request in California for "today" was refused as a past date (2026-10-21, 7:26 PM PDT = 10/22 UTC).
 */
export const AD_TIME_ZONE = 'America/Los_Angeles';
export const adToday = (now = Date.now(), timeZone = AD_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

export function adApi(action, inp, db, { allowed = [CLIENT_DEFAULT], user = '', now = Date.now(), random = randomBytes } = {}) {
  adTables(db);
  const mine = (client) => { if (!allowed.includes(client)) throw new Error('Your account has no access to that client.'); };
  if (action === 'ad_status') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    const s = adSettings(db, client);
    const finished = job.finish_status === 'completed' && str(job.captioned_url ?? '').startsWith('https://');
    const priceProblem = finished ? adPriceProblem(db, job) : '';
    return { settings: s, meta: !!s.meta_account, tiktok: !!s.tiktok_account, reels: REELS.includes(str(job.format)), eligible: finished && !priceProblem,
      reason: !finished ? 'This video is not finished yet.' : priceProblem, draft: adDraft(db, job) };
  }
  if (action === 'ad_settings') { const client = str(inp.client ?? ''); mine(client); return adSettings(db, client); }
  if (action === 'ad_settings_save') { const client = str(inp.client ?? ''); mine(client); return { settings: adSettingsSave(db, client, inp), message: 'Ad settings saved.' }; }
  if (action === 'ad_list') {
    const id = str(inp.id ?? '');
    return { ads: adLoadAll(db).filter((a) => allowed.includes(a.client) && !a.removed && (!id || a.job_id === id)).slice(0, 100).map(publicAd) };
  }
  if (action === 'ad_cancel') {
    const a = adLoad(db, str(inp.id ?? '')); if (!a) throw new Error('Ad request not found. Reload the list.');
    mine(a.client);
    const open = Object.values(a.platforms).filter((x) => x.status === 'requested');
    if (!open.length) throw new Error('Only requests that have not been launched can be cancelled here. A launched ad is paused or stopped in the ad account.');
    for (const x of open) x.status = 'canceled';
    adStore(db, a);
    return { ad: publicAd(a), message: 'Request cancelled.' };
  }
  // An ad deleted in Meta Ads Manager (or TikTok) leaves the list; the app stops tracking it and changes nothing there.
  if (action === 'ad_remove') {
    const a = adLoad(db, str(inp.id ?? '')); if (!a) throw new Error('Ad not found. Reload the list.');
    mine(a.client);
    if (inp.confirm_deleted !== true) throw new Error('Confirm that you deleted or stopped this ad in the ad account first.');
    if (Object.values(a.platforms).some((x) => x.status === 'launching')) throw new Error('This ad is being created right now. Wait a minute, then remove it.');
    for (const x of Object.values(a.platforms)) { if (!['ended', 'failed', 'canceled'].includes(x.status)) x.status = 'removed'; delete x.want; }
    a.removed = true; a.removed_at = gmdateC(new Date(now)); a.removed_by = str(user);
    adStore(db, a);
    return { message: 'Removed from the list. Nothing was changed in the ad account.' };
  }
  if (action === 'ad_switch_on' || action === 'ad_pause' || action === 'ad_retry') {
    // Meta only: the ads worker applies it within a minute (meta-ads.js).
    const a = adLoad(db, str(inp.id ?? '')); if (!a) throw new Error('Ad not found. Reload the list.');
    mine(a.client);
    const x = a.platforms.meta; if (!x) throw new Error('Only Meta ads are switched on and off here; TikTok ads are managed in TikTok Ads Manager.');
    if (action === 'ad_retry') {
      if (x.status !== 'failed') throw new Error('Only a failed launch can be retried.');
      x.status = 'requested'; delete x.error; adStore(db, a);
      return { ad: publicAd(a), message: 'Launching again (paused). It carries on from where it stopped.' };
    }
    if (!['launched_paused', 'active', 'paused'].includes(x.status)) throw new Error(x.status === 'ended' ? 'This ad has ended. Request a new ad to run it again.' : 'The ad is not created yet. Wait until it shows as created and paused.');
    const today = adToday(now);
    if (action === 'ad_switch_on' && a.end_date < today) throw new Error('This ad is past its end date.');
    if (action === 'ad_switch_on') {
      const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(a.job_id);
      const problem = row ? adPriceProblem(db, JSON.parse(row.payload)) : 'The video of this ad was deleted.';
      if (problem) throw new Error(problem + ' Pause or end this ad.');
    }
    x.want = action === 'ad_switch_on' ? 'active' : 'paused'; delete x.error;
    adStore(db, a);
    return { ad: publicAd(a), message: action === 'ad_switch_on'
      ? 'Switching on: it starts spending up to $' + a.daily_budget.toLocaleString('en-US') + ' a day until ' + a.end_date + '. Applied within a minute.'
      : 'Pausing. Applied within a minute.' };
  }
  if (action === 'ad_request') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    if (job.finish_status !== 'completed' || !str(job.captioned_url ?? '').startsWith('https://')) throw new Error('This video is not finished yet.');
    const priceProblem = adPriceProblem(db, job); if (priceProblem) throw new Error(priceProblem);
    const s = adSettings(db, client);
    const platforms = [...new Set(Array.isArray(inp.platforms) ? inp.platforms.map(str) : [])].filter((p) => AD_PLATFORMS.includes(p));
    if (!platforms.length) throw new Error('Choose Meta, TikTok or both.');
    if (platforms.includes('meta') && !s.meta_account) throw new Error('No Meta ad account is set for this dealer yet (dealer details → Paid ads).');
    if (platforms.includes('tiktok') && !s.tiktok_account) throw new Error('No TikTok ad account is set for this dealer yet (dealer details → Paid ads).');
    if (platforms.includes('tiktok') && !REELS.includes(str(job.format))) throw new Error('TikTok ads need the Reels 9:16 format.');
    const budget = Number(inp.daily_budget), days = Number(inp.days);
    for (const p of platforms) if (!(budget >= MIN_BUDGET[p])) throw new Error(AD_PLATFORM_NAME[p] + ' needs a daily budget of at least $' + MIN_BUDGET[p] + '.');
    if (budget > 1000) throw new Error('The daily budget can be at most $1,000 here.');
    if (!(Number.isInteger(days) && days >= 1 && days <= 30)) throw new Error('Run the ad for 1–30 days.');
    const start = str(inp.start_date ?? '');
    const today = adToday(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < today || Date.parse(start) > Date.parse(today) + 30 * 86400000) throw new Error('Choose a start date from today up to 30 days ahead.');
    const text = trim(str(inp.text ?? '')), headline = trim(str(inp.headline ?? '')), tiktok = trim(str(inp.tiktok_text ?? ''));
    const link = trim(str(inp.link ?? ''));
    if (!text && platforms.includes('meta')) throw new Error('Write the ad text.');
    if ([...text].length > 2000 || [...headline].length > 80) throw new Error('Keep the ad text under 2000 characters and the headline under 80.');
    if (platforms.includes('tiktok') && (!tiktok || [...tiktok].length > 100 || EMOJI.test(tiktok))) throw new Error('The TikTok caption must be 1–100 characters without emoji.');
    if (!/^https:\/\/[^\s]+$/.test(link)) throw new Error('The ad link must be an https web address.');
    if (CREDIT_WORDS.test([text, headline, tiktok].join(' '))) throw new Error('Remove financing, payment or credit wording: Meta treats those ads as a special "Credit" category with restricted targeting.');
    const address = trim(str(inp.radius_address ?? s.radius_address)), miles = Number(inp.radius_miles ?? s.radius_miles);
    if (!address) throw new Error('Enter the address to target around (e.g. the dealership).');
    if (!(miles >= 1 && miles <= 50)) throw new Error('The area radius must be 1–50 miles.');
    for (const p of platforms) if (adLoadAll(db).some((a) => a.job_id === job.id && ['requested', 'launching', 'launched_paused', 'active', 'paused'].includes(a.platforms[p]?.status))) {
      throw new Error('This video already has an open ' + AD_PLATFORM_NAME[p] + ' ad request or ad. Cancel or end it first.');
    }
    const end = new Date(Date.parse(start) + (days - 1) * 86400000).toISOString().slice(0, 10);
    const a = { id: random(12).toString('hex'), client, job_id: job.id, vehicle: str(job.vehicle), stock: str(job.stock), format: str(job.format),
      video_url: str(job.captioned_url), daily_budget: budget, days, start_date: start, end_date: end, radius_address: address, radius_miles: miles, radius_km: Math.min(80, Math.round(miles * KM_PER_MILE * 10) / 10),
      text, headline, tiktok_text: tiktok, link, objective: 'traffic', meta_account: s.meta_account, meta_page: s.meta_page, tiktok_account: s.tiktok_account,
      created_by: str(user), created_at: gmdateC(new Date(now)), platforms: Object.fromEntries(platforms.map((p) => [p, { status: 'requested' }])) };
    adStore(db, a);
    const total = budget * days * platforms.length;
    return { ad: publicAd(a), message: 'Ad requested: up to $' + total.toLocaleString('en-US') + ' in total. It is created paused and nothing is spent until you confirm it is switched on.' };
  }
  throw new Error('Unknown action.');
}

// ---- TikTok, by hand (src/cli/ad-requests.js). Meta is done by the ads worker (meta-ads.js). ----

/** TikTok requests to launch by hand and TikTok ads past their end date to end. */
export function adPending(db, now = Date.now()) {
  const today = adToday(now);
  const out = { launch: [], end: [] };
  for (const a of adLoadAll(db).reverse()) {
    for (const [p, x] of Object.entries(a.platforms)) {
      if (p === 'meta') continue;
      if (x.status === 'requested') out.launch.push({ ...a, platform: p });
      if (['active', 'launched_paused', 'paused'].includes(x.status) && a.end_date < today) out.end.push({ ...a, platform: p });
    }
  }
  return out;
}
/** Record what the launcher did for one platform of a request. */
export function adRecord(db, id, platform, { status, campaign_id, ad_id, ad_group_id, error, spend, impressions, clicks } = {}, now = Date.now()) {
  const a = adLoad(db, id); if (!a) throw new Error('Ad request not found: ' + id);
  const x = a.platforms[platform]; if (!x) throw new Error('This request has no ' + platform + ' part.');
  if (status !== undefined) {
    if (!AD_STATUSES.includes(status)) throw new Error('Unknown status ' + status);
    x.status = status; x[status + '_at'] = gmdateC(new Date(now));
  }
  for (const [k, v] of Object.entries({ campaign_id, ad_id, ad_group_id })) if (v !== undefined) x[k] = str(v);
  if (error !== undefined) x.error = str(error).slice(0, 500);
  if (spend !== undefined || impressions !== undefined || clicks !== undefined) x.stats = { spend: Number(spend ?? 0), impressions: Number(impressions ?? 0), clicks: Number(clicks ?? 0), at: gmdateC(new Date(now)) };
  adStore(db, a);
  return a;
}
