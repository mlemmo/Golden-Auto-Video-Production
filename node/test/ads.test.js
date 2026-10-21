// Paid ad requests. Nothing here calls an ad platform: the dashboard only records requests and settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb, save } from '../src/lib/db.js';
import { jsonEncode } from '../src/lib/storedjson.js';
import { adApi, adPending, adRecord, adSettings } from '../src/lib/ads.js';

const NOW = Date.parse('2026-10-21T17:00:00Z');
function setup(job = {}) {
  const db = openMemoryDb();
  const j = { id: 'job1', client: 'golden-auto', vehicle: '2016 CHEVROLET SILVERADO 1500', stock: '217723', format: 'instagram_reels', duration: 30, price: 19366,
    finish_status: 'completed', captioned_url: 'https://staging.example.com:4343/assets/' + 'a'.repeat(40) + '.mp4', script: 'Take a look at this 2016 Chevrolet Silverado. Priced at $19,366.', ...job };
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(j.id, null, jsonEncode(j));
  let n = 0;
  const api = (a, inp, o = {}) => adApi(a, inp, db, { now: NOW, user: 'mark@example.com', random: () => Buffer.from([n++, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ...o });
  return { db, api };
}
const settings = { client: 'golden-auto', meta_account: 'act_1331366881207657', meta_page: 'Golden Auto', tiktok_account: '7694780320964493313',
  radius_address: '24532 San Ramon Valley Blvd, San Ramon, CA', radius_miles: 15, daily_budget: 20, days: 7 };
const request = (o = {}) => ({ id: 'job1', platforms: ['meta', 'tiktok'], daily_budget: 25, days: 5, start_date: '2026-10-22', radius_address: settings.radius_address, radius_miles: 15,
  text: 'Take a look at this Silverado.', headline: '2016 Chevrolet Silverado · $19,366', tiktok_text: '2016 Chevrolet Silverado at Golden Auto. Book your test drive today.', link: 'https://mygoldenauto.net', ...o });

test('dealer ad settings: checked ids; suggested copy and link for a video', () => {
  const { api } = setup();
  assert.throws(() => api('ad_settings_save', { ...settings, meta_account: '1331366881207657' }), /act_/);
  assert.throws(() => api('ad_settings_save', { ...settings, client: 'eastbay' }), /no access/);
  api('ad_settings_save', settings);
  const s = api('ad_status', { id: 'job1' });
  assert.deepEqual([s.meta, s.tiktok, s.reels, s.eligible], [true, true, true, true]);
  assert.deepEqual(s.draft, { text: 'Take a look at this 2016 Chevrolet Silverado. Priced at $19,366.', headline: '2016 Chevrolet Silverado 1500 · $19,366',
    tiktok_text: '2016 Chevrolet Silverado 1500 at Golden Auto. Book your test drive today.', link: 'https://mygoldenauto.net' });
});

test('a request is checked, recorded, and never spends: budgets, dates, TikTok rules, credit wording, duplicates', () => {
  const { api } = setup();
  assert.throws(() => api('ad_request', request()), /No Meta ad account/);
  api('ad_settings_save', settings);
  assert.throws(() => api('ad_request', request({ platforms: [] })), /Choose Meta, TikTok or both/);
  assert.throws(() => api('ad_request', request({ daily_budget: 10 })), /TikTok needs a daily budget of at least \$20/);
  assert.throws(() => api('ad_request', request({ days: 31 })), /1–30 days/);
  assert.throws(() => api('ad_request', request({ start_date: '2026-10-20' })), /start date/);
  assert.throws(() => api('ad_request', request({ tiktok_text: 'Great truck 🚗' })), /without emoji/);
  assert.throws(() => api('ad_request', request({ text: 'Easy financing available!' })), /Credit/);
  assert.throws(() => api('ad_request', request({ link: 'http://x.com' })), /https/);
  const r = api('ad_request', request());
  assert.match(r.message, /up to \$250 in total.*created paused/);
  assert.deepEqual([r.ad.end_date, r.ad.platforms.meta.status, r.ad.platforms.tiktok.status, r.ad.meta_account], ['2026-10-26', 'requested', 'requested', 'act_1331366881207657']);
  assert.throws(() => api('ad_request', request({ platforms: ['meta'] })), /already has an open Meta/);
  assert.equal(api('ad_list', {}, { allowed: ['eastbay'] }).ads.length, 0, 'other accounts do not see it');
});

test('TikTok needs the Reels format; unfinished videos cannot be advertised', () => {
  const sq = setup({ format: 'square' });
  sq.api('ad_settings_save', settings);
  assert.throws(() => sq.api('ad_request', request({ platforms: ['tiktok'] })), /Reels 9:16/);
  assert.ok(sq.api('ad_request', request({ platforms: ['meta'] })).ad, 'Meta takes other formats');
  const wip = setup({ finish_status: 'queued' });
  wip.api('ad_settings_save', settings);
  assert.throws(() => wip.api('ad_request', request()), /not finished/);
});

test('the launcher side: pending list, results recorded, ads past their end date listed to end', () => {
  const { api, db } = setup();
  api('ad_settings_save', settings);
  const { ad } = api('ad_request', request());
  let p = adPending(db, NOW);
  assert.deepEqual(p.launch.map((x) => x.platform), ['meta', 'tiktok']);
  adRecord(db, ad.id, 'meta', { status: 'launched_paused', campaign_id: '120200000000001', ad_id: '120200000000003' }, NOW);
  adRecord(db, ad.id, 'tiktok', { status: 'failed', error: 'TikTok identity missing' }, NOW);
  assert.throws(() => adRecord(db, ad.id, 'meta', { status: 'running' }), /Unknown status/);
  assert.throws(() => api('ad_cancel', { id: ad.id }), /not been launched/);
  adRecord(db, ad.id, 'meta', { status: 'active', spend: '12.5', impressions: '3400', clicks: '41' }, NOW);
  const shown = api('ad_list', { id: 'job1' }).ads[0].platforms;
  assert.deepEqual([shown.meta.status, shown.meta.stats.clicks, shown.tiktok.error], ['active', 41, 'TikTok identity missing']);
  p = adPending(db, Date.parse('2026-10-27T17:00:00Z'));
  assert.deepEqual([p.launch.length, p.end.map((x) => x.platform)], [0, ['meta']], 'past its end date: to be ended');
});

test('radius in miles; the request also carries km for the ad tools; old km settings are converted', () => {
  const { api, db } = setup();
  api('ad_settings_save', settings);
  assert.throws(() => api('ad_settings_save', { ...settings, radius_miles: 60 }), /1–50 miles/);
  assert.throws(() => api('ad_request', request({ radius_miles: 0 })), /1–50 miles/);
  const { ad } = api('ad_request', request({ radius_miles: 15 }));
  assert.deepEqual([ad.radius_miles, ad.radius_km], [15, 24.1]);
  save(db, 'ad_settings:eastbay', { radius_km: 40 });
  assert.equal(adSettings(db, 'eastbay').radius_miles, 25, 'settings saved in km before become miles');
  assert.equal(adSettings(db, 'nobody').radius_miles, 15, 'default 15 miles');
});
