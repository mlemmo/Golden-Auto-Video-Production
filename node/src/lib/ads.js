// Paid ads on Meta (Facebook + Instagram) and TikTok for a finished video ("Run as ad" in the Library), per dealer.
// The dashboard only records requests (table ad_requests) and each dealer's ad settings (state ad_settings:<client>):
// nothing here spends money or calls an ad platform. The launcher creates the ads PAUSED and records the result: for
// now a Claude session using AdWhispr (docs/ADS_LAUNCH.md, through src/cli/ad-requests.js); later a direct AdWhispr
// connection can call adPending/adRecord the same way. A paused ad is switched on only after the user confirms.
import { randomBytes } from 'node:crypto';
import { jsonEncode } from './storedjson.js';
import { state, save } from './db.js';
import { trim, str, gmdateC } from './text.js';
import { CLIENT_DEFAULT, clientFind, clientDetails, clientInventory } from './clients.js';

export const AD_PLATFORMS = ['meta', 'tiktok'];
export const AD_PLATFORM_NAME = { meta: 'Meta (Facebook & Instagram)', tiktok: 'TikTok' };
// Request → launched paused → active → ended; or failed / canceled.
export const AD_STATUSES = ['requested', 'launched_paused', 'active', 'ended', 'failed', 'canceled'];
const MIN_BUDGET = { meta: 5, tiktok: 20 };
// The dashboard uses miles; the request also keeps km for ad tools that take km (AdWhispr radiusKm: 1–80).
export const KM_PER_MILE = 1.609344;
const REELS = ['instagram_reels', 'facebook_reels'];
// Meta puts ads about credit (financing, payments, APR) in a special category with restricted targeting.
const CREDIT_WORDS = /\b(financ\w*|credit|apr|down\s*payment|monthly\s*payment|per\s*month|\/\s*mo\b|\d+\s*\/\s*month|lease\s*(for|from)|loan\w*)\b/i;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

