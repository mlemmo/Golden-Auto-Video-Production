// One-approval build, run by the caption worker every minute before rendering. Port of private/auto_build.php:
// 1. auto-build lip-sync jobs still at fal are checked (free status checks; nothing is resubmitted);
// 2. a finished lip-synced video gets its captions timed from the approved narration audio and is queued;
// 3. native-voice Seedance jobs are followed on Higgsfield (free status checks) and queued with captions_from_audio.
import { str, toFloat, gmdateC, truthy } from './php.js';
import { phpJsonEncode } from './phpjson.js';
import { validateSrt } from './captions.js';
import { narrationTables, narrationApi, narrationLoad, narrationSave } from './narrations.js';
import { higgsfieldRequest, jobError } from './jobs.js';
import { rawurlencode } from './website.js';
import { finishDraft } from './finishing.js';

const saveJob = (db, job) => db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(phpJsonEncode(job), job.id);
const jobRows = (db) => db.prepare('SELECT payload FROM jobs ORDER BY rowid').all().map((r) => JSON.parse(r.payload));

export async function higgsfieldStatus(cfg, requestId) {
  const body = await higgsfieldRequest('https://api.higgsfield.ai/requests/' + rawurlencode(requestId) + '/status', null, str(cfg.higgsfield_key ?? ''));
  try { return JSON.parse(body); } catch { throw new Error('Syntax error'); }
}

/** Native-voice jobs: follow the Seedance request, then queue the captioned final render. No paid calls. */
export async function nativeBuild(db, hfStatus) {
  const log = [];
  for (const job of jobRows(db)) {
    if (!['native', 'elevenlabs'].includes(job.voice ?? '') || !truthy(job.auto_build) || !truthy(job.request_id) || truthy(job.finish_status)) continue;
    if (['failed', 'canceled', 'nsfw'].includes(job.status ?? '')) continue;
    if ((job.status ?? '') !== 'completed') {
      try {
        const r = await hfStatus(job.request_id);
        job.status = r?.status ?? 'unknown'; job.video_url = r?.video?.url ?? job.video_url ?? null;
        job.error = jobError(r?.error ?? r?.detail ?? null); log.push('checked seedance ' + job.id + ': ' + job.status);
      } catch (e) { job.error = jobError('Automatic status check failed: ' + e.message); log.push('seedance check failed ' + job.id); }
    }
    if ((job.status ?? '') === 'completed' && truthy(job.video_url)) {
      job.captions_from_audio = true; job.captions_srt = '';
      job.finish_status = 'queued'; job.render_backend = 'linux'; job.finish_error = ''; job.captioned_url = null; job.auto_queued_at = gmdateC();
      log.push('queued final render ' + job.id);
    }
    saveJob(db, job);
  }
  return log;
}

/** opts: { poll(id), hfStatus(requestId), python } — replaceable in tests. */
export async function autoBuild(db, cfg, { poll, hfStatus, python } = {}) {
  narrationTables(db);
  hfStatus ??= (id) => higgsfieldStatus(cfg, id);
  const log = await nativeBuild(db, hfStatus);
  poll ??= (id) => narrationApi('narration_poll', { id }, cfg, db);
  for (const { payload } of db.prepare('SELECT payload FROM narration_lipsync ORDER BY rowid').all()) {
    let r = JSON.parse(payload);
    if (!truthy(r.auto_build) || !truthy(r.request_id) || !['queued', 'in_progress', 'unknown'].includes(r.status ?? '')) continue;
    try { await poll(r.id); log.push('checked lip-sync ' + r.id); }
    catch (e) {
      // Leave the job for the next run; record the reason so the dashboard shows it.
      r = narrationLoad(db, 'narration_lipsync', r.id); r.error = jobError('Automatic status check failed: ' + e.message); narrationSave(db, 'narration_lipsync', r);
      log.push('lip-sync check failed ' + r.id);
    }
  }
  for (const job of jobRows(db)) {
    if (!truthy(job.auto_build) || (job.status ?? '') !== 'completed' || truthy(job.finish_status) || (job.provider ?? '') !== 'fal_lipsync') continue;
    try {
      const draft = await finishDraft(db, cfg, job, python);
      job.captions_srt = validateSrt(str(draft.srt), toFloat(job.duration ?? 15));
      job.finish_status = 'queued'; job.render_backend = 'linux'; job.finish_error = ''; job.captioned_url = null; job.auto_queued_at = gmdateC();
      log.push('queued final render ' + job.id);
    } catch (e) {
      job.finish_status = 'failed'; job.finish_error = jobError('Automatic build stopped: ' + e.message);
      log.push('build failed ' + job.id);
    }
    saveJob(db, job);
  }
  return log;
}
