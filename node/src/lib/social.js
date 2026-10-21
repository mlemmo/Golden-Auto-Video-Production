// Posting finished videos to the dealer's Facebook Page and Instagram account as Reels, now or at a chosen time.
// Meta's Graph API (config meta_graph_version, default v26.0) with a Page access token per client (config
// meta_accounts: { "<client id>": { page_id, page_token, ig_user_id } }). Instagram's API cannot schedule, so this app
// keeps the schedule for both platforms (table social_posts) and the social worker (src/cli/social-worker.js, cron
// every minute) publishes due posts. Each run moves every platform one step and saves it, so a slow upload or Instagram's
// processing never blocks the run: Facebook start → upload → wait for "ready" → finish; Instagram container → upload →
// wait for FINISHED → media_publish. A failure before anything could be public is "failed" (the user may retry); a lost
// answer to the final publish call is "check" (look on Facebook/Instagram; never re-posted automatically).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { jsonEncode } from './storedjson.js';
import { trim, str, toInt, gmdateC } from './text.js';
import { CLIENT_DEFAULT, clientFind, clientDetails } from './clients.js';
import { runProcess } from './finishing.js';
import { connectedAccount, facebookConfig } from './facebook.js';

export const PLATFORMS = ['facebook', 'instagram'];
export const PLATFORM_NAME = { facebook: 'Facebook', instagram: 'Instagram' };
/** Reels need 9:16; the other formats are for feed posts. */
export const REELS_FORMATS = ['instagram_reels', 'facebook_reels'];
export const CAPTION_MAX = 2200;
const SCHEDULE_MIN_MS = 10 * 60 * 1000, SCHEDULE_MAX_MS = 29 * 24 * 3600 * 1000;
// Meta's limits per account in a moving 24 hours.
const DAILY_LIMIT = { facebook: 30, instagram: 100 };
// A platform still processing after this long is given up (nothing was published).
const PROCESSING_MAX_MS = 60 * 60 * 1000;
const PENDING = ['scheduled', 'publishing', 'uploading', 'processing'];

