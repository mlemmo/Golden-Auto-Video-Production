// Caption worker run (every minute): the one-approval auto build, then one queued final render — download the
// generated video (or copy uploaded footage), time captions from real speech when asked, and burn them in with
// FFmpeg (or the intro/closing-card render for lip-synced videos). Port of private/caption_worker.php. Free: status
// checks, a download of our own finished video, and local tools only.
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { createWriteStream, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, readFileSync, readdirSync, unlinkSync, rmdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { str, toInt, toFloat, truthy, gmdateC, parseUrl } from './php.js';
import { phpJsonEncode } from './phpjson.js';
import { validateSrt } from './captions.js';
import { isPublicIPv4, pinnedLookup } from './clients.js';
import { jobError, footageLocalPath } from './jobs.js';
import { autoBuild } from './autobuild.js';
import { NARRATION_OFFSET, runProcess, nativeCaptions, finishRender, jobNarration } from './finishing.js';

const saveRenderJob = (db, j) => db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(phpJsonEncode(j), j.id);

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

export const CAPTION_STYLE_NATIVE = 'FontName=DejaVu Sans,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=1,Outline=0,Shadow=1.5,Alignment=2,MarginV=28';
export const CAPTION_STYLE_PLAIN = 'FontName=DejaVu Sans,FontSize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=40';

/** The FFmpeg arguments for a captioned render (everything except the fal intro/closing-card path). */
export function renderArgs(cfg, job, narration, output) {
  const [w, h] = job.format === 'facebook_feed' ? [1080, 1350] : job.format === 'square' ? [1080, 1080] : [1080, 1920];
  // Native-voice videos: bold white words, no box or outline, with a faint soft shadow so they stay readable.
  const style = ['native', 'elevenlabs'].includes(job.voice ?? '') ? CAPTION_STYLE_NATIVE : CAPTION_STYLE_PLAIN;
  const filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,subtitles=captions.srt:force_style='${style}'`;
  const args = [str(cfg.ffmpeg_path ?? 'ffmpeg'), '-nostdin', '-n', '-hide_banner', '-loglevel', 'error', '-i', 'master.mp4'];
  // audio_swap jobs: the approved narration replaces the generated audio.
  if (narration) args.push('-i', narration, '-filter_complex', '[1:a]adelay=' + Math.round(NARRATION_OFFSET * 1000) + ':all=1,apad[a]', '-map', '0:v', '-map', '[a]', '-shortest');
  // Footage is usually longer than the ad: trim it to the video length.
  if ((job.provider ?? '') === 'footage') args.push('-t', String(toInt(job.duration ?? 30)));
  args.push('-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output);
  return args;
}

/**
 * One worker run. opts: { download, autoBuildOpts, captions(cfg, job, source, work, offset), render(db, cfg, job, work,
 * output, w, h), ffmpeg(args, work, log), random, now } — replaceable in tests. Returns the lines PHP prints.
 */
export async function captionWorkerRun(db, cfg, opts = {}) {
  const { download = downloadMaster, captions = nativeCaptions, render = finishRender, random = randomBytes, now = () => Date.now() } = opts;
  const ffmpeg = opts.ffmpeg ?? (async (args, work, log) => {
    const fd = openSync(log, 'a');
    try { return (await runProcess(args[0], args.slice(1), { cwd: work, stdio: ['ignore', fd, fd] })).code; } finally { closeSync(fd); }
  });
  const out = [];
  if (str(cfg.render_backend ?? 'linux') !== 'linux') return out;
  try { for (const line of await autoBuild(db, cfg, opts.autoBuildOpts ?? {})) out.push(line); }
  catch (e) { out.push('Auto-build step failed: ' + jobError(e.message)); }

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
    // Uploaded footage is already on this server; generated videos are downloaded.
    if ((job.provider ?? '') === 'footage') {
      const source = footageLocalPath(cfg, job);
      try { copyFileSync(source, work + '/master.mp4'); } catch { throw new Error('Cannot read the uploaded footage.'); }
    }
    else await download(job.video_url, work + '/master.mp4');
    let narration = null;
    // voice=elevenlabs keeps Seedance's own speech (its lips match it); audio_swap jobs replace it with the narration.
    if ((job.voice ?? '') === 'elevenlabs' && truthy(job.audio_swap)) narration = jobNarration(db, cfg, job);
    if (truthy(job.captions_from_audio)) {
      job.captions_srt = narration ? await captions(cfg, job, narration, work, NARRATION_OFFSET) : await captions(cfg, job, work + '/master.mp4', work, 0.0);
      saveRenderJob(db, job);
    }
    writeFileSync(work + '/captions.srt', validateSrt(str(job.captions_srt), toFloat(job.duration ?? 15)));
    const [w, h] = job.format === 'facebook_feed' ? [1080, 1350] : job.format === 'square' ? [1080, 1080] : [1080, 1920];
    const name = random(20).toString('hex') + '.mp4'; output = str(cfg.asset_dir) + '/' + name;
    if ((job.provider ?? '') === 'fal_lipsync') await render(db, cfg, job, work, output, w, h);
    else {
      const status = await ffmpeg(renderArgs(cfg, job, narration, output), work, work + '/ffmpeg.log');
      if (status !== 0 || !existsSync(output) || statSync(output).size < 1000) {
        let detail = ''; try { detail = readFileSync(work + '/ffmpeg.log').subarray(0, 1000).toString(); } catch { /* no log */ }
        throw new Error('FFmpeg failed: ' + detail);
      }
    }
    chmodSync(output, 0o644);
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
