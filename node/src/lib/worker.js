// Caption worker run (every minute): the one-approval auto build, then one queued final render — download the
// generated video (or copy uploaded footage, or draw a photo slideshow), time captions from real speech when asked, and burn them in with
// FFmpeg (or the intro/closing-card render for lip-synced videos). Free: status
// checks, a download of our own finished video, and local tools only.
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { createWriteStream, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, readFileSync, readdirSync, unlinkSync, rmdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { str, toInt, toFloat, truthy, gmdateC, parseUrl } from './text.js';
import { jsonEncode } from './storedjson.js';
import { validateSrt } from './captions.js';
import { isPublicIPv4, pinnedLookup } from './clients.js';
import { jobError, footageLocalPath } from './jobs.js';
import { autoBuild } from './autobuild.js';
import { formatSize, slideshowMaster } from './slideshow.js';
import { musicFilter } from './music.js';
import { NARRATION_OFFSET, runProcess, nativeCaptions, finishRender, jobNarration } from './finishing.js';

const saveRenderJob = (db, j) => db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(jsonEncode(j), j.id);

/** downloadMaster(): https only, a public IPv4 address pinned for the connection, no redirects, at most 100 MB. */
export async function downloadMaster(url, path) {
  const u = parseUrl(url) || {};
  if (u.scheme !== 'https' || !u.host || u.user !== undefined || u.pass !== undefined || u.port !== undefined) throw new Error('Invalid generated-video URL.');
  let ip = null;
  try { for (const a of await lookup(u.host, { all: true, family: 4 })) if (isPublicIPv4(a.address)) { ip = a.address; break; } } catch { /* none */ }
  if (!ip) throw new Error('Generated-video host could not be resolved to a public IPv4 address.');
  const { status, size } = await new Promise((resolve) => {
    const file = createWriteStream(path); let size = 0, status = 0, done = false;
    const finish = () => { if (!done) { done = true; file.end(() => resolve({ status, size })); } };
    const req = request(url, { lookup: pinnedLookup(ip), timeout: 90000 }, (res) => {
      status = res.statusCode;
      res.on('data', (d) => { size += d.length; if (size > 100000000) { req.destroy(); return; } file.write(d); });
      res.on('end', finish); res.on('error', finish); res.on('close', finish);
    });
    req.setTimeout(90000, () => req.destroy());
    req.on('error', finish);
    req.end();
  });
  if (status !== 200 || size < 1000 || size > 100000000) throw new Error('Video download failed (HTTP ' + status + '). Refresh the generation result if its link expired.');
}

/** A slideshow's background track on this server (null without music; an error when its file was deleted). */
export function jobMusic(cfg, job) {
  const name = str(job.music_file ?? '');
  if (name === '') return null;
  const path = str(cfg.asset_dir ?? '') + '/music/' + name;
  if (!/^music-[a-f0-9]{16}\.(mp3|m4a|wav)$/.test(name) || !existsSync(path)) throw new Error('The background music for this video was deleted. Build it again with another track or no music.');
  return path;
}

export const CAPTION_STYLE_NATIVE = 'FontName=DejaVu Sans,Bold=1,FontSize=11,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=1,Outline=0,Shadow=1.5,Alignment=2,MarginV=28';
export const CAPTION_STYLE_PLAIN = 'FontName=DejaVu Sans,FontSize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=40';

/**
 * The FFmpeg arguments for a captioned render (everything except the fal intro/closing-card path). music: a looped
 * background track mixed under the narration (photo slideshows).
 */
export function renderArgs(cfg, job, narration, output, music = null) {
  const [w, h] = formatSize(job.format);
  // Native-voice videos: bold white words, no box or outline, with a faint soft shadow so they stay readable.
  const style = ['native', 'elevenlabs'].includes(job.voice ?? '') ? CAPTION_STYLE_NATIVE : CAPTION_STYLE_PLAIN;
  const filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,subtitles=captions.srt:force_style='${style}'`;
  const args = [str(cfg.ffmpeg_path ?? 'ffmpeg'), '-nostdin', '-n', '-hide_banner', '-loglevel', 'error', '-i', 'master.mp4'];
  // audio_swap jobs: the approved narration replaces the generated audio.
  if (narration && music) args.push('-i', narration, '-stream_loop', '-1', '-i', music, '-filter_complex', musicFilter('1:a', '2:a', Math.round(NARRATION_OFFSET * 1000), toFloat(job.duration ?? 30)), '-map', '0:v', '-map', '[a]', '-shortest');
  else if (narration) args.push('-i', narration, '-filter_complex', '[1:a]adelay=' + Math.round(NARRATION_OFFSET * 1000) + ':all=1,apad[a]', '-map', '0:v', '-map', '[a]', '-shortest');
  // Footage is usually longer than the ad: trim it to the video length.
  if ((job.provider ?? '') === 'footage') args.push('-t', String(toInt(job.duration ?? 30)));
  args.push('-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output);
  return args;
}

/**
 * A small still from a finished video (assets/posters/<video name>.jpg, 360 px wide) for the Library's thumbnails, so
 * the page shows pictures instead of loading every video. Returns its URL, or '' when it could not be made.
 */
export async function makePoster(cfg, videoPath) {
  const name = videoPath.split('/').pop().replace(/\.mp4$/, '.jpg');
  if (!/^[a-f0-9]{40}\.jpg$/.test(name)) return '';
  const dir = str(cfg.asset_dir) + '/posters';
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const r = await runProcess(str(cfg.ffmpeg_path ?? 'ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', dir + '/' + name], { stdio: 'ignore', timeoutMs: 60000 });
  if (r.code !== 0 || !existsSync(dir + '/' + name)) return '';
  chmodSync(dir + '/' + name, 0o644);
  return str(cfg.public_base_url).replace(/\/+$/, '') + '/assets/posters/' + name;
}

/** Posters for finished videos made before posters existed (a few per run). */
export async function backfillPosters(db, cfg, limit = 20, poster = makePoster) {
  let n = 0;
  for (const { payload } of db.prepare('SELECT payload FROM jobs').all()) {
    if (n >= limit) break;
    const j = JSON.parse(payload), url = str(j.captioned_url ?? '');
    if (j.finish_status !== 'completed' || j.poster_url || !url) continue;
    const path = str(cfg.asset_dir) + '/' + url.split('/').pop();
    if (!/^[a-f0-9]{40}\.mp4$/.test(url.split('/').pop()) || !existsSync(path)) continue;
    const p = await poster(cfg, path); n++;
    if (!p) continue;
    // Re-read before saving: the video may have changed meanwhile.
    const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(j.id); if (!row) continue;
    const cur = JSON.parse(row.payload); if (cur.captioned_url !== j.captioned_url) continue;
    cur.poster_url = p; saveRenderJob(db, cur);
  }
  return n;
}

/** Queued final renders waiting for this server. */
export const queuedRenders = (db, cfg) => db.prepare('SELECT payload FROM jobs').all().map((r) => JSON.parse(r.payload))
  .filter((j) => (j.finish_status ?? '') === 'queued' && (j.render_backend ?? cfg.render_backend ?? 'linux') === 'linux').length;

/**
 * The whole queue in one process: the auto build once, then `slots` renders side by side (config render_parallel,
 * default 2; a slideshow uses about 1–2 GB and two CPU threads), each slot taking the next queued video as soon as it
 * is free, until nothing is queued or `budgetMs` has passed (cron starts the next run a minute later). Each video is
 * claimed by one slot only: picking and marking it "rendering" happen without a pause in between. touch() keeps the
 * run's lock fresh. Returns the log lines.
 */
export async function captionWorkerDrain(db, cfg, { slots = Math.max(1, Math.min(4, Number(cfg.render_parallel ?? 2) || 2)), budgetMs = 50 * 60000, touch = () => {}, run = captionWorkerRun, now = () => Date.now(), opts = {} } = {}) {
  const start = now(), out = [];
  for (const line of await run(db, cfg, { ...opts, skipAutoBuild: false, renderLimit: 0 })) out.push(line);
  const slot = async () => {
    while (now() - start < budgetMs && queuedRenders(db, cfg) > 0) {
      for (const line of await run(db, cfg, { ...opts, skipAutoBuild: true })) out.push(line);
      touch();
    }
  };
  await Promise.all(Array.from({ length: slots }, slot));
  try { const n = await (opts.backfill ?? backfillPosters)(db, cfg); if (n) out.push('Posters made for ' + n + ' older videos'); } catch { /* next run */ }
  return out;
}

/**
 * One worker run. opts: { download, autoBuildOpts, captions(cfg, job, source, work, offset), render(db, cfg, job, work,
 * output, w, h), slideshow(cfg, job, work, ffmpeg), ffmpeg(args, work, log), random, now } — replaceable in tests. Returns the log lines.
 */
export async function captionWorkerRun(db, cfg, opts = {}) {
  const { download = downloadMaster, captions = nativeCaptions, render = finishRender, slideshow = slideshowMaster, random = randomBytes, now = () => Date.now() } = opts;
  const ffmpeg = opts.ffmpeg ?? (async (args, work, log) => {
    const fd = openSync(log, 'a');
    try { return (await runProcess(args[0], args.slice(1), { cwd: work, stdio: ['ignore', fd, fd] })).code; } finally { closeSync(fd); }
  });
  const out = [];
  if (str(cfg.render_backend ?? 'linux') !== 'linux') return out;
  // skipAutoBuild: a second render slot of the same run (the auto build runs once per run).
  if (!opts.skipAutoBuild) {
    try { for (const line of await autoBuild(db, cfg, opts.autoBuildOpts ?? {})) out.push(line); }
    catch (e) { out.push('Auto-build step failed: ' + jobError(e.message)); }
  }

  // renderLimit 0: only the auto build (the drain's first step).
  if (opts.renderLimit === 0) return out;
  let job = null;
  for (const { payload } of db.prepare('SELECT payload FROM jobs ORDER BY rowid').all()) {
    const j = JSON.parse(payload);
    const started = Date.parse(j.finish_started_at ?? '') || now();
    if ((j.finish_status ?? '') === 'rendering' && started < now() - 900000) { j.finish_status = 'failed'; j.finish_error = 'Caption worker stopped before completing. Review the job and queue finishing again.'; saveRenderJob(db, j); }
    if ((j.finish_status ?? '') === 'queued' && (j.render_backend ?? cfg.render_backend ?? 'linux') === 'linux') { job = j; break; }
  }
  if (!job) return out;
  const work = str(cfg.data_dir) + '/render-' + random(10).toString('hex');
  mkdirSync(work, { mode: 0o700 });
  let output = null;
  try {
    job.finish_status = 'rendering'; job.finish_started_at = gmdateC(); saveRenderJob(db, job);
    const isSlideshow = (job.provider ?? '') === 'slideshow';
    // Uploaded footage is already on this server; generated videos are downloaded. A slideshow is drawn below, after
    // its captions (they are timed from the approved voice), in one FFmpeg run with the captions and the sound.
    if ((job.provider ?? '') === 'footage') {
      const source = footageLocalPath(cfg, job);
      try { copyFileSync(source, work + '/master.mp4'); } catch { throw new Error('Cannot read the uploaded footage.'); }
    }
    else if (!isSlideshow) await download(job.video_url, work + '/master.mp4');
    let narration = null;
    // voice=elevenlabs keeps Seedance's own speech (its lips match it); audio_swap jobs replace it with the narration.
    if ((job.voice ?? '') === 'elevenlabs' && truthy(job.audio_swap)) narration = jobNarration(db, cfg, job);
    if (isSlideshow && !narration) throw new Error('A slideshow needs its approved voice preview.');
    if (truthy(job.captions_from_audio)) {
      job.captions_srt = narration ? await captions(cfg, job, narration, work, NARRATION_OFFSET) : await captions(cfg, job, work + '/master.mp4', work, 0.0);
      saveRenderJob(db, job);
    }
    writeFileSync(work + '/captions.srt', validateSrt(str(job.captions_srt), toFloat(job.duration ?? 15)));
    const [w, h] = formatSize(job.format);
    const name = random(20).toString('hex') + '.mp4'; output = str(cfg.asset_dir) + '/' + name;
    if ((job.provider ?? '') === 'fal_lipsync') await render(db, cfg, job, work, output, w, h);
    else if (isSlideshow) {
      await slideshow(cfg, job, work, ffmpeg, { db, final: { output, narration, music: jobMusic(cfg, job), style: CAPTION_STYLE_NATIVE, offsetMs: Math.round(NARRATION_OFFSET * 1000) } });
      if (!existsSync(output) || statSync(output).size < 1000) throw new Error('The slideshow could not be drawn (no video written).');
    } else {
      const status = await ffmpeg(renderArgs(cfg, job, narration, output, jobMusic(cfg, job)), work, work + '/ffmpeg.log');
      if (status !== 0 || !existsSync(output) || statSync(output).size < 1000) {
        let detail = ''; try { detail = readFileSync(work + '/ffmpeg.log').subarray(0, 1000).toString(); } catch { /* no log */ }
        throw new Error('FFmpeg failed: ' + detail);
      }
    }
    chmodSync(output, 0o644);
    job.poster_url = await (opts.poster ?? makePoster)(cfg, output);
    job.finish_status = 'completed'; job.finish_error = ''; job.captioned_url = str(cfg.public_base_url).replace(/\/+$/, '') + '/assets/' + name; job.finish_completed_at = gmdateC(); saveRenderJob(db, job);
    out.push('Caption render completed');
  } catch (e) {
    if (output && existsSync(output)) unlinkSync(output);
    job.finish_status = 'failed'; job.finish_error = jobError(e.message); saveRenderJob(db, job);
    out.push('Caption render failed; details saved to job');
  } finally {
    for (const f of readdirSync(work)) { try { unlinkSync(work + '/' + f); } catch { /* a folder: left for rmdir to report */ } }
    try { rmdirSync(work); } catch { /* not empty */ }
  }
  return out;
}
