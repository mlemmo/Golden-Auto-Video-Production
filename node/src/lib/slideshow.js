// "Photo slideshow" videos (free): the car's own listing photos, in gallery order, each with a slow zoom and a short
// cross-fade, under the approved ElevenLabs voice, between a dealer intro card and a closing card. Like "My footage"
// there is no spokesperson and no paid generation; the voice preview is the only paid step. One approval builds
// every chosen shape at once (one job per format): 9:16 for Reels / Stories / Shorts / TikTok, 4:5 for the Facebook
// and Instagram feed and Marketplace ads, 16:9 for YouTube in-stream. 16:9 has no intro card so the car and the price
// are on screen before YouTube's skip button (5 s); the dealer card closes the video instead.
// The caption worker draws the master here (slideshowMaster), then burns the captions and lays the voice over it
// like a footage job (audio_swap, captions timed from the approved voice).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { str, toFloat, toInt, truthy, gmdateC } from './text.js';
import { jsonEncode } from './storedjson.js';
import { adPrice, priceMatches, title } from './price.js';
import { probeImage } from './images.js';
import { sheetBytes } from './media.js';
import { CLIENT_DEFAULT, clientInventory } from './clients.js';
import { narrationTables, narrationLoad, narrationCheckAudio } from './narrations.js';
import { NARRATION_OFFSET, finishPython } from './finishing.js';
import { musicFind } from './music.js';

export const FORMAT_SIZE = { instagram_reels: [1080, 1920], facebook_reels: [1080, 1920], facebook_feed: [1080, 1350], square: [1080, 1080], youtube: [1920, 1080] };
/** Width and height of a finished video in this publish format (9:16 when unknown). */
export const formatSize = (format) => FORMAT_SIZE[format] ?? [1080, 1920];
export const SLIDESHOW_FORMATS = ['instagram_reels', 'facebook_feed', 'youtube', 'square'];
export const SLIDESHOW_MAX_PHOTOS = 40;

export const SLIDE_FPS = 30;
export const SLIDE_FADE = 0.5;     // cross-fade between two pictures
export const SLIDE_MIN = 2.2;      // a photo stays at least this long, so a 60 s video shows up to ~25 photos
const INTRO_CARD = 2.0;
const OUTRO_MIN = 3.0, OUTRO_MAX = 6.0;
const ZOOM = 0.08;                 // each photo zooms 8 % in (or out, alternating)

/**
 * The slideshow's timeline. total: the video length asked for (the voice preview's 15/30/60 s); speechEnd: when the
 * voice stops (offset + recording length). The closing card follows the speech and fills the end (3–6 s); a voice
 * that runs too close to the end makes the video a little longer instead of cutting the card short. Photos share the
 * time between the cards evenly; with more photos than fit (SLIDE_MIN each), the first ones in gallery order are used.
 * Returns { total, slides: [{ kind: 'intro' | 'photo' | 'outro', photo?, start, end }] }.
 */
export function slideshowPlan({ total, speechEnd, photos, intro = true }) {
  let end = Math.max(toFloat(total), 5);
  let outroAt = Math.max(speechEnd + 0.8, end - OUTRO_MAX);
  if (end - outroAt < OUTRO_MIN) end = Math.ceil(outroAt + OUTRO_MIN);
  outroAt = Math.max(speechEnd + 0.8, end - OUTRO_MAX);
  const lead = intro ? INTRO_CARD : 0;
  const room = outroAt - lead;
  const count = Math.max(1, Math.min(photos, Math.floor(room / SLIDE_MIN)));
  const each = room / count;
  const slides = [];
  if (intro) slides.push({ kind: 'intro', start: 0, end: lead });
  for (let i = 0; i < count; i++) slides.push({ kind: 'photo', photo: i, start: round3(lead + i * each), end: round3(lead + (i + 1) * each) });
  slides.push({ kind: 'outro', start: round3(outroAt), end });
  return { total: end, slides };
}
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * The FFmpeg arguments that draw the silent master: one still per slide (inputs in slide order: files[i] with its
 * fit), composed at the delivery size, zoomed slowly (zoompan on a 2× copy, so the motion stays smooth) and joined
 * with cross-fades. fit 'cover' fills the frame; 'contain' shows the whole photo over a blurred, darker copy of it
 * (a 4:3 photo in a tall frame keeps the whole car).
 */
