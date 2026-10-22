// Video jobs: Higgsfield reference uploads, the paid Seedance generation, status polls, the jobs list, deleting a
// job, "My footage" jobs, and reading a car's detail page (enrich).
// Paid-call rules kept exactly: generate needs its approval checkbox, the request is reserved first under a fingerprint
// that includes the exact prompt (a repeat is refused unless the earlier one failed or was canceled), a failed
// reference upload releases it, and a submission whose outcome is unclear is kept as "submission_uncertain" and never
// retried automatically. Authenticated Higgsfield POSTs and storage PUTs go through a Python helper
// (private/reference_http.py: https only, no redirects).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, mkdirSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trim, str, toInt, toFloat, truthy, isNumeric, lower, gmdateC, parseUrl, U_SPACE } from './text.js';
import { jsonEncode } from './storedjson.js';
import { parseHtml, hasClassToken } from './dom.js';
import { highestPrice, priceMatches, title } from './price.js';
import { probeImage } from './images.js';
import { validateAppBase, publicImage, cutoutSheet, sheetRebuild, sheetUpToDate } from './media.js';
import { state, save } from './db.js';
import { CLIENT_DEFAULT, clientInventory, clientInventoryKey } from './clients.js';
import { requestText, rawurlencode, goldenInventory } from './website.js';
import { narrationTables, narrationLoad, narrationCheckAudio } from './narrations.js';
import { nativeSpeech, speechScript } from './speech.js';
import { promptNative, prompt } from './prompts.js';
import { spokespersonFind } from './spokespersons.js';
import { sceneFind } from './scenes.js';

const UPLOADER = fileURLToPath(new URL('../../../private/reference_http.py', import.meta.url));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const assetDir = (cfg) => String(cfg.asset_dir ?? '');
export const NARRATION_OFFSET = 0.5;

// ---- HTTP ----

/** uploadHttp(): the Python uploader (headers as { name: value }); the response body, or an error on any non-2xx. */
export function uploadHttp(method, url, headers, body) {
  if (!url.startsWith('https://')) throw new Error('Higgsfield upload requires HTTPS.');
  const mapped = {};
  for (const header of headers) {
    const i = header.indexOf(':');
    if (i < 0) throw new Error('Invalid upload header.');
    mapped[trim(header.slice(0, i))] = trim(header.slice(i + 1));
  }
  const payload = jsonEncode({ method, url, headers: mapped, body: Buffer.from(body).toString('base64') });
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/python3', [UPLOADER], { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = []; let failed = false;
    const timer = setTimeout(() => p.kill('SIGKILL'), 90000);
    p.stdout.on('data', (d) => out.push(d));
    p.stdin.on('error', () => { failed = true; });
    p.on('error', () => { clearTimeout(timer); reject(new Error('Cannot start Python reference uploader.')); });
    p.on('close', (exit) => {
      clearTimeout(timer);
      let result = null; try { result = JSON.parse(Buffer.concat(out).toString()); } catch { /* status 0 below */ }
      const code = toInt(result?.status ?? 0);
      if (failed || exit !== 0 || code < 200 || code >= 300) return reject(new Error('Reference upload ' + method + ' failed (HTTP ' + code + '). No video was submitted.'));
      const raw = str(result.body ?? '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) return reject(new Error('Invalid Python upload response.'));
      resolve(Buffer.from(raw, 'base64'));
    });
    p.stdin.end(payload);
  });
}

/** request($url, $payload, $key) for Higgsfield: POSTs through the uploader, GETs (status polls) directly. */
export async function higgsfieldRequest(url, payload, key, transport = uploadHttp) {
  if (payload !== null && key !== '' && parseUrl(url)?.host === 'api.higgsfield.ai') {
    try { return (await transport('POST', url, ['Authorization: Key ' + key, 'Content-Type: application/json', 'Accept: application/json'], Buffer.from(jsonEncode(payload)))).toString(); }
    catch { throw new Error('Higgsfield API POST failed. Submission was not confirmed.'); }
  }
  if (!url.startsWith('https://')) throw new Error('HTTPS is required.');
  const headers = { Accept: 'application/json,text/html', 'User-Agent': 'GoldenAutoInventoryVideo/1.0' };
  if (key !== '') headers.Authorization = 'Key ' + key;
  let res;
  try { res = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(45000) }); }
  catch { throw new Error('Remote request failed (HTTP 0).'); }
  if (res.status < 200 || res.status >= 300) throw new Error('Remote request failed (HTTP ' + res.status + ').');
  const body = await res.text();
  if (Buffer.byteLength(body) > 8000000) throw new Error('Remote response is too large.');
  return body;
}

