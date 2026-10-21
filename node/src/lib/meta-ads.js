// Paid Meta ads (Facebook + Instagram) straight through Meta's Marketing API, no third-party service: the ads worker
// (src/cli/ads-worker.js, cron every minute) turns each Meta ad request (ads.js) into a PAUSED campaign → ad set →
// creative → ad in the dealer's own ad account, switches it on or pauses it when the user asks in the dashboard, pauses
// it after its end date and refreshes spend/views/clicks. Token: the dealer's "Connect Facebook & Instagram" login
// (facebook.js; its Facebook Login for Business configuration must include ads_management and ads_read and the ad
// account as an asset, docs/META_SETUP.md); config meta_accounts[client].ads_token, when set, is used instead.
//
// Each run moves every request one step and saves every id the moment Meta returns it, so a run that stops halfway
// never creates the same object twice: the next run (or a Retry) carries on from the last saved id. Everything is
// created PAUSED with an end time on the ad set, so nothing spends until the user switches it on, and Meta stops it
// at the end date by itself.
import { existsSync, readFileSync } from 'node:fs';
import { str, trim, gmdateC } from './text.js';
import { facebookConfig, facebookConnection } from './facebook.js';
import { metaFetch } from './social.js';
import { adTables, adLoad, adLoadAll, adStore } from './ads.js';

// A video still processing after this long is given up (nothing was created that can spend).
const PROCESSING_MAX_MS = 60 * 60 * 1000;
// Spend/views/clicks are refreshed at most this often, and for this long after an ad ended.
const STATS_EVERY_MS = 60 * 60 * 1000, STATS_AFTER_END_MS = 3 * 86400000;

/** A Meta answer that says what went wrong. */
export class MetaAdsError extends Error {}

/** The token and Page the dealer's ads run with (server side only). Page: the one named in the ad settings, else the chosen Page. */
export function metaAdsAccount(db, cfg, client, pageName = '') {
  const c = facebookConnection(db, client);
  const fallback = cfg.meta_accounts && typeof cfg.meta_accounts === 'object' ? cfg.meta_accounts[client] ?? {} : {};
  // A token made for ads in Business Settings (config meta_accounts[client].ads_token) comes first: the Facebook Login
  // system-user token did not receive ads_management/ads_read (2026-10-21). The Page still comes from the connection.
  const token = trim(str(fallback.ads_token || c?.token || ''));
  const want = trim(str(pageName)).toLowerCase();
  const p = (want && c?.pages?.find((x) => str(x.name).toLowerCase() === want)) || c?.pages?.find((x) => x.id === c.page_id) || null;
  const page_id = p?.id ?? (/^\d{5,25}$/.test(str(fallback.page_id ?? '')) ? str(fallback.page_id) : '');
  const ig_user_id = p ? str(p.ig_id ?? '') : (/^\d{5,25}$/.test(str(fallback.ig_user_id ?? '')) ? str(fallback.ig_user_id) : '');
  return { token, page_id, ig_user_id };
}

function graph(cfg, transport, token) {
  const v = facebookConfig(cfg).version;
  const base = 'https://graph.facebook.com/' + v + '/';
  const auth = { Authorization: 'OAuth ' + token };
  const call = async (method, url, headers, body) => {
    const r = await transport(method, url, headers, body);
    if (r.status < 200 || r.status >= 300 || r.json?.error) {
      const e = r.json?.error ?? {};
      const msg = str(e.error_user_msg || e.message || '');
      throw new MetaAdsError('Meta refused the request' + (msg ? ': ' + msg : ' (HTTP ' + r.status + ')') + (e.code ? ' [code ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ']' : ''));
    }
    return r.json ?? {};
  };
  const form = (params) => new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, x]) => [k, typeof x === 'object' ? JSON.stringify(x) : String(x)]))).toString();
  return {
    get: (path, fields) => call('GET', base + path + '?fields=' + encodeURIComponent(fields), auth, null),
    post: (path, params) => call('POST', base + path, { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, form(params)),
    // Ad videos are uploaded from this server (no public link needed): multipart to graph-video.
    upload: (account, file, name) => {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('source', new Blob([readFileSync(file)], { type: 'video/mp4' }), 'video.mp4');
      return call('POST', 'https://graph-video.facebook.com/' + v + '/' + account + '/advideos', auth, fd);
    },
  };
}

/** The finished video file on this server for a request. */
function videoPath(cfg, a) {
  const name = str(a.video_url).split('/').pop();
  const path = String(cfg.asset_dir ?? '') + '/' + name;
  if (!/^[a-f0-9]{40}\.mp4$/.test(name) || !existsSync(path)) throw new MetaAdsError('The finished video file is missing on this server.');
  return path;
}

