// Finishing: captions timed from real speech, and the intro/closing-card render of lip-synced videos. Port of
// private/finishing.php. Media work is done by the same local, free tools as PHP: private/finish_video.py (speech
// timing, cards), FFmpeg and whisper.cpp. No network and no paid calls.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, accessSync, unlinkSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { str, toInt, toFloat, trim, truthy } from './php.js';
import { phpJsonEncode } from './phpjson.js';
import { captionCues, captionSpokenScript, captionCallForPrice, captionSrt, validateSrt } from './captions.js';
import { narrationTables, narrationCheckAudio } from './narrations.js';
import { CLIENT_DEFAULT, clientInventory } from './clients.js';
import { priceMatches } from './price.js';

const HELPER = fileURLToPath(new URL('../../../private/finish_video.py', import.meta.url));
export const NARRATION_OFFSET = 0.5;
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Run a program; resolves { code, stdout, stderr } (code null when killed after timeoutMs). */
export function runProcess(cmd, args, { input = null, cwd, timeoutMs = 0, stdio } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { cwd, stdio: stdio ?? [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); }
    catch { return resolve({ code: -1, stdout: Buffer.alloc(0), stderr: '' }); }
    const out = [], err = [];
    const timer = timeoutMs ? setTimeout(() => p.kill('SIGKILL'), timeoutMs) : null;
    p.stdout?.on('data', (d) => out.push(d)); p.stderr?.on('data', (d) => err.push(d));
    p.on('error', () => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: '' }); });
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }); });
    if (input !== null) { p.stdin.on('error', () => {}); p.stdin.end(input); }
  });
}

/** goldenFinishPython(): the finishing helper (op analyze or render), JSON in and out. */
export async function finishPython(input) {
  const r = await runProcess('/usr/bin/python3', [HELPER], { input: phpJsonEncode(input) });
  let result = null; try { result = JSON.parse(r.stdout.toString()); } catch { /* reported below */ }
  if (result === null || typeof result !== 'object') throw new Error('Finishing helper failed. Check python3-pil and fonts-dejavu-core installation.');
  if (r.code !== 0 || result.error != null) throw new Error(result.error != null ? str(result.error) : 'Finishing helper failed.');
  return result;
}

const realpath = (p) => { try { return realpathSync(p); } catch { return false; } };
/** The closing-card photo: an imported inventory photo in this dashboard's assets folder. */
export function finishAsset(cfg, name) {
  if (!/^[a-f0-9]{40}\.(jpg|jpeg|png|webp)$/i.test(name)) throw new Error('Finishing needs an imported inventory photo.');
  const dir = realpath(String(cfg.asset_dir ?? '')), path = dir === false ? false : realpath(dir + '/' + name);
  if (!path || dirname(path) !== dir || !statSync(path).isFile() || statSync(path).size > 20000000) throw new Error('Selected closing-card photo is missing or too large.');
  return path;
}

function approvedAudio(db, id) {
  narrationTables(db);
  const row = db.prepare('SELECT payload FROM narrations WHERE id=?').get(id);
  return row ? JSON.parse(row.payload) : null;
}

/** Lip-synced jobs: caption draft timed from the approved narration, plus the intro/closing plan saved on the job. */
export async function finishDraft(db, cfg, job, python = finishPython) {
  const audio = approvedAudio(db, str(job.narration_id ?? ''));
  if (!audio || !truthy(audio.approved)) throw new Error('Approved narration record not found.');
  const path = narrationCheckAudio(cfg, audio);
  const timing = await python({ op: 'analyze', audio: path, audio_hash: audio.audio_hash, ffmpeg: cfg.ffmpeg_path ?? '/usr/bin/ffmpeg' });
  const duration = toFloat(job.duration ?? 15);
  if (2 + timing.source_end + 0.5 > duration) throw new Error('Narration is too long for a two-second intro and closing card. Shorten the narration or use a longer source video. No audio was cut.');
  let vehicle = null;
  for (const v of clientInventory(db, str(job.client ?? CLIENT_DEFAULT)).vehicles ?? []) if (str(v.StockNumber ?? '') === str(job.stock)) { vehicle = v; break; }
  if (!vehicle) throw new Error('Vehicle is missing from inventory. Import its photos before finishing.');
  if (!priceMatches(vehicle.price ?? null, job.price ?? null)) throw new Error('Vehicle price changed. Review the narration before finishing.');
  const index = toInt(cfg.finishing_photo_index?.[job.stock] ?? 0);
  const url = str(vehicle.photos?.[index] ?? '');
  const base = str(cfg.public_base_url).replace(/\/+$/, '') + '/assets/';
  if (!url.startsWith(base)) throw new Error('Import vehicle photos into this dashboard before finishing.');
  const name = url.slice(base.length), photo = finishAsset(cfg, name);
  job.finishing_plan = { version: 1, intro: 2, fade: 0.625, duration, source_end: timing.source_end, speech_end: timing.speech_end,
    photo_name: name, photo_hash: sha256File(photo), photo_index: index, audio_hash: audio.audio_hash };
  // Cues follow the pauses measured in the approved audio. Speech starts at t=2 on the FINAL timeline.
  let cues = captionCues(job.script, str(job.vehicle), timing.spans ?? [], toFloat(timing.speech_end));
  if (!cues.length) throw new Error('Caption script is empty.');
  if ((vehicle.price ?? null) === null) cues = captionCallForPrice(cues, duration - 2.0);
  const srt = captionSrt(cues, 2.0);
  db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(phpJsonEncode(job), job.id);
  return { srt, note: 'Two-second intro and smooth dissolve enabled. Uses inventory photo ' + (index + 1) + '. Caption timestamps include the intro. Cue timing follows the pauses in the approved audio and is spread by syllable count inside each sentence; it is not word-level transcription, so review the final render.' };
}