// ---- References ----

/** referenceImageUrl(): an image in this dashboard's assets folder, or any public https image. */
export function referenceImageUrl(url, cfg) {
  const prefix = validateAppBase(cfg) + '/assets/';
  if (url.startsWith(prefix) && /^[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i.test(url.slice(prefix.length))) return url;
  return publicImage(url);
}

const realpath = (p) => { try { return realpathSync(p); } catch { return false; } };
export function referenceFile(url, cfg) {
  const base = str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/';
  if (!url.startsWith(base)) throw new Error('Place both reference images in this dashboard’s assets folder before uploading to Higgsfield.');
  const name = url.slice(base.length);
  if (!/^[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i.test(name)) throw new Error('Reference filename must be a simple JPG, PNG or WebP filename.');
  const dir = realpath(assetDir(cfg)), path = dir === false ? false : realpath(dir + '/' + name);
  if (dir === false) throw new Error('Reference assets folder cannot be resolved.');
  if (!path || !statSync(path).isFile()) throw new Error('Reference file not found: ' + name);
  if (dirname(path) !== dir) throw new Error('Reference file is outside the assets folder: ' + name);
  let bytes;
  try { if (statSync(path).size > 20000000) throw new Error('Reference file exceeds 20 MB: ' + name); bytes = readFileSync(path); }
  catch (e) { if (e.message.startsWith('Reference file exceeds')) throw e; throw new Error('Reference file is not readable: ' + name); }
  const size = probeImage(bytes);
  const mime = size ? 'image/' + size.type : '';
  if (!size || size.width * size.height > 16000000 || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Reference image is invalid or too large to decode.');
  return { bytes, mime };
}

/** uploadReference(): a signed upload of one asset to Higgsfield storage; its public URL. The key never goes to storage. */
export async function uploadReference(url, cfg, transport = uploadHttp) {
  const file = referenceFile(url, cfg);
  const key = str(cfg.higgsfield_key ?? '');
  if (!key) throw new Error('Configure your Higgsfield API key first.');
  const raw = (await transport('POST', 'https://api.higgsfield.ai/files/generate-upload-url', ['Authorization: Key ' + key, 'Content-Type: application/json'], Buffer.from(jsonEncode({ content_type: file.mime })))).toString();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Syntax error'); }
  const isMap = (x) => x !== null && typeof x === 'object';
  if (!isMap(data) || Array.isArray(data) || data.upload_url == null || data.public_url == null || data.upload_headers == null || !isMap(data.upload_headers)) throw new Error('Higgsfield returned an incomplete upload response. No video was submitted.');
  for (const field of ['upload_url', 'public_url']) {
    const u = typeof data[field] === 'string' ? parseUrl(data[field]) : false;
    if (!u || u.scheme !== 'https' || !u.host || u.user !== undefined || u.pass !== undefined) throw new Error('Invalid Higgsfield storage response.');
  }
  const headers = [];
  for (const [name, value] of Object.entries(data.upload_headers)) {
    if (Array.isArray(data.upload_headers) || typeof value !== 'string' || /[\r\n]/.test(name + value) || ['authorization', 'cookie', 'proxy-authorization'].includes(lower(name))) throw new Error('Unsafe upload headers in Higgsfield response.');
    headers.push(name + ': ' + value);
  }
  // Only returned storage headers are sent. The API key never goes to storage.
  await transport('PUT', data.upload_url, headers, file.bytes);
  return data.public_url;
}

/** jobError(): a provider error for display, links removed, at most 2000 bytes. */
export function jobError(error) {
  if (error === null || error === undefined) return '';
  if (typeof error !== 'string') error = jsonEncode(error);
  const s = Buffer.from(str(error).replace(/https?:\/\/[^\s"<>]+/g, '[URL omitted]'));
  return s.length <= 2000 ? s.toString() : s.subarray(0, 2000).toString();
}

// ---- Vehicle detail page ----

const toPhotoSize = (url) => url.replace(/^(https:\/\/imagescf\.dealercenter\.net)\/[0-9]+\/[0-9]+\//, '$1/640/480/');
const isCdn = (url) => parseUrl(url)?.host === 'imagescf.dealercenter.net' && url.startsWith('https://');
const inMedia = (el) => { for (let p = el.parent; p; p = p.parent) if (p.has?.('id') && p.attr('id').startsWith('DWS_VDP_Media_')) return true; return false; };

/** galleryPhotos(): the vehicle's own gallery photos (640×480), else its og:image. */
export function galleryPhotos(html) {
  const doc = parseHtml(html); const photos = [];
  for (const n of doc.descendants()) if ((n.has('data-pin-media') || n.has('data-base-img-url')) && inMedia(n)) {
    const url = truthy(n.attr('data-pin-media')) ? n.attr('data-pin-media') : n.attr('data-base-img-url');
    if (isCdn(url)) photos.push(toPhotoSize(url));
  }
  if (!photos.length) for (const n of doc.descendants()) if (n.tag === 'meta' && n.attr('property') === 'og:image') {
    const url = n.attr('content'); if (isCdn(url)) photos.push(toPhotoSize(url));
  }
  return [...new Set(photos)];
}

/** enrich(): price, description and photos from the car's own page (website cars); imported cars as they are. */
export async function enrich(v, get = requestText) {
  if (['zip', 'dcs'].includes(v.source ?? '')) return v;
  const html = await get(v.url); const doc = parseHtml(html); const detail = [];
  v = { ...v };
  // Price only from this vehicle's metadata and its own price widget: never related cars or loan calculators.
  for (const n of doc.descendants()) if (n.tag === 'meta' && (n.attr('name') === 'description' || n.attr('property') === 'og:description' || n.attr('property') === 'product:price:amount')) {
    const s = n.attr('content');
    if (n.attr('property') === 'product:price:amount' && isNumeric(s)) detail.push({ VehiclePrice: toFloat(s) });
    const m = s.match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (m) detail.push({ VehiclePrice: toFloat(m[1].replaceAll(',', '')) });
  }
  for (const n of doc.descendants()) if (hasClassToken(n, 'dws-vdp-seller-notes-container')) v.description = trim(n.textContent.replace(new RegExp(U_SPACE + '+', 'gu'), ' '));
  v.photos = galleryPhotos(html);
  v.price = highestPrice(v, detail);
  v.detail_checked_at = gmdateC();
  return v;
}

// ---- Generate, poll, list, delete ----

export const FORMATS = { instagram_reels: '9:16', facebook_reels: '9:16', facebook_feed: '3:4', square: '1:1' };

/** The duplicate-request fingerprint: the exact prompt is part of it, so a prompt improvement is a new request. */
export const RESOLUTIONS = ['720p', '1080p'];

export function jobFingerprint(v, spoken, sheet, avatar, description, format, style, duration, voice, promptText, voiceRef, resolution = '720p') {
  // 720p requests keep their original fingerprint; 1080p is a different paid request.
  return sha256(jsonEncode([v.Vin ?? null, v.price ?? null, spoken, sheet, avatar, description, format, style, duration, voice, sha256(promptText), voiceRef, ...(resolution === '720p' ? [] : [resolution])]));
}

/**
 * The paid Seedance generation (dashboard "Generate"). opts: { transport (Higgsfield POST/PUT), getText (website
 * reader), random } — replaceable in tests so nothing is ever sent.
 */
export async function generateJob(db, cfg, client, inp, opts = {}) {
  const { transport = uploadHttp, getText = requestText, random = randomBytes } = opts;
  if (!truthy(cfg.higgsfield_key)) throw new Error('Add your Higgsfield API key to private/config.json first.');
  if (!truthy(inp.approve_spend ?? false)) throw new Error('Confirm this paid generation.');
  const a = state(db, clientInventoryKey(client)) ?? {};
  let v = null;
  for (const candidate of a.vehicles ?? []) if (candidate.StockNumber === (inp.stock ?? '')) v = candidate;
  if (!v) throw new Error('Select a current vehicle first.');
  if ((v.active ?? true) === false) throw new Error('This vehicle is no longer in DealerCenter active inventory. Generation stopped.');
  // Imported cars (ZIP, client website import): availability and price are confirmed by the user, not re-read live.
  let fresh;
  if (['zip', 'dcs'].includes(v.source ?? '')) {
    if (!truthy(inp.confirm_current ?? false)) throw new Error('Confirm that imported availability and highest advertised price are still current.');
    fresh = v;
  } else {
    fresh = null;
    for (const candidate of await goldenInventory(str(cfg.source), getText)) if (candidate.Vin === v.Vin) fresh = candidate;
    if (!fresh) throw new Error('Vehicle is no longer listed. Generation stopped.');
    fresh = await enrich(fresh, getText);
  }
  if ((fresh.price ?? null) !== (v.price ?? null)) throw new Error('Vehicle price changed. Reload its details and review the script.');
  let spoken = trim(str(inp.script ?? ''));
  // voice=elevenlabs: native walkaround driven by an approved ElevenLabs narration (sent as the audio reference).
  const voice = str(inp.voice ?? 'elevenlabs');
  if (!['elevenlabs', 'native', 'narration'].includes(voice)) throw new Error('Choose how the voice is made.');
  let approvedVoice = null;
  if (voice === 'elevenlabs') {
    narrationTables(db);
    approvedVoice = narrationLoad(db, 'narrations', str(inp.narration_id ?? ''));
    if ((approvedVoice.status ?? '') !== 'ready' || !truthy(approvedVoice.approved)) throw new Error('Choose an approved voice preview for this car (Narration panel: create, listen, approve).');
    if ((approvedVoice.stock ?? '') !== v.StockNumber || !priceMatches(approvedVoice.price ?? null, v.price ?? null)) throw new Error('The approved voice preview is for a different car or an old price. Make a new preview.');
    narrationCheckAudio(cfg, approvedVoice);
    spoken = str(approvedVoice.caption_script);
  }
  const duration = toInt(inp.duration ?? 15);
  if (![15, 30].includes(duration)) throw new Error('Choose 15 or 30 seconds.');
  // 1080p costs about 40% more (Higgsfield: 9 credits per second vs 6.5) but draws small lettering more clearly.
  const resolution = str(inp.resolution ?? '720p') || '720p';
  if (!RESOLUTIONS.includes(resolution)) throw new Error('Choose 720p or 1080p.');
  const style = str(inp.style ?? 'dynamic');
  if (!['dynamic', 'showroom'].includes(style)) throw new Error('Choose a video style.');
  if (style === 'dynamic' && duration !== 15) throw new Error('The dynamic shot sequence is fixed at 15 seconds. Choose showroom for 30 seconds.');
  if (voice === 'elevenlabs' && toInt(approvedVoice.duration ?? 0) !== duration) throw new Error('The approved voice preview was made for a ' + str(approvedVoice.duration ?? '?') + '-second video. Choose that duration.');
  if (voice !== 'narration' && style !== 'showroom') throw new Error('Spoken-in-video uses the showroom style. Choose showroom, or ElevenLabs narration for the dynamic sequence.');
  if (voice !== 'narration' && spoken === '') throw new Error('Write the script the spokesperson will say.');
  let sheetUrl = trim(str(inp.sheet ?? ''));
  let savedSheet = state(db, 'sheet:' + (v.Vin ?? ''));
  if (savedSheet && (!truthy(sheetUrl) || sheetUrl === savedSheet.url)) {
    if (savedSheet.gallery_hash !== sha256(jsonEncode(fresh.photos ?? null))) throw new Error('Vehicle photos changed. Reopen the vehicle to rebuild its asset sheet.');
    // A sheet saved with text (car name, stock number, labels) is rebuilt from the same photos before anything is sent.
    if (!sheetUpToDate(savedSheet)) { savedSheet = await (opts.sheetRebuild ?? sheetRebuild)(fresh, cfg, savedSheet); save(db, 'sheet:' + (v.Vin ?? ''), savedSheet); }
    sheetUrl = savedSheet.url;
  }
  const presenter = spokespersonFind(db, cfg, str(inp.spokesperson ?? ''));
  // The sheet sent to the video model shows the car cut out of the lot photos (see cutoutSheet); a custom sheet URL is
  // sent as given. Prepared before anything paid is sent; a failure stops here.
  let referenceSheet = 'original';
  if (savedSheet && sheetUrl === savedSheet.url) {
    const cut = await (opts.cutoutSheet ?? cutoutSheet)(fresh, cfg, db, savedSheet);
    if (cut) { sheetUrl = cut.url; referenceSheet = 'cutout'; }
  }
  const sheet = referenceImageUrl(str(sheetUrl), cfg), avatar = referenceImageUrl(presenter.url, cfg);
  const format = str(inp.format ?? '');
  if (!Object.hasOwn(FORMATS, format)) throw new Error('Choose a video format.');
  const native = voice !== 'narration';
  // Audio reference: the approved narration (elevenlabs), or the optional config voice sample (native).
  let voiceRef;
  if (voice === 'elevenlabs') voiceRef = validateAppBase(cfg) + '/assets/narrations/' + approvedVoice.audio_name;
  else {
    voiceRef = voice === 'native' ? trim(str(cfg.voice_reference_url ?? '')) : '';
    if (voiceRef !== '' && !/^https:\/\/[^\t\n\v\f\r ?#]+\.(mp3|wav|m4a)\n?$/i.test(voiceRef)) throw new Error('voice_reference_url in private/config.json must be a public https link to an MP3, WAV or M4A file.');
  }
  const respell = cfg.respell && typeof cfg.respell === 'object' && !Array.isArray(cfg.respell) ? cfg.respell : {};
  // Background setting from the scene library (none chosen: the library's default; the showroom words are unchanged).
  const scene = sceneFind(db, inp.scene);
  const promptText = voice === 'elevenlabs'
    ? promptNative(fresh, str(approvedVoice.text), duration, presenter.description, 'speech', approvedVoice.audio_duration != null ? toFloat(approvedVoice.audio_duration) : null, respell, scene.description)
    : voice === 'native' ? promptNative(fresh, nativeSpeech(spoken), duration, presenter.description, voiceRef !== '', null, respell, scene.description)
      : prompt(fresh, spoken, style, duration, presenter.description, scene.description);
  const fingerprint = jobFingerprint(v, spoken, sheet, avatar, presenter.description, format, style, duration, voice, promptText, voiceRef, resolution);
  const id = random(12).toString('hex');
  const job = { id, client, stock: v.StockNumber, vehicle: title(v), spokesperson_id: presenter.id, spokesperson: presenter.name, scene_id: scene.id, scene: scene.name, reference_sheet: referenceSheet, format, style, duration, resolution,
    status: 'preparing_references', created_at: gmdateC(), approved_by: str(inp.approved_by ?? ''), script: spoken, speech_script: voice === 'native' ? nativeSpeech(spoken) : speechScript(spoken), price: v.price ?? null, voice };
  // Native voice: one approval builds the final video (captions timed from the video's own audio).
  if (voice !== 'narration') job.auto_build = true;
  if (voice === 'elevenlabs') { job.narration_id = approvedVoice.id; job.speech_script = str(approvedVoice.text); }
  const update = (fp) => db.prepare(fp ? 'UPDATE jobs SET fingerprint=NULL,payload=? WHERE id=?' : 'UPDATE jobs SET payload=? WHERE id=?').run(jsonEncode(job), id);
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT id,payload FROM jobs WHERE fingerprint=?').get(fingerprint);
    if (previous) {
      const prior = JSON.parse(previous.payload);
      if (!['failed', 'canceled'].includes(prior.status ?? '')) throw new Error('This exact request already exists. Check its status before generating again.');
      db.prepare('UPDATE jobs SET fingerprint=NULL WHERE id=?').run(previous.id);
    }
    db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(id, fingerprint, jsonEncode(job));
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ } throw e; }

  let hostedSheet, hostedAvatar;
  try { hostedSheet = await uploadReference(sheet, cfg, transport); hostedAvatar = await uploadReference(avatar, cfg, transport); }
  catch (e) { job.status = 'reference_upload_failed'; job.error = jobError(e.message); update(true); throw new Error(job.error); }
  job.status = 'submitting'; update(false);
  const payload = { prompt: promptText, image_urls: [hostedSheet, hostedAvatar], duration, resolution, aspect_ratio: FORMATS[format], output_format: 'mp4', generate_audio: native };
  if (voiceRef !== '') payload.audio_urls = [voiceRef];
  try {
    const r = JSON.parse(await higgsfieldRequest('https://api.higgsfield.ai/bytedance/seedance-2.5/reference-to-video', payload, str(cfg.higgsfield_key), transport));
    if (!truthy(r?.request_id)) throw new Error('Missing request ID.');
    job.request_id = r.request_id; job.status = r.status ?? 'queued'; job.error = jobError(r.error ?? r.detail ?? null);
  } catch {
    job.status = 'submission_uncertain'; update(false);
    throw new Error('Submission could not be confirmed. Check Higgsfield history; do not retry automatically.');
  }
  update(false);
  return job;
}

/** Status of a generation (free Higgsfield status read); finished or canceled jobs are not asked again. */
export async function pollJob(db, cfg, id, get = higgsfieldRequest) {
  const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);
  if (!row) throw new Error('Job not found.');
  const job = JSON.parse(row.payload);
  if (!truthy(job.request_id)) throw new Error('Submission uncertain. Check Higgsfield request history before retrying.');
  if (!['completed', 'canceled'].includes(job.status)) {
    let result;
    try { result = JSON.parse(await get('https://api.higgsfield.ai/requests/' + rawurlencode(str(job.request_id)) + '/status', null, str(cfg.higgsfield_key ?? ''))); }
    catch (e) { if (e instanceof SyntaxError) throw new Error('Syntax error'); throw e; }
    job.status = result?.status ?? 'unknown'; job.video_url = result?.video?.url ?? null; job.error = jobError(result?.error ?? result?.detail ?? null);
    db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(jsonEncode(job), job.id);
  }
  return job;
}

/** The client's 30 newest jobs among the last 200, as the stored JSON strings (the dashboard parses each). */
export function jobsForClient(db, client) {
  // The dashboard shows the selected vehicle's videos only, so older cars' videos must be in the list too.
  const out = [];
  for (const { payload } of db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC').all()) {
    let c; try { c = JSON.parse(payload)?.client; } catch { c = undefined; }
    if ((c ?? CLIENT_DEFAULT) === client) out.push(payload);
    if (out.length >= 200) break;
  }
  return out;
}

export const JOB_RUNNING = ['preparing_references', 'submitting', 'queued', 'in_progress'];

/** Deleting a video job: the record and its finished captioned file (or uploaded footage). Running jobs are protected. */
export function goldenJobDelete(db, cfg, id, allowed = null) {
  const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);
  if (!row) throw new Error('Video not found. Refresh the list.');
  const job = JSON.parse(row.payload);
  // The Library lists every client the account may use: a video of any other client is refused.
  if (allowed && !allowed.includes(job.client ?? CLIENT_DEFAULT)) throw new Error('Your account has no access to that video.');
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_posts'").get()) {
    const pending = db.prepare("SELECT payload FROM social_posts WHERE json_extract(payload,'$.job_id')=?").all(id).map((r) => JSON.parse(r.payload))
      .some((p) => Object.values(p.platforms ?? {}).some((x) => ['scheduled', 'uploading', 'processing', 'publishing'].includes(x.status)));
    if (pending) throw new Error('This video has a Facebook or Instagram post scheduled or in progress. Cancel it (Library → Post) or let it finish first.');
  }
  if (JOB_RUNNING.includes(job.status ?? '')) throw new Error('This video is still being generated. Wait until it completes or fails before deleting, so a paid generation is not lost.');
  if ((job.finish_status ?? '') === 'rendering') throw new Error('This video is being captioned right now. Try again in a minute.');
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='narration_lipsync'").get()) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM narration_lipsync WHERE json_extract(payload,'$.source_video_id')=? AND json_extract(payload,'$.status') IN ('submitting','queued','in_progress')").get(id).n;
    if (n > 0) throw new Error('A lip-sync job is still using this video. Wait for it to finish first.');
  }
  db.prepare('DELETE FROM jobs WHERE id=?').run(id);
  const base = str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/', url = str(job.captioned_url ?? '');
  if (base !== '/assets/' && url.startsWith(base)) {
    const name = url.slice(base.length);
    if (/^[a-f0-9]{40}\.mp4$/.test(name)) { const path = assetDir(cfg) + '/' + name; if (existsSync(path)) unlinkSync(path); }
  }
  // Uploaded footage belongs to this job only.
  if ((job.provider ?? '') === 'footage' && /^[a-f0-9]{32}\.(mp4|mov)$/.test(str(job.footage_file ?? ''))) {
    const path = assetDir(cfg) + '/footage/' + job.footage_file; if (existsSync(path)) unlinkSync(path);
  }
  if ((job.provider ?? '') === 'footage') return { message: 'Video and its uploaded footage deleted.' };
  return { message: 'Video deleted from the dashboard. The original generation stays in your Higgsfield history.' };
}

// ---- "My footage" ----

export const FOOTAGE_MAX_BYTES = 64 * 1024 * 1024;
export const FOOTAGE_FORMATS = ['instagram_reels', 'facebook_reels', 'facebook_feed', 'square'];

/** ffprobe facts for an uploaded video: { duration, width, height, format }. */
export function footageProbe(cfg, path) {
  const ffprobe = str(cfg.ffprobe_path ?? dirname(str(cfg.ffmpeg_path ?? '/usr/bin/ffmpeg')) + '/ffprobe');
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24, timeout: 60000 });
  if (r.error) throw new Error('Cannot inspect the uploaded video.');
  let d = null; try { d = JSON.parse(r.stdout.toString()); } catch { /* not a video */ }
  let video = null;
  for (const s of d?.streams ?? []) if ((s.codec_type ?? '') === 'video' && video === null) video = s;
  if (!video) throw new Error('The file is not a video we can read. Upload an MP4 or MOV from your phone or camera.');
  return { duration: toFloat(d.format?.duration ?? video.duration ?? 0), width: toInt(video.width ?? 0), height: toInt(video.height ?? 0), format: str(d.format?.format_name ?? '') };
}