export function socialTables(db) {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS social_posts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
}
const load = (db, id) => { const r = db.prepare('SELECT payload FROM social_posts WHERE id=?').get(id); return r ? JSON.parse(r.payload) : null; };
const store = (db, p) => db.prepare('INSERT INTO social_posts (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(p.id, jsonEncode(p));
const allPosts = (db) => db.prepare('SELECT payload FROM social_posts ORDER BY rowid DESC').all().map((r) => JSON.parse(r.payload));

/**
 * The client's Meta account: the Page chosen with "Connect Facebook & Instagram" (facebook.js), else config
 * meta_accounts; checked. Secrets stay on the server.
 */
export function socialAccount(cfg, client, db = null) {
  const a = (db && connectedAccount(db, client)) ?? (cfg.meta_accounts && typeof cfg.meta_accounts === 'object' ? cfg.meta_accounts[client] : null) ?? {};
  const id = (x) => (/^\d{5,25}$/.test(str(x ?? '')) ? str(x) : '');
  const token = trim(str(a.page_token ?? ''));
  const page = id(a.page_id), ig = id(a.ig_user_id);
  return { token, page_id: page, ig_user_id: ig, facebook: !!(token && page), instagram: !!(token && ig) };
}
const graphVersion = (cfg) => facebookConfig(cfg).version;

function jobFor(db, id) {
  const r = db.prepare('SELECT payload FROM jobs WHERE id=?').get(str(id ?? ''));
  if (!r) throw new Error('Video not found. Reload the library.');
  return JSON.parse(r.payload);
}
/** The finished file on this server, or a reason it cannot be posted as a Reel. */
function videoFile(cfg, job) {
  if (job.finish_status !== 'completed' || !str(job.captioned_url ?? '').startsWith('https://')) return { reason: 'This video is not finished yet.' };
  if (!REELS_FORMATS.includes(str(job.format))) return { reason: 'Reels must be 9:16. Make this car in the Reels 9:16 format to post it.' };
  if (toInt(job.duration ?? 0) > 90) return { reason: 'Reels can be at most 90 seconds long.' };
  const name = str(job.captioned_url).split('/').pop();
  const path = String(cfg.asset_dir ?? '') + '/' + name;
  if (!/^[a-f0-9]{40}\.mp4$/.test(name) || !existsSync(path)) return { reason: 'The finished video file is missing on this server.' };
  return { path };
}
/** Suggested caption: the video's caption text and the dealer's website. */
export function socialCaption(db, job) {
  const client = job.client ?? CLIENT_DEFAULT;
  let site = '';
  try { site = clientDetails(clientFind(db, client)).website; } catch { /* client removed */ }
  return [trim(str(job.script ?? '')), site && !str(job.script ?? '').includes(site) ? site : ''].filter(Boolean).join('\n\n');
}

const publicPlatform = (x) => ({ status: x.status, error: x.error ?? '', url: x.url ?? '', published_at: x.published_at ?? '' });
const publicPost = (p) => ({ id: p.id, client: p.client, job_id: p.job_id, vehicle: p.vehicle, caption: p.caption, scheduled_at: p.scheduled_at, created_at: p.created_at,
  created_by: p.created_by, platforms: Object.fromEntries(Object.entries(p.platforms).map(([k, x]) => [k, publicPlatform(x)])) });

/**
 * Actions. social_status: which platforms are set up for the video's client, whether the video can be posted and a
 * suggested caption. social_post: post now or schedule. social_list: posts (optionally of one video). social_cancel:
 * stop scheduled platforms. social_retry: schedule failed platforms again now. allowed = the account's client ids.
 */
export function socialApi(action, inp, db, cfg, { allowed = [CLIENT_DEFAULT], user = '', now = Date.now(), random = randomBytes } = {}) {
  socialTables(db);
  const mine = (client) => { if (!allowed.includes(client)) throw new Error('Your account has no access to that client.'); };
  if (action === 'social_status') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    const a = socialAccount(cfg, client, db), f = videoFile(cfg, job);
    return { facebook: a.facebook, instagram: a.instagram, eligible: !f.reason, reason: f.reason ?? '', caption: socialCaption(db, job) };
  }
  if (action === 'social_list') {
    const id = str(inp.id ?? '');
    return { posts: allPosts(db).filter((p) => allowed.includes(p.client) && (!id || p.job_id === id)).slice(0, 50).map(publicPost) };
  }
  if (action === 'social_post') {
    const job = jobFor(db, inp.id), client = job.client ?? CLIENT_DEFAULT; mine(client);
    const f = videoFile(cfg, job); if (f.reason) throw new Error(f.reason);
    const a = socialAccount(cfg, client, db);
    const platforms = [...new Set(Array.isArray(inp.platforms) ? inp.platforms.map(str) : [])].filter((p) => PLATFORMS.includes(p));
    if (!platforms.length) throw new Error('Choose Facebook, Instagram or both.');
    for (const p of platforms) if (!a[p]) throw new Error(PLATFORM_NAME[p] + ' is not connected for this dealer yet (Connect Facebook & Instagram under the dealer\'s details).');
    const caption = trim(str(inp.caption ?? '')).replace(/\r\n/g, '\n');
    if (!caption) throw new Error('Write a caption.');
    if ([...caption].length > CAPTION_MAX) throw new Error('The caption can be at most ' + CAPTION_MAX + ' characters.');
    if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) throw new Error('Instagram allows at most 30 hashtags.');
    let at = now;
    if (str(inp.when ?? 'now') !== 'now') {
      at = Date.parse(str(inp.when));
      if (!Number.isFinite(at)) throw new Error('Choose a date and time for the post.');
      if (at < now + SCHEDULE_MIN_MS) throw new Error('Schedule the post at least 10 minutes ahead, or post it now.');
      if (at > now + SCHEDULE_MAX_MS) throw new Error('Posts can be scheduled up to 29 days ahead.');
    }
    const posts = allPosts(db);
    for (const p of platforms) {
      const same = posts.filter((x) => x.job_id === job.id && x.platforms[p]);
      if (same.some((x) => PENDING.includes(x.platforms[p].status))) throw new Error('This video is already scheduled for ' + PLATFORM_NAME[p] + '. Cancel that post first.');
      if (!inp.again && same.some((x) => ['published', 'check'].includes(x.platforms[p].status))) throw new Error('This video was already posted to ' + PLATFORM_NAME[p] + '. Tick "Post again" to post it once more.');
      const day = posts.filter((x) => x.client === client && x.platforms[p] && x.platforms[p].status !== 'canceled' && x.platforms[p].status !== 'failed'
        && Math.abs(Date.parse(x.scheduled_at) - at) < 24 * 3600 * 1000).length;
      if (day >= DAILY_LIMIT[p]) throw new Error(PLATFORM_NAME[p] + ' allows ' + DAILY_LIMIT[p] + ' posts a day through its API. Choose another time.');
    }
    const post = { id: random(12).toString('hex'), client, job_id: job.id, vehicle: str(job.vehicle), stock: str(job.stock), caption,
      scheduled_at: new Date(at).toISOString(), created_at: gmdateC(new Date(now)), created_by: str(user),
      platforms: Object.fromEntries(platforms.map((p) => [p, { status: 'scheduled' }])) };
    store(db, post);
    const list = platforms.map((p) => PLATFORM_NAME[p]).join(' and ');
    return { post: publicPost(post), message: at <= now ? 'Posting to ' + list + ' now. It takes a few minutes; the status updates below.' : 'Scheduled for ' + list + '.' };
  }
  if (action === 'social_cancel' || action === 'social_retry') {
    const post = load(db, str(inp.id ?? '')); if (!post) throw new Error('Post not found. Reload the list.');
    mine(post.client);
    const from = action === 'social_cancel' ? ['scheduled'] : ['failed'];
    const hit = Object.entries(post.platforms).filter(([, x]) => from.includes(x.status));
    if (!hit.length) throw new Error(action === 'social_cancel' ? 'Only posts that have not started can be cancelled.' : 'Nothing to retry: only failed platforms can be posted again.');
    for (const [, x] of hit) {
      if (action === 'social_cancel') x.status = 'canceled';
      else { for (const k of Object.keys(x)) delete x[k]; x.status = 'scheduled'; }
    }
    if (action === 'social_retry') post.scheduled_at = new Date(Math.max(now, Date.parse(post.scheduled_at) || now)).toISOString();
    store(db, post);
    return { post: publicPost(post), message: action === 'social_cancel' ? 'Cancelled.' : 'Posting again now.' };
  }
  throw new Error('Unknown action.');
}