/** Lip-synced jobs: the final render with intro card, captions and closing card (finish_video.py). */
export async function finishRender(db, cfg, job, work, output, w, h, python = finishPython) {
  const plan = job.finishing_plan ?? null;
  if (!plan || (plan.version ?? 0) !== 1) throw new Error('Open Review captions again to prepare the intro and closing card, then queue finishing.');
  const photo = finishAsset(cfg, plan.photo_name);
  if (plan.photo_hash !== sha256File(photo)) throw new Error('Closing photo changed. Review captions again.');
  const audio = approvedAudio(db, job.narration_id);
  if (!audio || !truthy(audio.approved) || plan.audio_hash !== (audio.audio_hash ?? '')) throw new Error('Approved narration changed. Review captions again.');
  narrationCheckAudio(cfg, audio);
  // Prevent captions from appearing over the introductory or closing cards.
  for (const m of str(job.captions_srt).matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g)) {
    const a = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000, b = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    if (a < 2 || b > 2 + plan.source_end + 0.001) throw new Error('Keep caption cues between 2 seconds and the closing card. Reopen Review captions for an updated draft.');
  }
  await python({ op: 'render', work, output, photo, title: job.vehicle, width: w, height: h, plan, ffmpeg: cfg.ffmpeg_path ?? '/usr/bin/ffmpeg' });
}

/** The caption SRT from measured speech timing and the recognized words (port of goldenNativeCues). */
export function nativeCues(job, timing, heard, offset = 0.0) {
  const spoken = heard.length ? captionSpokenScript(str(job.script), heard) : null;
  let cues = captionCues(spoken ?? str(job.script), str(job.vehicle ?? ''), timing.spans ?? [], toFloat(timing.speech_end));
  if (!cues.length) throw new Error('Caption script is empty.');
  // No advertised price: nobody says a price, and "Call For Price" is shown once the speech has finished.
  if (Object.hasOwn(job, 'price') && job.price === null) cues = captionCallForPrice(cues, toFloat(job.duration ?? 30) - offset);
  return validateSrt(captionSrt(cues, offset), toFloat(job.duration ?? 30));
}

/** Captions for a native-voice video, timed from its speech (the master's audio, or the swapped-in narration). */
export async function nativeCaptions(cfg, job, source, work, offset = 0.0, { python = finishPython, heard = heardWords } = {}) {
  const ffmpeg = str(cfg.ffmpeg_path ?? '/usr/bin/ffmpeg'), wav = work + '/speech.wav';
  const r = await runProcess(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-t', '61', wav], { stdio: 'ignore' });
  if (r.code !== 0 || !existsSync(wav)) throw new Error('No usable speech audio found for the captions.');
  const timing = await python({ op: 'analyze', audio: wav, audio_hash: sha256File(wav), ffmpeg });
  // Captions show the caption text; local speech recognition (when configured) tells where she added words.
  return nativeCues(job, timing, await heard(cfg, wav, work), offset);
}

/** Recognized words [[text, start, end], ...] from local whisper.cpp; [] when not configured or when it fails. */
export async function heardWords(cfg, wav, work) {
  const cli = str(cfg.whisper_cli ?? ''), model = str(cfg.whisper_model ?? '');
  if (cli === '' || model === '') return [];
  try { accessSync(cli, constants.X_OK); if (!statSync(model).isFile()) return []; } catch { return []; }
  const base = work + '/heard';
  try { unlinkSync(base + '.json'); } catch { /* none yet */ }
  // No script prompt: it would bias recognition toward the script and hide words she added.
  const r = await runProcess(cli, ['-m', model, '-f', wav, '-l', 'en', '-t', String(Math.max(1, toInt(cfg.whisper_threads ?? 4))), '-ml', '1', '-sow', '-oj', '-of', base, '-np'], { stdio: 'ignore', timeoutMs: 240000 });
  if (r.code === null || r.code === -1) return [];
  let d = null; try { d = JSON.parse(readFileSync(base + '.json', 'utf8')); } catch { return []; }
  const words = [];
  for (const seg of d?.transcription ?? []) {
    const t = trim(str(seg.text ?? ''));
    if (t === '' || seg.offsets?.from == null || seg.offsets?.to == null) continue;
    words.push([t, seg.offsets.from / 1000, seg.offsets.to / 1000]);
  }
  return words;
}

/** audio_swap jobs: the approved narration (hash-checked) that becomes the final video's audio. */
export function jobNarration(db, cfg, job) {
  const audio = approvedAudio(db, str(job.narration_id ?? ''));
  if (!audio || !truthy(audio.approved)) throw new Error('The approved voice preview for this video was deleted. Generate again with an approved preview.');
  return narrationCheckAudio(cfg, audio);
}