export function adTables(db) {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS ad_requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
}
const load = (db, id) => { adTables(db); const r = db.prepare('SELECT payload FROM ad_requests WHERE id=?').get(id); return r ? JSON.parse(r.payload) : null; };
const store = (db, a) => db.prepare('INSERT INTO ad_requests (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(a.id, jsonEncode(a));
const all = (db) => { adTables(db); return db.prepare('SELECT payload FROM ad_requests ORDER BY rowid DESC').all().map((r) => JSON.parse(r.payload)); };

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
/** Suggested ad copy and link for a video. */
export function adDraft(db, job) {
  const client = job.client ?? CLIENT_DEFAULT;
  let dealer = { name: '', city: '', website: '' };
  try { dealer = clientDetails(clientFind(db, client)); } catch { /* client removed */ }
  const car = (clientInventory(db, client).vehicles ?? []).find((v) => str(v.StockNumber) === str(job.stock));
  const site = dealer.website ? 'https://' + dealer.website.replace(/^https?:\/\//, '') : '';
  const link = /^https:\/\//.test(str(car?.url ?? '')) ? str(car.url) : site;
  const name = str(job.vehicle).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const price = job.price ? ' · $' + Math.round(job.price).toLocaleString('en-US') : '';
  const tiktok = (name + (dealer.name ? ' at ' + dealer.name : '') + '. Book your test drive today.').slice(0, 100);
  return { text: trim(str(job.script ?? '')), headline: (name + price).slice(0, 80), tiktok_text: tiktok, link };
}

const publicAd = (a) => ({ ...a });

/**
 * Actions: ad_status (settings, eligibility and suggested copy for a video), ad_request (record a request), ad_list
 * (requests of one video or all of the account's clients), ad_cancel (a request not launched yet), ad_settings_save
 * (admins). allowed = the account's client ids.
 */
export function adApi(action, inp, db, { allowed = [CLIENT_DEFAULT], user = '', now = Date.now(), random = randomBytes } = {}) {
  adTables(db);
  const mine = (client) => { if (!allowed.includes(client)) throw new Error('Your account has no access to that client.'); };
  if (action === 'ad_status') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    const s = adSettings(db, client);
    const finished = job.finish_status === 'completed' && str(job.captioned_url ?? '').startsWith('https://');
    return { settings: s, meta: !!s.meta_account, tiktok: !!s.tiktok_account, reels: REELS.includes(str(job.format)), eligible: finished,
      reason: finished ? '' : 'This video is not finished yet.', draft: adDraft(db, job) };
  }
  if (action === 'ad_settings') { const client = str(inp.client ?? ''); mine(client); return adSettings(db, client); }
  if (action === 'ad_settings_save') { const client = str(inp.client ?? ''); mine(client); return { settings: adSettingsSave(db, client, inp), message: 'Ad settings saved.' }; }
  if (action === 'ad_list') {
    const id = str(inp.id ?? '');
    return { ads: all(db).filter((a) => allowed.includes(a.client) && (!id || a.job_id === id)).slice(0, 100).map(publicAd) };
  }
  if (action === 'ad_cancel') {
    const a = load(db, str(inp.id ?? '')); if (!a) throw new Error('Ad request not found. Reload the list.');
    mine(a.client);
    const open = Object.values(a.platforms).filter((x) => x.status === 'requested');
    if (!open.length) throw new Error('Only requests that have not been launched can be cancelled here. A launched ad is paused or stopped in the ad account.');
    for (const x of open) x.status = 'canceled';
    store(db, a);
    return { ad: publicAd(a), message: 'Request cancelled.' };
  }
  if (action === 'ad_request') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    if (job.finish_status !== 'completed' || !str(job.captioned_url ?? '').startsWith('https://')) throw new Error('This video is not finished yet.');
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
    const today = new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < today || Date.parse(start) > now + 30 * 86400000) throw new Error('Choose a start date from today up to 30 days ahead.');
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
    for (const p of platforms) if (all(db).some((a) => a.job_id === job.id && ['requested', 'launched_paused', 'active'].includes(a.platforms[p]?.status))) {
      throw new Error('This video already has an open ' + AD_PLATFORM_NAME[p] + ' ad request or ad. Cancel or end it first.');
    }
    const end = new Date(Date.parse(start) + (days - 1) * 86400000).toISOString().slice(0, 10);
    const a = { id: random(12).toString('hex'), client, job_id: job.id, vehicle: str(job.vehicle), stock: str(job.stock), format: str(job.format),
      video_url: str(job.captioned_url), daily_budget: budget, days, start_date: start, end_date: end, radius_address: address, radius_miles: miles, radius_km: Math.min(80, Math.round(miles * KM_PER_MILE * 10) / 10),
      text, headline, tiktok_text: tiktok, link, objective: 'traffic', meta_account: s.meta_account, meta_page: s.meta_page, tiktok_account: s.tiktok_account,
      created_by: str(user), created_at: gmdateC(new Date(now)), platforms: Object.fromEntries(platforms.map((p) => [p, { status: 'requested' }])) };
    store(db, a);
    const total = budget * days * platforms.length;
    return { ad: publicAd(a), message: 'Ad requested: up to $' + total.toLocaleString('en-US') + ' in total. It is created paused and nothing is spent until you confirm it is switched on.' };
  }
  throw new Error('Unknown action.');
}

// ---- The launcher's side (CLI now, a direct AdWhispr connection later) ----

/** Requests and running ads the launcher should act on: to launch, to end (past their end date). */
export function adPending(db, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const out = { launch: [], end: [] };
  for (const a of all(db).reverse()) {
    for (const [p, x] of Object.entries(a.platforms)) {
      if (x.status === 'requested') out.launch.push({ ...a, platform: p });
      if (['active', 'launched_paused'].includes(x.status) && a.end_date < today) out.end.push({ ...a, platform: p });
    }
  }
  return out;
}
/** Record what the launcher did for one platform of a request. */
export function adRecord(db, id, platform, { status, campaign_id, ad_id, ad_group_id, error, spend, impressions, clicks } = {}, now = Date.now()) {
  const a = load(db, id); if (!a) throw new Error('Ad request not found: ' + id);
  const x = a.platforms[platform]; if (!x) throw new Error('This request has no ' + platform + ' part.');
  if (status !== undefined) {
    if (!AD_STATUSES.includes(status)) throw new Error('Unknown status ' + status);
    x.status = status; x[status + '_at'] = gmdateC(new Date(now));
  }
  for (const [k, v] of Object.entries({ campaign_id, ad_id, ad_group_id })) if (v !== undefined) x[k] = str(v);
  if (error !== undefined) x.error = str(error).slice(0, 500);
  if (spend !== undefined || impressions !== undefined || clicks !== undefined) x.stats = { spend: Number(spend ?? 0), impressions: Number(impressions ?? 0), clicks: Number(clicks ?? 0), at: gmdateC(new Date(now)) };
  store(db, a);
  return a;
}