const pathExt = (name) => { const base = name.split('/').pop(); const i = base.lastIndexOf('.'); return i < 0 ? '' : base.slice(i + 1); };
const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

/** A finished-video job from uploaded footage and an approved voice preview of the same car, price and length. */
export function goldenFootageBuild(db, cfg, inp, file, { probe = (p) => footageProbe(cfg, p), move = (from, to) => { copyFileSync(from, to); unlinkSync(from); return true; }, random = randomBytes } = {}) {
  if (!truthy(inp.confirm_current ?? false)) throw new Error('Confirm the vehicle is available and its advertised price is current.');
  const client = str(inp.client ?? CLIENT_DEFAULT); const a = clientInventory(db, client); let v = null;
  for (const candidate of a.vehicles ?? []) if (candidate.StockNumber === (inp.stock ?? '')) v = candidate;
  if (!v) throw new Error('Select a current vehicle first.');
  if ((v.active ?? true) === false) throw new Error('This vehicle is no longer in active inventory.');
  const format = str(inp.format ?? '');
  if (!FOOTAGE_FORMATS.includes(format)) throw new Error('Choose a publish format.');
  narrationTables(db);
  const voice = narrationLoad(db, 'narrations', str(inp.narration_id ?? ''));
  if ((voice.status ?? '') !== 'ready' || !truthy(voice.approved)) throw new Error('Choose an approved voice preview for this car (step 3).');
  if ((voice.stock ?? '') !== v.StockNumber || !priceMatches(voice.price ?? null, v.price ?? null)) throw new Error('The approved voice preview is for a different car or an old price. Make a new preview.');
  narrationCheckAudio(cfg, voice);
  const duration = toInt(voice.duration), speech = toFloat(voice.audio_duration ?? duration);

  if (!file || (file.error ?? 4) !== 0) throw new Error('Upload failed. Videos must be 64 MB or smaller; export or film at 1080p.');
  if ((file.size ?? 0) > FOOTAGE_MAX_BYTES) throw new Error('Video is larger than 64 MB. Export or film at 1080p, 30 seconds or so.');
  const ext = lower(pathExt(str(file.name ?? '')));
  if (!['mp4', 'mov', 'm4v'].includes(ext)) throw new Error('Upload an MP4 or MOV video.');
  const facts = probe(str(file.tmp_name));
  if (!facts.format.includes('mov') && !facts.format.includes('mp4')) throw new Error('Upload an MP4 or MOV video.');
  if (facts.width < 480 || facts.height < 480) throw new Error('Video is too small; film at 1080p.');
  const need = speech + NARRATION_OFFSET + 0.5;
  if (facts.duration < need) throw new Error(`The footage is ${fmt1(facts.duration)} s but the approved voice needs at least ${fmt1(need)} s. Film a longer walkaround.`);
  if (facts.duration > 300) throw new Error('Footage is longer than 5 minutes. Trim it to under a minute first.');

  const dir = assetDir(cfg) + '/footage';
  try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { throw new Error('Cannot create the footage folder.'); }
  const name = random(16).toString('hex') + '.' + (ext === 'm4v' ? 'mp4' : ext);
  let moved = false; try { moved = move(str(file.tmp_name), dir + '/' + name); } catch { moved = false; }
  if (!moved) throw new Error('Cannot save the uploaded video.');
  chmodSync(dir + '/' + name, 0o644);

  const id = random(12).toString('hex');
  const job = { id, client, stock: v.StockNumber, vehicle: title(v), spokesperson: '', format, style: 'footage',
    duration: Math.trunc(Math.min(duration, Math.floor(facts.duration))), status: 'completed', provider: 'footage', created_at: gmdateC(), approved_by: str(inp.approved_by ?? ''),
    script: str(voice.caption_script), speech_script: str(voice.text), price: v.price ?? null, voice: 'elevenlabs',
    narration_id: voice.id, audio_swap: true, captions_from_audio: true, footage_file: name,
    video_url: str(cfg.public_base_url).replace(/\/+$/, '') + '/assets/footage/' + name,
    finish_status: 'queued', render_backend: 'linux', finish_error: '', captioned_url: null, auto_queued_at: gmdateC() };
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(id, null, jsonEncode(job));
  return job;
}