/** Midnight of a YYYY-MM-DD day in the ad account's time zone, as Unix seconds. */
const dayStart = (day, offsetHours) => Math.round((Date.parse(day + 'T00:00:00Z') - Number(offsetHours || 0) * 3600000) / 1000);

/** One launch step for a request's Meta part (status requested/launching). Returns a log line or ''. */
async function launchStep(g, cfg, acct, a, x, now) {
  if (x.status === 'requested') {
    const info = await g.get(a.meta_account, 'account_status,currency,timezone_offset_hours_utc,name');
    // 1 = active; anything else (disabled, unsettled, closed…) cannot run ads.
    if (Number(info.account_status) !== 1) throw new MetaAdsError('The Meta ad account ' + a.meta_account + ' cannot run ads (status ' + info.account_status + '). Check its billing in Meta Ads Manager.');
    if (str(info.currency) !== 'USD') throw new MetaAdsError('The Meta ad account bills in ' + str(info.currency) + '; this dashboard sets budgets in US dollars.');
    x.tz_offset = Number(info.timezone_offset_hours_utc ?? 0);
    x.status = 'launching'; x.launching_at = gmdateC(new Date(now));
    if (!x.video_id) {
      const v = await g.upload(a.meta_account, videoPath(cfg, a), a.vehicle + ' ' + a.stock);
      x.video_id = str(v.id ?? '');
      if (!x.video_id) throw new MetaAdsError('Meta did not return a video id.');
    }
    return 'video uploaded';
  }
  // launching: wait for the video, then create what is still missing (each id saved by the caller as soon as set).
  if (!x.thumbnail) {
    const s = await g.get(x.video_id, 'status,thumbnails{uri,is_preferred}');
    const st = str(s.status?.video_status ?? '');
    if (st === 'error') throw new MetaAdsError('Meta could not process the video.');
    if (st !== 'ready') {
      if (now - Date.parse(x.launching_at ?? 0) > PROCESSING_MAX_MS) throw new MetaAdsError('Meta was still processing the video after an hour.');
      return '';
    }
    const thumbs = s.thumbnails?.data ?? [];
    x.thumbnail = str((thumbs.find((t) => t.is_preferred) ?? thumbs[0])?.uri ?? '');
    if (!x.thumbnail) throw new MetaAdsError('Meta returned no thumbnail for the video.');
  }
  return 'build';
}