// ---- Publishing (social worker) ----

/** A Meta answer that says what went wrong (nothing was posted by that call). */
class MetaError extends Error {}

/** fetch for Meta: { status, json }; a network failure or timeout throws a plain Error (outcome unknown). */
export async function metaFetch(method, url, headers = {}, body = null) {
  const r = await fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(180000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

function graph(cfg, transport, token) {
  const base = 'https://graph.facebook.com/' + graphVersion(cfg) + '/';
  const auth = { Authorization: 'OAuth ' + token };
  const call = async (method, url, headers, body) => {
    const r = await transport(method, url, headers, body);
    if (r.status < 200 || r.status >= 300 || r.json?.error) {
      const e = r.json?.error ?? {};
      throw new MetaError('Meta refused the request' + (e.message ? ': ' + str(e.message) : ' (HTTP ' + r.status + ')') + (e.code ? ' [code ' + e.code + ']' : ''));
    }
    return r.json ?? {};
  };
  return {
    get: (path, fields) => call('GET', base + path + '?fields=' + encodeURIComponent(fields), auth, null),
    post: (path, params) => call('POST', base + path, { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams(params).toString()),
    upload: (kind, id, file) => {
      const bytes = readFileSync(file);
      return call('POST', 'https://rupload.facebook.com/' + kind + '/' + graphVersion(cfg) + '/' + id, { ...auth, offset: '0', file_size: String(bytes.length) }, bytes);
    },
  };
}

/** The upload copy: same picture, sound as Meta asks (AAC 48 kHz stereo 128 kbps), index at the start. */
export async function socialCopy(cfg, source, out) {
  const r = await runProcess(str(cfg.ffmpeg_path ?? '/usr/bin/ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart', out], { stdio: 'ignore', timeoutMs: 120000 });
  if (r.code !== 0 || !existsSync(out)) throw new Error('Could not prepare the video file for upload.');
  return out;
}

/** One platform, one step. Returns a log line or ''. */
async function stepFacebook(g, a, post, x, file, cfg, now) {
  if (x.status === 'scheduled') {
    x.status = 'uploading'; x.started_at = gmdateC(new Date(now));
    const s = await g.post(a.page_id + '/video_reels', { upload_phase: 'start' });
    x.video_id = str(s.video_id ?? '');
    if (!x.video_id) throw new MetaError('Facebook did not return a video id.');
    await g.upload('video-upload', x.video_id, file());
    x.status = 'processing';
    return 'facebook uploaded';
  }
  if (x.status === 'processing') {
    const s = (await g.get(x.video_id, 'status')).status ?? {};
    if (s.video_status === 'error' || s.processing_phase?.status === 'error') throw new MetaError('Facebook could not process the video: ' + str(s.processing_phase?.error?.message ?? s.video_status));
    if (s.video_status !== 'ready' && s.uploading_phase?.status !== 'complete') return '';
    x.status = 'publishing'; x.finish_started = gmdateC(new Date(now));
    return 'publish';
  }
  return '';
}
async function finishFacebook(g, a, post, x) {
  const r = await g.post(a.page_id + '/video_reels', { video_id: x.video_id, upload_phase: 'finish', video_state: 'PUBLISHED', description: post.caption });
  if (r.success === false) throw new MetaError('Facebook did not publish the reel.');
  x.post_id = str(r.post_id ?? '');
}
async function stepInstagram(g, a, post, x, file, cfg, now) {
  if (x.status === 'scheduled') {
    x.status = 'uploading'; x.started_at = gmdateC(new Date(now));
    const c = await g.post(a.ig_user_id + '/media', { media_type: 'REELS', upload_type: 'resumable', caption: post.caption, share_to_feed: 'true' });
    x.container_id = str(c.id ?? '');
    if (!x.container_id) throw new MetaError('Instagram did not return a container id.');
    await g.upload('ig-api-upload', x.container_id, file());
    x.status = 'processing';
    return 'instagram uploaded';
  }
  if (x.status === 'processing') {
    const s = str((await g.get(x.container_id, 'status_code')).status_code ?? '');
    if (s === 'ERROR' || s === 'EXPIRED') throw new MetaError('Instagram could not process the video (' + s + ').');
    // Already published (an earlier answer was lost): never published twice.
    if (s === 'PUBLISHED') { x.status = 'published'; x.published_at = gmdateC(new Date(now)); return 'instagram published'; }
    if (s !== 'FINISHED') return '';
    x.status = 'publishing'; x.finish_started = gmdateC(new Date(now));
    return 'publish';
  }
  return '';
}
async function finishInstagram(g, a, post, x) {
  const r = await g.post(a.ig_user_id + '/media_publish', { creation_id: x.container_id });
  x.media_id = str(r.id ?? '');
  if (!x.media_id) throw new MetaError('Instagram did not return the published post.');
}

/**
 * One worker run: every due or in-progress platform moves one step. opts: { transport (Meta HTTP), prepare(cfg,
 * source, out), now } — replaceable in tests. Returns log lines.
 */
export async function socialWorkerRun(db, cfg, opts = {}) {
  const { transport = metaFetch, prepare = socialCopy, now = Date.now() } = opts;
  socialTables(db);
  const log = [];
  const dir = String(cfg.data_dir ?? '') + '/social';
  for (const post of allPosts(db).reverse()) {
    // A publish call cut off by a stopped run: its outcome is unknown, so it is never repeated.
    for (const x of Object.values(post.platforms)) if (x.status === 'publishing' && now - Date.parse(x.finish_started ?? 0) > 10 * 60 * 1000) {
      x.status = 'check'; x.error = 'Publishing was interrupted. Check the page before posting again.'; store(db, post);
    }
    const active = Object.entries(post.platforms).filter(([, x]) => (x.status === 'scheduled' && Date.parse(post.scheduled_at) <= now) || x.status === 'processing');
    if (!active.length) continue;
    const a = socialAccount(cfg, post.client, db);
    const g = graph(cfg, transport, a.token);
    let copy = '';
    const file = () => {
      if (copy) return copy;
      throw new Error('upload copy missing');
    };
    for (const [p, x] of active) {
      const tag = post.id.slice(0, 8) + ' ' + post.vehicle + ' ' + p + ': ';
      try {
        if (!a[p]) throw new MetaError(PLATFORM_NAME[p] + ' is no longer connected for this dealer.');
        if (x.status === 'processing' && now - Date.parse(x.started_at ?? post.scheduled_at) > PROCESSING_MAX_MS) throw new MetaError(PLATFORM_NAME[p] + ' was still processing the video after an hour.');
        if (x.status === 'scheduled' && !copy) {
          const job = jobFor(db, post.job_id), f = videoFile(cfg, job);
          if (f.reason) throw new MetaError(f.reason);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
          copy = await prepare(cfg, f.path, dir + '/' + post.id + '.mp4');
          if (statSync(copy).size > 1024 * 1024 * 1024) throw new MetaError('The video file is too large to upload.');
        }
        const step = await (p === 'facebook' ? stepFacebook : stepInstagram)(g, a, post, x, file, cfg, now);
        store(db, post);
        if (step && step !== 'publish') log.push(tag + step);
        if (step !== 'publish') continue;
        // The publish call: an answer that never arrives may still have published, so it is never repeated.
        try { await (p === 'facebook' ? finishFacebook : finishInstagram)(g, a, post, x); }
        catch (e) {
          if (e instanceof MetaError) throw e;
          x.status = 'check'; x.error = 'No answer from ' + PLATFORM_NAME[p] + ' when publishing. Check the ' + PLATFORM_NAME[p] + ' page before posting again.';
          store(db, post); log.push(tag + 'unclear: ' + e.message); continue;
        }
        x.status = 'published'; x.published_at = gmdateC(new Date(now)); delete x.error;
        try {
          if (p === 'facebook') { const l = str((await g.get(x.video_id, 'permalink_url')).permalink_url ?? ''); x.url = l.startsWith('/') ? 'https://www.facebook.com' + l : l; }
          else x.url = str((await g.get(x.media_id, 'permalink')).permalink ?? '');
        } catch { /* the link is a nicety */ }
        if (!/^https:\/\//.test(x.url ?? '')) delete x.url;
        store(db, post); log.push(tag + 'published');
      } catch (e) {
        // Before the publish call nothing is public: the user may retry. A lost answer while uploading is the same.
        x.status = 'failed'; x.error = e instanceof MetaError ? e.message : 'Could not reach ' + PLATFORM_NAME[p] + ': ' + e.message;
        store(db, post); log.push(tag + 'failed: ' + x.error);
      }
    }
    // The upload copy is kept only while a platform still needs it.
    const path = dir + '/' + post.id + '.mp4';
    if (!Object.values(post.platforms).some((x) => x.status === 'scheduled') && existsSync(path)) { try { unlinkSync(path); } catch { /* gone */ } }
  }
  return log;
}