export function slideshowArgs(cfg, plan, inputs, [w, h], output) {
  const args = [str(cfg.ffmpeg_path ?? 'ffmpeg'), '-nostdin', '-n', '-hide_banner', '-loglevel', 'error'];
  for (const x of inputs) args.push('-i', x.file);
  const graph = [];
  plan.slides.forEach((s, i) => {
    // Every slide but the last also covers the cross-fade into the next one.
    const last = i === plan.slides.length - 1, len = s.end - s.start + (last ? 0 : SLIDE_FADE);
    const frames = Math.max(1, Math.round(len * SLIDE_FPS));
    const zoom = s.kind === 'photo' ? ZOOM : 0.03, grow = i % 2 === 0;
    const z = grow ? `1+${zoom}*on/${frames}` : `1+${zoom}*(1-on/${frames})`;
    const fit = inputs[i].fit === 'contain'
      ? `split=2[b${i}][f${i}];[b${i}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.12[bg${i}];` +
        `[f${i}]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg${i}];[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2`
      : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    graph.push(`[${i}:v]${fit},scale=${w * 2}:${h * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${SLIDE_FPS},setsar=1,format=yuv420p[s${i}]`);
  });
  let prev = 's0';
  for (let i = 1; i < plan.slides.length; i++) {
    const out = i === plan.slides.length - 1 ? 'v' : `x${i}`;
    graph.push(`[${prev}][s${i}]xfade=transition=fade:duration=${SLIDE_FADE}:offset=${plan.slides[i].start.toFixed(3)}[${out}]`);
    prev = out;
  }
  if (plan.slides.length === 1) graph.push('[s0]null[v]');
  args.push('-filter_complex', graph.join(';'), '-map', '[v]', '-t', plan.total.toFixed(3), '-r', String(SLIDE_FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-threads', '2', '-pix_fmt', 'yuv420p', '-an', output);
  return args;
}

/** 'cover' when the photo's shape is close to the frame's (a 4:3 photo in 16:9), else 'contain'. */
export function slideFit(size, [w, h]) {
  if (!size) return 'contain';
  const photo = size.width / size.height, frame = w / h;
  return Math.abs(photo - frame) / frame < 0.3 ? 'cover' : 'contain';
}

/** Price line of the cards: "Just $14,688", or "Call For Price" without an advertised price. */
export const cardPrice = (price) => (price === null || price === undefined ? 'Call For Price' : 'Just ' + adPrice(toFloat(price)));

/**
 * Jobs for a slideshow: one per chosen format, all from the same approved voice preview and the car's current
 * photos. Each goes straight to the caption worker (finish_status 'queued'). Free: nothing is generated.
 */
export function goldenSlideshowBuild(db, cfg, inp, dealer, { random = randomBytes } = {}) {
  if (!truthy(inp.confirm_current ?? false)) throw new Error('Confirm the vehicle is available and its advertised price is current.');
  const client = str(inp.client ?? CLIENT_DEFAULT); let v = null;
  for (const candidate of clientInventory(db, client).vehicles ?? []) if (candidate.StockNumber === (inp.stock ?? '')) v = candidate;
  if (!v) throw new Error('Select a current vehicle first.');
  if ((v.active ?? true) === false) throw new Error('This vehicle is no longer in active inventory.');
  const raw = Array.isArray(inp.formats) ? inp.formats : str(inp.formats ?? '').split(',');
  const formats = SLIDESHOW_FORMATS.filter((f) => raw.map((x) => str(x).trim()).includes(f));
  if (!formats.length) throw new Error('Choose at least one video shape.');
  const photos = (v.photos ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://')).slice(0, SLIDESHOW_MAX_PHOTOS);
  if (!photos.length) throw new Error('This car has no photos yet. Sync or import its photos first.');
  narrationTables(db);
  const voice = narrationLoad(db, 'narrations', str(inp.narration_id ?? ''));
  if ((voice.status ?? '') !== 'ready' || !truthy(voice.approved)) throw new Error('Choose an approved voice preview for this car (step 3).');
  if ((voice.stock ?? '') !== v.StockNumber || !priceMatches(voice.price ?? null, v.price ?? null)) throw new Error('The approved voice preview is for a different car or an old price. Make a new preview.');
  narrationCheckAudio(cfg, voice);
  const length = toInt(voice.duration), speechEnd = NARRATION_OFFSET + toFloat(voice.audio_duration ?? length);
  // Optional background music from the library (src/lib/music.js); '' = none.
  const music = musicFind(db, cfg, str(inp.music ?? ''));
  const cards = { dealer: str(dealer?.name ?? ''), website: str(dealer?.website ?? ''), phone: str(dealer?.phone ?? ''), city: str(dealer?.city ?? ''),
    vehicle: title(v), price: cardPrice(v.price ?? null) };
  const jobs = [];
  for (const format of formats) {
    const intro = format !== 'youtube';
    const plan = slideshowPlan({ total: length, speechEnd, photos: photos.length, intro });
    const id = random(12).toString('hex');
    const job = { id, client, stock: v.StockNumber, vehicle: title(v), spokesperson: '', format, style: 'slideshow',
      duration: plan.total, speech_end: round3(speechEnd), status: 'completed', provider: 'slideshow', created_at: gmdateC(), approved_by: str(inp.approved_by ?? ''),
      script: str(voice.caption_script), speech_script: str(voice.text), price: v.price ?? null, voice: 'elevenlabs',
      narration_id: voice.id, audio_swap: true, captions_from_audio: true, photos, cards, intro_card: intro, ...(music ? { music_id: music.id, music_file: music.file, music_name: music.name } : {}), video_url: '',
      finish_status: 'queued', render_backend: 'linux', finish_error: '', captioned_url: null, auto_queued_at: gmdateC() };
    db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(id, null, jsonEncode(job));
    jobs.push(job);
  }
  return jobs;
}

/**
 * Draws a slideshow job's silent master.mp4 in work: its photos (this server's copies, or the CDN), the two cards
 * (private/finish_video.py, op slideshow_card) and one FFmpeg run. opts: { photos(urls), python, ffmpeg(args, work, log) }.
 */
export async function slideshowMaster(cfg, job, work, ffmpeg, { photos = (urls) => sheetBytes(urls, cfg), python = finishPython } = {}) {
  const [w, h] = formatSize(job.format);
  const urls = (job.photos ?? []).slice(0, SLIDESHOW_MAX_PHOTOS);
  // The same plan as at build time (its total already fits the voice).
  const plan = slideshowPlan({ total: job.duration, speechEnd: toFloat(job.speech_end ?? 0), photos: urls.length, intro: job.intro_card !== false });
  const used = plan.slides.filter((s) => s.kind === 'photo').map((s) => urls[s.photo]);
  const bytes = await photos(used);
  const files = [];
  used.forEach((_, i) => {
    if (!bytes[i]) return;
    const file = `${work}/photo-${i}.jpg`; writeFileSync(file, bytes[i]);
    files.push({ file, fit: slideFit(probeImage(bytes[i]), [w, h]) });
  });
  if (files.length !== used.length) throw new Error('A car photo could not be read for the slideshow. Reopen the car to refresh its photos and build again.');
  const c = job.cards ?? {};
  const card = async (kind) => {
    const output = `${work}/${kind}.png`;
    await python({ op: 'slideshow_card', kind, output, width: w, height: h, photo: files[0].file, ...c });
    return { file: output, fit: 'cover' };
  };
  const inputs = [];
  for (const s of plan.slides) inputs.push(s.kind === 'photo' ? files[s.photo] : await card(s.kind));
  const status = await ffmpeg(slideshowArgs(cfg, plan, inputs, [w, h], `${work}/master.mp4`), work, `${work}/ffmpeg.log`);
  if (status !== 0) throw new Error('The slideshow could not be drawn (FFmpeg failed).');
  return plan;
}
