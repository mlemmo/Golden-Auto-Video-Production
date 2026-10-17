// Vehicle detail, asset sheets, ZIP import, spokespersons and video jobs: same JSON in and out as the PHP dashboard
// (public/index.php). import, spokesperson_upload and footage_build are multipart uploads (ctx.files, like $_FILES).
import { createHash } from 'node:crypto';
import { state, save } from '../lib/db.js';
import { clientInventoryKey } from '../lib/clients.js';
import { trim, str } from '../lib/php.js';
import { phpJsonEncode } from '../lib/phpjson.js';
import { script } from '../lib/scripts.js';
import { speechScript, speechWordCount } from '../lib/speech.js';
import { assetSheet, importMediaZip } from '../lib/media.js';
import { spokespersonApi, spokespersonFind } from '../lib/spokespersons.js';
import { enrich, referenceImageUrl, uploadReference, generateJob, pollJob, jobsForClient, goldenJobDelete, goldenFootageBuild } from '../lib/jobs.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const SPOKESPERSON = ['spokesperson_list', 'spokesperson_upload', 'spokesperson_default', 'spokesperson_delete'];

export const MULTIPART = new Set(['import', 'spokesperson_upload', 'footage_build']);

export const jobRoutes = {
  ...Object.fromEntries(SPOKESPERSON.map((a) => [a, ({ cfg, db, client, body, files }) => spokespersonApi(a, { ...body, client }, cfg, db, files)])),

  detail: async ({ cfg, db, client, body, dealer }) => {
    const key = clientInventoryKey(client), a = state(db, key) ?? {};
    let out = null;
    for (const [i, v] of (a.vehicles ?? []).entries()) if (v.StockNumber === (body.stock ?? '')) { a.vehicles[i] = await enrich(v); out = { ...a.vehicles[i] }; break; }
    if (!out) throw new Error('Vehicle not found. Refresh inventory first.');
    save(db, key, a);
    out.script = script(out, 15, dealer); out.scripts = { 15: out.script, 30: script(out, 30, dealer) };
    const existing = state(db, 'sheet:' + (out.Vin ?? ''));
    if (existing && (existing.gallery_hash ?? '') === sha256(phpJsonEncode(out.photos ?? null))) out.asset_sheet = existing;
    else try { out.asset_sheet = await assetSheet(out, cfg); save(db, 'sheet:' + (out.Vin ?? ''), out.asset_sheet); } catch (e) { out.sheet_error = e.message; }
    return out;
  },
  sheet: async ({ cfg, db, client, body }) => {
    let v = null;
    for (const c of (state(db, clientInventoryKey(client)) ?? {}).vehicles ?? []) if (c.StockNumber === (body.stock ?? '')) v = c;
    if (!v) throw new Error('Select a current vehicle first.');
    v = await enrich(v);
    let selected = body.photos ?? [];
    if (selected === null || typeof selected !== 'object') throw new Error('Invalid photo selection.');
    if (!Array.isArray(selected)) selected = Object.values(selected);
    const sheet = await assetSheet(v, cfg, selected);
    save(db, 'sheet:' + (v.Vin ?? ''), sheet);
    return sheet;
  },
  speech: ({ body }) => ({ speech: speechScript(str(body.script ?? '')), words: speechWordCount(str(body.script ?? '')) }),
  sync_log: ({ db }) => state(db, 'sync_log') ?? { entries: [] },
  import: async ({ cfg, db, client, body, files }) => {
    const file = files.media ?? null;
    if (!file || file.error !== 0) throw new Error('Upload failed. Check upload_max_filesize and post_max_size in PHP settings.');
    const v = importMediaZip(file.tmp_name, body, cfg), key = clientInventoryKey(client);
    const a = state(db, key) ?? { vehicles: [] };
    a.vehicles = (a.vehicles ?? []).filter((c) => c.StockNumber !== v.StockNumber); a.vehicles.push(v);
    save(db, key, a); save(db, 'import:' + v.StockNumber, v);
    const imported = { ...v };
    try { save(db, 'sheet:' + v.Vin, await assetSheet(v, cfg)); } catch (e) { imported.sheet_error = e.message; }
    return { vehicles: a.vehicles, imported };
  },
  // Uploads both references to Higgsfield storage (no generation is submitted).
  references: async ({ cfg, db, body }) => {
    const sheet = referenceImageUrl(trim(str(body.sheet ?? '')), cfg);
    const avatar = referenceImageUrl(spokespersonFind(db, cfg, str(body.spokesperson ?? '')).url, cfg);
    await uploadReference(sheet, cfg); await uploadReference(avatar, cfg);
    return { message: 'Both references uploaded successfully to Higgsfield. No video generation was submitted.' };
  },
  footage_build: ({ cfg, db, client, body, files }) => ({
    message: 'Footage uploaded. The final video with your approved voice and captions is being built and appears under Videos in a few minutes. No paid generation was used.',
    job: goldenFootageBuild(db, cfg, { ...body, client }, files.footage ?? null),
  }),
  job_delete: ({ cfg, db, body }) => goldenJobDelete(db, cfg, str(body.id ?? '')),
  jobs: ({ db, client }) => jobsForClient(db, client),
  poll: ({ cfg, db, body }) => pollJob(db, cfg, str(body.id ?? '')),
  // The paid generation: approval, fingerprint and reservation rules in src/lib/jobs.js.
  generate: ({ cfg, db, client, body }) => generateJob(db, cfg, client, { ...body, client }),
};
