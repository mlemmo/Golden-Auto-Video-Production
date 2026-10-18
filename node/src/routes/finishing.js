// Review captions (caption_draft) and queue the final render (finish).
import { str, toFloat, truthy } from '../lib/text.js';
import { jsonEncode } from '../lib/storedjson.js';
import { captionDraft, validateSrt } from '../lib/captions.js';
import { finishDraft } from '../lib/finishing.js';

async function captionAction(action, { cfg, db, body }) {
  const row = db.prepare('SELECT payload FROM jobs WHERE id=?').get(str(body.id ?? ''));
  if (!row) throw new Error('Job not found.');
  const job = JSON.parse(row.payload);
  if (job.status !== 'completed' || !truthy(job.video_url)) throw new Error('Wait for the video generation to complete.');
  const busy = ['queued', 'rendering'].includes(job.finish_status ?? '');
  if ((job.provider ?? '') === 'fal_lipsync') {
    if (action === 'caption_draft') {
      if (busy) throw new Error('Wait for the current finishing job before preparing a new draft.');
      return finishDraft(db, cfg, job);
    }
    if (!truthy(job.finishing_plan)) throw new Error('Open Review captions first to prepare the intro and closing card.');
  }
  if (action === 'caption_draft') return { srt: captionDraft(job.script, toFloat(job.duration ?? 15), str(job.vehicle ?? '')), note: 'Draft timing from the script. Review against the actual spoken audio before rendering.' };
  if (!truthy(body.reviewed ?? false)) throw new Error('Review caption wording and timing first.');
  if (busy) throw new Error('This video is already queued for finishing.');
  job.captions_srt = validateSrt(str(body.srt ?? ''), toFloat(job.duration ?? 15));
  job.finish_status = 'queued'; job.render_backend = cfg.render_backend ?? 'linux'; job.finish_error = ''; job.captioned_url = null;
  db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(jsonEncode(job), job.id);
  return { message: 'Caption render queued. The configured rendering worker will process it. Refresh video jobs to check progress.' };
}

export const finishingRoutes = {
  caption_draft: (ctx) => captionAction('caption_draft', ctx),
  finish: (ctx) => captionAction('finish', ctx),
};