/** Local path of a footage job's uploaded video (the caption worker copies it instead of downloading). */
export function footageLocalPath(cfg, job) {
  const name = str(job.footage_file ?? '');
  if (!/^[a-f0-9]{32}\.(mp4|mov)$/.test(name)) throw new Error('Footage file is missing from this job.');
  const path = assetDir(cfg) + '/footage/' + name;
  if (!existsSync(path)) throw new Error('The uploaded footage was deleted. Upload it again.');
  return path;
}

/** Finished, captioned videos of the given clients, newest first (the Library page). */
export function libraryVideos(db, clientIds) {
  const out = [];
  for (const { payload } of db.prepare('SELECT payload FROM jobs').all()) {
    let j; try { j = JSON.parse(payload); } catch { continue; }
    const client = j.client ?? CLIENT_DEFAULT;
    if (!clientIds.includes(client) || j.finish_status !== 'completed' || !String(j.captioned_url ?? '').startsWith('https://')) continue;
    out.push({ id: j.id, client, vehicle: str(j.vehicle), stock: str(j.stock), price: j.price ?? null, duration: j.duration ?? null, format: str(j.format),
      url: j.captioned_url, created_at: j.finish_completed_at ?? j.created_at ?? '', approved_by: str(j.approved_by ?? ''), speech_check: j.speech_check ?? null });
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