/** Create the paused campaign, ad set, creative and ad that are still missing. save() stores progress after each. */
async function build(g, acct, a, x, now, save) {
  const name = (a.vehicle + ' ' + a.stock + ' ' + a.start_date).slice(0, 200);
  if (!x.campaign_id) {
    const r = await g.post(a.meta_account + '/campaigns', { name, objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    x.campaign_id = str(r.id ?? ''); if (!x.campaign_id) throw new MetaAdsError('Meta did not return a campaign id.'); save();
  }
  if (!x.ad_set_id) {
    const start = Math.max(dayStart(a.start_date, x.tz_offset), Math.round(now / 1000) + 300);
    const end = dayStart(a.end_date, x.tz_offset) + 86400;
    const r = await g.post(a.meta_account + '/adsets', {
      name: name + ' — ad set', campaign_id: x.campaign_id, status: 'PAUSED',
      daily_budget: Math.round(Number(a.daily_budget) * 100), billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP', destination_type: 'WEBSITE', start_time: start, end_time: end,
      targeting: { geo_locations: { custom_locations: [{ address_string: a.radius_address, radius: Number(a.radius_miles), distance_unit: 'mile' }] },
        age_min: 18, targeting_automation: { advantage_audience: 0 } },
    });
    x.ad_set_id = str(r.id ?? ''); if (!x.ad_set_id) throw new MetaAdsError('Meta did not return an ad set id.'); save();
  }
  if (!x.creative_id) {
    const story = { page_id: acct.page_id, video_data: { video_id: x.video_id, image_url: x.thumbnail, message: a.text, call_to_action: { type: 'LEARN_MORE', value: { link: a.link } } } };
    if (a.headline) story.video_data.title = a.headline;
    if (acct.ig_user_id) story.instagram_user_id = acct.ig_user_id;
    const r = await g.post(a.meta_account + '/adcreatives', { name: name + ' — creative', object_story_spec: story });
    x.creative_id = str(r.id ?? ''); if (!x.creative_id) throw new MetaAdsError('Meta did not return a creative id.'); save();
  }
  if (!x.ad_id) {
    const r = await g.post(a.meta_account + '/ads', { name, adset_id: x.ad_set_id, creative: { creative_id: x.creative_id }, status: 'PAUSED' });
    x.ad_id = str(r.id ?? ''); if (!x.ad_id) throw new MetaAdsError('Meta did not return an ad id.'); save();
  }
}

/** Switch every level on (the ad only spends when campaign, ad set and ad are all active), or pause the campaign. */
async function applyWant(g, x) {
  if (x.want === 'active') { for (const id of [x.ad_id, x.ad_set_id, x.campaign_id]) await g.post(id, { status: 'ACTIVE' }); return 'active'; }
  await g.post(x.campaign_id, { status: 'PAUSED' }); return 'paused';
}

/**
 * One worker run over every Meta ad request. opts: { transport (Meta HTTP), now } — replaceable in tests.
 * Returns log lines.
 */
export async function adsWorkerRun(db, cfg, opts = {}) {
  const { transport = metaFetch, now = Date.now() } = opts;
  adTables(db);
  const log = [];
  const today = new Date(now).toISOString().slice(0, 10);
  for (const listed of adLoadAll(db).reverse()) {
    // Read again: the dashboard may have cancelled it or asked to switch it on since the list was read.
    const a = adLoad(db, listed.id); const x = a?.platforms.meta;
    if (!x || !['requested', 'launching', 'launched_paused', 'active', 'paused', 'ended'].includes(x.status)) continue;
    const save = () => adStore(db, a);
    const tag = a.id.slice(0, 8) + ' ' + a.vehicle + ' meta: ';
    const acct = metaAdsAccount(db, cfg, a.client, a.meta_page);
    const g = graph(cfg, transport, acct.token);
    try {
      if (['requested', 'launching'].includes(x.status)) {
        if (!acct.token) throw new MetaAdsError('Facebook is not connected for this dealer. Connect Facebook & Instagram (with ad permissions) under the dealer\'s details, then press Retry.');
        if (!acct.page_id) throw new MetaAdsError('No Facebook Page found for the ads' + (a.meta_page ? ' (named "' + a.meta_page + '")' : '') + '. Check the Page name in Paid ads, or reconnect Facebook.');
        const step = await launchStep(g, cfg, acct, a, x, now); save();
        if (step && step !== 'build') log.push(tag + step);
        if (step !== 'build') continue;
        await build(g, acct, a, x, now, save);
        x.status = 'launched_paused'; x.launched_paused_at = gmdateC(new Date(now)); delete x.error; save();
        log.push(tag + 'created paused (campaign ' + x.campaign_id + ')');
        continue;
      }
      // Past the end date: pause (Meta has also stopped the ad set at its end time).
      if (['launched_paused', 'active', 'paused'].includes(x.status) && a.end_date < today) {
        delete x.want;
        await g.post(x.campaign_id, { status: 'PAUSED' });
        x.status = 'ended'; x.ended_at = gmdateC(new Date(now)); save(); log.push(tag + 'ended');
      } else if (x.want && ['launched_paused', 'active', 'paused'].includes(x.status)) {
        const done = await applyWant(g, x);
        delete x.want; delete x.error;
        if (x.status !== done) { x.status = done; x[done + '_at'] = gmdateC(new Date(now)); }
        save(); log.push(tag + (done === 'active' ? 'switched on' : 'paused'));
      }
      // Results, at most hourly while it can still change.
      const ended = x.status === 'ended' && now - Date.parse(x.ended_at ?? 0) > STATS_AFTER_END_MS;
      if (x.campaign_id && ['active', 'paused', 'ended'].includes(x.status) && !ended && !(x.stats && now - Date.parse(x.stats.at) < STATS_EVERY_MS)) {
        const r = await g.get(x.campaign_id + '/insights', 'spend,impressions,clicks');
        const d = r.data?.[0] ?? {};
        x.stats = { spend: Number(d.spend ?? 0), impressions: Number(d.impressions ?? 0), clicks: Number(d.clicks ?? 0), at: gmdateC(new Date(now)) };
        save();
      }
    } catch (e) {
      const msg = e instanceof MetaAdsError ? e.message : 'Could not reach Meta: ' + e.message;
      if (['requested', 'launching'].includes(x.status)) {
        // Nothing created here can spend (all paused); Retry carries on from the last saved id.
        x.status = 'failed'; x.error = msg; save(); log.push(tag + 'failed: ' + msg);
      } else if (x.want) {
        delete x.want; x.error = msg; save(); log.push(tag + 'change failed: ' + msg);
      } else { x.error = msg; save(); log.push(tag + msg); }
    }
  }
  return log;
}
