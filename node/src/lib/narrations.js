// Voice previews (ElevenLabs) and lip-sync (fal) for the dashboard's Voice step.
// Paid-call rules: each needs its approval checkbox, every request is reserved first under a unique
// fingerprint (a repeat is refused instead of paid twice), a provider rejection releases it, an unclear outcome is
// kept as "submission_uncertain". HTTP, audio length and padding go through a Python helper
// (private/narration_bridge.py: no redirects, allowed hosts only, error details stripped of keys and URLs).
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lower, trim, strlen, levenshtein, toFloat, toInt, gmdateC, parseUrl, str } from './text.js';
import { speechScript, SEEDANCE_RESPELL } from './speech.js';
import { captionWordsMatch } from './captions.js';
import { CLIENT_DEFAULT, clientInventory } from './clients.js';
import { title } from './price.js';
import { jsonEncode } from './storedjson.js';
import { validateAppBase, publicImage } from './media.js';
import { rawurlencode } from './website.js';

const BRIDGE = fileURLToPath(new URL('../../../private/narration_bridge.py', import.meta.url));

/** narrationBridge(): the Python helper (secrets on stdin only), run without blocking the service. */
export function narrationBridge(input) {
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/python3', [BRIDGE], { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = []; let size = 0;
    const timer = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.stdout.on('data', (d) => { size += d.length; if (size < (1 << 28)) out.push(d); });
    p.on('error', () => { clearTimeout(timer); reject(new Error('Narration helper failed.')); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Narration helper failed.'));
      let r; try { r = JSON.parse(Buffer.concat(out).toString()); } catch { return reject(new Error('Narration helper failed.')); }
      if (r.error !== undefined) return reject(new Error(String(r.error)));
      resolve(r);
    });
    p.stdin.end(jsonEncode(input));
  });
}
/** narrationHttp(): { status, body: Buffer, detail? } through the helper. */
export async function narrationHttp(bridge, url, method, headers, body = null) {
  const r = await bridge({ op: 'http', url, method, headers, body: Buffer.from(body === null ? '' : jsonEncode(body)).toString('base64') });
  const raw = String(r.body ?? '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('Invalid API response encoding.');
  return { ...r, body: Buffer.from(raw, 'base64') };
}

export function narrationTables(db) {
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS narrations (id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS narration_lipsync (id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE,payload TEXT NOT NULL)');
}

/** str_ireplace(): every occurrence, ASCII case-insensitive, left to right. */
function strIreplace(search, replace, subject) {
  if (search === '') return subject;
  const ls = lower(search);
  let out = '', i = 0, low = lower(subject);
  for (;;) { const j = low.indexOf(ls, i); if (j === -1) break; out += subject.slice(i, j) + replace; i = j + search.length; }
  return out + subject.slice(i);
}
/** Words as spoken, for comparing caption and spoken text: numbers, prices and the website as words, letters joined. */
export function narrationWords(s) {
  s = lower(speechScript(s)).replaceAll('-', ' ').replaceAll('–', ' ');
  const tokens = trim(s.replace(/[^a-z0-9\t\n\v\f\r ]/g, ' ')).split(/[\t\n\v\f\r ]+/).filter((t) => t !== '');
  const out = []; let letters = '';
  for (const t of tokens) { if (t.length === 1 && /[a-z]/.test(t)) { letters += t; continue; } if (letters) { out.push(letters); letters = ''; } out.push(t); }
  if (letters) out.push(letters);
  return out;
}
/** Word differences between a preview's caption text and spoken text (numbers, prices, website, respellings ignored). */
export function narrationTextDifferences(spoken, caption, respell = {}) {
  for (const [word, say] of Object.entries({ ...SEEDANCE_RESPELL, ...(respell && typeof respell === 'object' && !Array.isArray(respell) ? respell : {}) }))
    if (typeof say === 'string' && say !== '') spoken = strIreplace(say, word, spoken);
  const c = narrationWords(caption), s = narrationWords(spoken), n = c.length, m = s.length;
  const pair = (i, j) => {
    if (j < 2 || s[j - 2].length > 4 || s[j - 1].length > 5) return false;
    const x = s[j - 2] + s[j - 1], y = c[i - 1];
    return x[0] === y[0] && Math.abs(x.length - y.length) <= 3 && levenshtein(x, y) <= Math.floor(Math.max(x.length, y.length) * 0.5);
  };
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)), from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) { dp[i][0] = i; from[i][0] = 1; }
  for (let j = 1; j <= m; j++) { dp[0][j] = j; from[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let best = dp[i - 1][j] + 1, f = 1;
    if (dp[i][j - 1] + 1 < best) { best = dp[i][j - 1] + 1; f = 2; }
    if (captionWordsMatch(c[i - 1], s[j - 1]) && dp[i - 1][j - 1] <= best) { best = dp[i - 1][j - 1]; f = 3; }
    if (pair(i, j) && dp[i - 1][j - 2] < best) { best = dp[i - 1][j - 2]; f = 4; }
    dp[i][j] = best; from[i][j] = f;
  }
  const diffs = []; let cr = [], sr = [], i = n, j = m;
  const close = () => {
    if (!cr.length && !sr.length) return;
    const a = cr.reverse().join(' '), b = sr.reverse().join(' ');
    diffs.push(a !== '' && b !== '' ? `"${a}" (captions) vs "${b}" (spoken)` : a !== '' ? `"${a}" only in captions` : `"${b}" only in spoken text`);
    cr = []; sr = [];
  };
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (f === 3) { close(); i--; j--; } else if (f === 4) { close(); i--; j -= 2; } else if (f === 1) { cr.push(c[i - 1]); i--; } else { sr.push(s[j - 1]); j--; }
  }
  close();
  return diffs.reverse();
}
export const narrationMismatchNote = (diffs) => (diffs.length ? ' Caption text and spoken text differ: ' + diffs.slice(0, 5).join('; ') + '. Captions show the caption text, so fix one of them if they should match.' : '');
/** ElevenLabs voice settings: 30-second previews a little slower (config narration_speed, default 0.9). */
export function narrationVoiceSettings(cfg, duration) {
  const settings = { stability: 0.65, similarity_boost: 0.75 };
  const speed = duration === 30 ? Math.max(0.7, Math.min(1.2, toFloat(cfg.narration_speed ?? 0.9))) : 1.0;
  if (Math.abs(speed - 1.0) > 0.001) settings.speed = speed;
  return settings;
}

const TABLES = ['narrations', 'narration_lipsync'];
export function narrationLoad(db, table, id) {
  if (![...TABLES, 'jobs'].includes(table)) throw new Error('Invalid table.');
  const row = db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id);
  if (!row) throw new Error('Saved record not found.');
  return JSON.parse(row.payload);
}
export function narrationSave(db, table, record, release = false) {
  if (!TABLES.includes(table)) throw new Error('Invalid table.');
  db.prepare(`UPDATE ${table} SET payload=?${release ? ',fingerprint=NULL' : ''} WHERE id=?`).run(jsonEncode(record), record.id);
}
export function narrationReserve(db, table, record, fingerprint) {
  if (!TABLES.includes(table)) throw new Error('Invalid table.');
  try { db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(record.id, fingerprint, jsonEncode(record)); }
  catch (e) { if (String(e.message).includes('UNIQUE')) throw new Error('This request already exists. Refresh saved previews or lip-sync jobs; do not resubmit an uncertain request.'); throw e; }
}
export const narrationRejected = (code) => [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(code);
export function narrationKey(cfg, name) {
  const key = trim(str(cfg[name] ?? ''));
  if (!key) throw new Error('Add ' + name + ' to private/config.json first.');
  return key;
}
export function narrationAudioPath(cfg, record) {
  const name = str(record.audio_name ?? '');
  if (!/^[a-f0-9]{32}\.mp3$/.test(name)) throw new Error('Invalid narration file.');
  return String(cfg.asset_dir) + '/narrations/' + name;
}
export function narrationCheckAudio(cfg, record) {
  const path = narrationAudioPath(cfg, record);
  if (!existsSync(path) || str(record.audio_hash ?? '') !== createHash('sha256').update(readFileSync(path)).digest('hex'))
    throw new Error('The approved audio is missing or changed. Make and review a new preview.');
  return path;
}
export function narrationSafeQueueUrl(url) {
  const u = parseUrl(url) || {};
  const path = String(url).replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, '').split(/[?#]/)[0];
  if (u.scheme !== 'https' || u.host !== 'queue.fal.run' || u.port !== undefined || u.user !== undefined || u.pass !== undefined || !path.startsWith('/fal-ai/sync-lipsync/'))
    throw new Error('Unexpected lip-sync tracking URL.');
  return url;
}
const jsonBody = (buf) => { try { return JSON.parse(buf.toString('utf8')); } catch { throw new Error('Syntax error'); } };
const clientOf = (inp) => inp.client ?? CLIENT_DEFAULT;

/**
 * narrationApi(): the narration_* dashboard actions. opts.bridge replaces the Python helper in tests; opts.random
 * replaces randomBytes (ids) in tests.
 */
export async function narrationApi(action, inp, cfg, db, { bridge: helper = narrationBridge, random = randomBytes } = {}) {
  // A helper answer with { error } is a user-facing message (also for the fake helper in tests).
  const bridge = async (x) => { const r = await helper(x); if (r && r.error !== undefined) throw new Error(String(r.error)); return r; };
  narrationTables(db);
  const respell = cfg.respell && typeof cfg.respell === 'object' ? cfg.respell : {};
  if (action === 'narration_voices') {
    const key = narrationKey(cfg, 'elevenlabs_key'); const voices = []; let next = null;
    for (let page = 0; page < 5; page++) {
      const r = await narrationHttp(bridge, 'https://api.elevenlabs.io/v2/voices?page_size=100' + (next ? '&next_page_token=' + rawurlencode(next) : ''), 'GET', { 'xi-api-key': key });
      if (r.status !== 200) throw new Error('Voice listing failed (HTTP ' + r.status + '). Check API-key voice-read permission.');
      const data = jsonBody(r.body);
      for (const v of data.voices ?? []) voices.push({ id: v.voice_id, name: v.name, labels: v.labels ?? [] });
      if (!data.has_more || !data.next_page_token) break;
      next = data.next_page_token;
    }
    return { voices };
  }
  if (action === 'narration_list') {
    const list = [];
    for (const { payload } of db.prepare('SELECT payload FROM narrations ORDER BY rowid DESC LIMIT 50').all()) {
      const v = JSON.parse(payload); if ((v.client ?? CLIENT_DEFAULT) !== clientOf(inp)) continue;
      v.audio_url = v.audio_name !== undefined && v.audio_name !== null ? validateAppBase(cfg) + '/assets/narrations/' + v.audio_name : null;
      v.text_mismatch = narrationTextDifferences(str(v.text ?? ''), str(v.caption_script ?? ''), respell); list.push(v);
    }
    const sync = [];
    for (const { payload } of db.prepare('SELECT payload FROM narration_lipsync ORDER BY rowid DESC LIMIT 30').all()) {
      const v = JSON.parse(payload); if ((v.client ?? CLIENT_DEFAULT) !== clientOf(inp)) continue;
      delete v.status_url; delete v.response_url; delete v.audio_file;
      // Progress of the final captioned video built from this lip-sync (same id in jobs).
      if ((v.status ?? '') === 'completed') {
        const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(v.id);
        if (row) { const j = JSON.parse(row.payload); v.final = { status: j.finish_status ?? 'waiting', error: j.finish_error ?? '', url: j.captioned_url ?? null }; }
      }
      sync.push(v);
    }
    const videos = [];
    for (const { payload } of db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 50').all()) {
      const v = JSON.parse(payload); if ((v.client ?? CLIENT_DEFAULT) !== clientOf(inp)) continue;
      if ((v.status ?? '') === 'completed' && v.video_url) videos.push({ id: v.id, vehicle: v.vehicle, stock: v.stock, duration: v.duration ?? 15 });
    }
    return { previews: list, lipsync: sync, videos };
  }
  if (action === 'narration_preview') {
    if (!inp.approve_spend) throw new Error('Approve one paid ElevenLabs voice preview.');
    const key = narrationKey(cfg, 'elevenlabs_key');
    const voice = trim(str(inp.voice_id ?? ''));
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(voice)) throw new Error('Select a voice.');
    const text = trim(str(inp.text ?? '')), captions = trim(str(inp.caption_script ?? ''));
    if (strlen(text) < 10 || strlen(text) > 1200 || strlen(captions) < 10 || strlen(captions) > 1200) throw new Error('Enter narration and correctly spelled caption text, up to 1,200 characters each.');
    let v = null;
    for (const c of clientInventory(db, clientOf(inp)).vehicles ?? []) if (c.StockNumber === (inp.stock ?? '')) v = c;
    if (!v || (v.active ?? true) === false) throw new Error('Select a saved vehicle that is still in active inventory.');
    const duration = toInt(inp.duration ?? 15);
    if (![15, 30].includes(duration)) throw new Error('Choose 15 or 30 seconds.');
    const settings = narrationVoiceSettings(cfg, duration);
    let fingerprint = createHash('sha256').update(jsonEncode([v.StockNumber, v.price, voice, text, captions, duration, settings])).digest('hex');
    if (inp.new_take) fingerprint = createHash('sha256').update(Buffer.concat([Buffer.from(fingerprint), random(16)])).digest('hex');
    const record = { id: random(16).toString('hex'), stock: v.StockNumber, vehicle: title(v), price: v.price, client: clientOf(inp), voice_id: voice, text,
      caption_script: captions, duration, speed: settings.speed ?? 1.0, status: 'submitting', created_at: gmdateC() };
    narrationReserve(db, 'narrations', record, fingerprint);
    let code = 0;
    try {
      const r = await narrationHttp(bridge, 'https://api.elevenlabs.io/v1/text-to-speech/' + rawurlencode(voice) + '?output_format=mp3_44100_128', 'POST',
        { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, { text, model_id: 'eleven_multilingual_v2', voice_settings: settings });
      code = toInt(r.status);
      if (code < 200 || code >= 300) throw new Error('Voice preview API failed (HTTP ' + code + ').');
      const dir = String(cfg.asset_dir) + '/narrations';
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
      record.audio_name = record.id + '.mp3';
      const path = narrationAudioPath(cfg, record);
      writeFileSync(path, r.body); chmodSync(path, 0o644);
      record.audio_hash = createHash('sha256').update(r.body).digest('hex');
      record.audio_duration = (await bridge({ op: 'probe', path })).duration;
      record.status = 'ready'; record.approved = false; record.too_long = record.audio_duration > duration;
      narrationSave(db, 'narrations', record);
      return { message: 'Voice preview saved. Listen and approve pronunciation before lip-sync.' + narrationMismatchNote(narrationTextDifferences(text, captions, respell)) };
    } catch (e) {
      record.status = narrationRejected(code) ? 'failed' : 'submission_uncertain'; record.error = e.message;
      narrationSave(db, 'narrations', record, narrationRejected(code)); throw e;
    }
  }
  if (action === 'narration_approve') {
    if (!inp.reviewed) throw new Error('Listen to the complete preview and confirm pronunciation.');
    const r = narrationLoad(db, 'narrations', str(inp.id ?? ''));
    if (r.status !== 'ready') throw new Error('Preview is not ready.');
    narrationCheckAudio(cfg, r);
    if (r.too_long) throw new Error('Audio is too long. Shorten the narration and create another preview.');
    r.approved = true; r.approved_at = gmdateC(); narrationSave(db, 'narrations', r);
    return { message: 'Narration approved. Lip-sync requires a separate paid approval.' + narrationMismatchNote(narrationTextDifferences(str(r.text), str(r.caption_script), respell)) };
  }
  if (action === 'narration_lipsync') {
    if (!inp.approve_spend || !inp.confirm_current) throw new Error('Confirm current vehicle price/availability and approve one paid lip-sync request.');
    const key = narrationKey(cfg, 'fal_key');
    const audio = narrationLoad(db, 'narrations', str(inp.narration_id ?? ''));
    if (audio.status !== 'ready' || !audio.approved) throw new Error('Approve the voice preview first.');
    const source = narrationLoad(db, 'jobs', str(inp.video_id ?? ''));
    if ((source.status ?? '') !== 'completed' || !source.video_url) throw new Error('Choose a completed video.');
    if ((source.stock ?? '') !== audio.stock || (source.price ?? null) !== audio.price) throw new Error('Preview and video must be for the same vehicle and price.');
    let current = null;
    for (const c of clientInventory(db, audio.client ?? CLIENT_DEFAULT).vehicles ?? []) if (c.StockNumber === audio.stock) current = c;
    if (!current || (current.active ?? true) === false || current.price !== audio.price) throw new Error('Saved vehicle price changed or vehicle was removed. Create a new narration.');
    const duration = toInt(source.duration ?? 15);
    if (duration !== audio.duration) throw new Error('Preview target duration must match the selected video.');
    const path = narrationCheckAudio(cfg, audio); publicImage(source.video_url);
    const padded = await bridge({ op: 'pad', path, duration });
    // Publish padded audio as a WAV: this model rejects inline data URIs.
    const prefix = 'data:audio/wav;base64,';
    if (!String(padded.audio_url ?? '').startsWith(prefix)) throw new Error('Unexpected padded audio format.');
    const b64 = padded.audio_url.slice(prefix.length);
    const wav = /^[A-Za-z0-9+/]*={0,2}$/.test(b64) ? Buffer.from(b64, 'base64') : null;
    if (!wav || wav.subarray(0, 4).toString('latin1') !== 'RIFF' || wav.subarray(8, 12).toString('latin1') !== 'WAVE') throw new Error('Invalid padded WAV audio.');
    const wavName = random(16).toString('hex') + '.wav', wavPath = path.slice(0, path.lastIndexOf('/')) + '/' + wavName;
    writeFileSync(wavPath, wav); chmodSync(wavPath, 0o644);
    const audioUrl = validateAppBase(cfg) + '/assets/narrations/' + wavName;
    const record = { id: random(16).toString('hex'), stock: audio.stock, vehicle: audio.vehicle, client: audio.client ?? CLIENT_DEFAULT, narration_id: audio.id,
      source_video_id: source.id, audio_file: wavName, auto_build: !!inp.auto_build, status: 'submitting', created_at: gmdateC() };
    narrationReserve(db, 'narration_lipsync', record, createHash('sha256').update(audio.audio_hash + '|' + source.id).digest('hex'));
    let code = 0;
    try {
      const r = await narrationHttp(bridge, 'https://queue.fal.run/fal-ai/sync-lipsync/v2', 'POST', { Authorization: 'Key ' + key, 'Content-Type': 'application/json' },
        { model: 'lipsync-2', video_url: source.video_url, audio_url: audioUrl, sync_mode: 'silence' });
      code = toInt(r.status);
      if (code < 200 || code >= 300) throw new Error('Lip-sync API failed (HTTP ' + code + '): ' + (r.detail ?? 'No provider details.'));
      const result = jsonBody(r.body);
      if (!result.request_id) throw new Error('Lip-sync request ID missing; check fal request history.');
      record.request_id = result.request_id;
      for (const field of ['status_url', 'response_url']) record[field] = narrationSafeQueueUrl(str(result[field] ?? ''));
      record.status = 'queued'; narrationSave(db, 'narration_lipsync', record);
      return { message: 'Lip-sync submitted once. Refresh its status; do not generate again.' };
    } catch (e) {
      record.status = narrationRejected(code) ? 'failed' : 'submission_uncertain'; record.error = e.message;
      narrationSave(db, 'narration_lipsync', record, narrationRejected(code)); throw e;
    }
  }
  if (action === 'narration_poll') {
    const key = narrationKey(cfg, 'fal_key');
    const record = narrationLoad(db, 'narration_lipsync', str(inp.id ?? ''));
    if (['completed', 'failed'].includes(record.status)) return { message: 'Lip-sync is ' + record.status + '.' };
    if (!record.request_id) throw new Error('Submission is uncertain. Check fal request history before retrying.');
    const headers = { Authorization: 'Key ' + key };
    let r = await narrationHttp(bridge, narrationSafeQueueUrl(str(record.status_url ?? '')), 'GET', headers);
    if (![200, 202].includes(toInt(r.status))) throw new Error('Status check failed (HTTP ' + r.status + '). No new request submitted.');
    const st = jsonBody(r.body);
    if ((st.status ?? '') === 'COMPLETED') {
      if (st.error) { record.status = 'failed'; record.error = 'Provider reported a failed lip-sync. Check fal history.'; }
      else {
        r = await narrationHttp(bridge, narrationSafeQueueUrl(str(record.response_url ?? '')), 'GET', headers);
        if (toInt(r.status) === 422) {
          record.status = 'failed'; record.error = 'fal rejected the generation input (HTTP 422). See fal request details.';
          narrationSave(db, 'narration_lipsync', record, true);
          return { message: 'Previous request failed validation. After correcting the input, you can submit again.' };
        }
        if (r.status !== 200) throw new Error('Result fetch failed (HTTP ' + r.status + '). Check fal history; refresh without resubmitting.');
        const result = jsonBody(r.body); const url = str(result.video?.url ?? ''); publicImage(url);
        const source = narrationLoad(db, 'jobs', record.source_video_id), audio = narrationLoad(db, 'narrations', record.narration_id);
        // A fresh completed job for the caption workflow; the original video stays as it is.
        const job = { id: record.id, stock: source.stock, vehicle: source.vehicle, price: source.price, format: source.format, style: source.style ?? 'showroom',
          duration: source.duration ?? 15, status: 'completed', video_url: url, script: audio.caption_script, speech_script: audio.text, created_at: gmdateC(),
          provider: 'fal_lipsync', client: audio.client ?? CLIENT_DEFAULT, narration_id: audio.id, source_video_id: source.id, auto_build: !!record.auto_build };
        db.prepare('INSERT OR IGNORE INTO jobs (id,fingerprint,payload) VALUES (?,NULL,?)').run(job.id, jsonEncode(job));
        record.status = 'completed'; record.video_url = url; record.completed_at = gmdateC();
      }
    } else record.status = { IN_QUEUE: 'queued', IN_PROGRESS: 'in_progress' }[st.status ?? ''] ?? 'unknown';
    narrationSave(db, 'narration_lipsync', record);
    return { message: 'Lip-sync: ' + record.status + '. Completed results also appear in Video jobs for captions.' };
  }
  if (action === 'narration_delete') {
    const id = str(inp.id ?? ''); const audio = narrationLoad(db, 'narrations', id);
    if ((audio.status ?? '') === 'submitting') throw new Error('This voice preview is still being created. Refresh before deleting.');
    // Lip-synced videos keep needing the approved MP3 for caption timing, so in-use previews stay.
    if (db.prepare("SELECT COUNT(*) AS n FROM narration_lipsync WHERE json_extract(payload,'$.narration_id')=? AND json_extract(payload,'$.status')<>'failed'").get(id).n > 0)
      throw new Error('This preview is used by a lip-sync job. Delete that lip-sync job first.');
    if (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE json_extract(payload,'$.narration_id')=?").get(id).n > 0)
      throw new Error('A lip-synced video uses this preview for its captions, so it cannot be deleted.');
    db.prepare('DELETE FROM narrations WHERE id=?').run(id);
    if (audio.audio_name !== undefined && audio.audio_name !== null) { const p = narrationAudioPath(cfg, audio); if (existsSync(p)) unlinkSync(p); }
    return { message: 'Voice preview deleted.' };
  }
  if (action === 'narration_lipsync_delete') {
    const id = str(inp.id ?? ''); const record = narrationLoad(db, 'narration_lipsync', id);
    if (['submitting', 'queued', 'in_progress'].includes(record.status ?? '')) throw new Error('This lip-sync job is still running at fal. Refresh its status until it completes or fails before deleting.');
    db.prepare('DELETE FROM narration_lipsync WHERE id=?').run(id);
    const wav = str(record.audio_file ?? '');
    if (/^[a-f0-9]{32}\.wav$/.test(wav)) { const p = String(cfg.asset_dir) + '/narrations/' + wav; if (existsSync(p)) unlinkSync(p); }
    return { message: (record.status ?? '') === 'completed' ? 'Lip-sync job deleted. Its video stays in Video jobs.' : 'Lip-sync job deleted.' };
  }
  throw new Error('Unknown narration action.');
}
