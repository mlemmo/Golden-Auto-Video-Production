// Node counterparts of the fixture wrappers in harness.php (fake websites, in-memory database, no network).
import { htmlEntityDecode } from '../../src/lib/html.js';
import { parseUrl } from '../../src/lib/php.js';
import { clientAnalyze, clientAdd, clientsLoad, clientSaveDetails, clientInventoryKey, clientWebsite } from '../../src/lib/clients.js';
import { openMemoryDb, save, state } from '../../src/lib/db.js';
import { dcsParseVdp, clientImportDcs } from '../../src/lib/importers.js';
import { jsonp, goldenInventory } from '../../src/lib/website.js';
import { importMediaZip } from '../../src/lib/media.js';
import { dcNormalize, dcCleanDescription, dcSync } from '../../src/lib/dealercenter.js';
import { dcsProcessPhotos } from '../../src/lib/photos.js';
import { promptNative, prompt, speechPronunciationGuide } from '../../src/lib/prompts.js';
import { galleryPhotos, enrich, jobError, referenceImageUrl, jobFingerprint } from '../../src/lib/jobs.js';
import { spokespersonClean } from '../../src/lib/spokespersons.js';
import { nativeCues, nativeCaptions } from '../../src/lib/finishing.js';
import { phpJsonEncode } from '../../src/lib/phpjson.js';
import { autoBuild } from '../../src/lib/autobuild.js';
import { pageRender, esc } from '../../src/lib/pages.js';
import { narrationApi, narrationTables, narrationTextDifferences, narrationVoiceSettings } from '../../src/lib/narrations.js';
import { readdirSync, mkdirSync } from 'node:fs';
import { probeImage } from '../../src/lib/images.js';
import { writeZip } from '../../src/lib/zip.js';
import { stripTags, strnatcasecmp, filterValidateInt } from '../../src/lib/php.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { clientFind } from '../../src/lib/clients.js';

const fakeFetch = (pages) => async (url) => {
  const p = pages[url];
  return p ? { code: Number(p.code), body: String(p.body ?? ''), url, headers: String(p.headers ?? '') } : { code: 404, body: '', url, headers: '' };
};
function parityStable(v) {
  const ids = new Map();
  let j = JSON.stringify(v).replace(/\b[a-f0-9]{32}\b/g, (m) => { if (!ids.has(m)) ids.set(m, 'ID' + (ids.size + 1)); return ids.get(m); });
  j = j.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00/g, 'T');
  return JSON.parse(j);
}
function fakeBridge(inp, net) {
  if (inp.op === 'probe') return typeof net.probe === 'object' ? net.probe : { duration: net.probe };
  if (inp.op === 'pad') return net.pad === 'ok' ? { audio_url: 'data:audio/wav;base64,' + Buffer.from('RIFF0000WAVEfmt data').toString('base64') }
    : net.pad === 'bad' ? { audio_url: 'data:audio/mpeg;base64,AAAA' } : { error: 'Narration is longer than the video. Shorten it and make a new preview.' };
  const u = inp.url;
  const k = u.startsWith('https://api.elevenlabs.io/v2/voices') ? 'voices' : u.includes('text-to-speech') ? 'tts' : u === 'https://queue.fal.run/fal-ai/sync-lipsync/v2' ? 'fal_submit' : u.includes('/status') ? 'fal_status' : 'fal_result';
  const r = k === 'voices' ? (net.voices[Number((u.match(/next_page_token=p(\d+)/) ?? [0, 0])[1])] ?? { status: 500 }) : net[k];
  if (r.error !== undefined) return { error: r.error };
  const body = typeof (r.body ?? '') === 'string' ? (r.body ?? '') : JSON.stringify(r.body);
  return { status: r.status, body: Buffer.from(body).toString('base64'), detail: r.detail ?? null };
}
export const wrappers = {
  pageRender: (name, vars) => pageRender(name, vars), esc,
  goldenNativeCues: nativeCues,
  parityNativeCaptions: async (cfg, job, source, offset) => { const work = mkdtempSync(tmpdir() + '/ga-pnc-'); try { return await nativeCaptions(cfg, job, source, work, offset); } finally { rmSync(work, { recursive: true, force: true }); } },
  parityAutoBuild: async (cfg, tables, hf, poll) => {
    const db = openMemoryDb(); narrationTables(db);
    for (const [id, v] of Object.entries(tables.state ?? {})) save(db, id, v);
    for (const t of ['jobs', 'narrations', 'narration_lipsync']) for (const r of tables[t] ?? []) db.prepare(`INSERT INTO ${t} VALUES (?,?,?)`).run(r.id, null, phpJsonEncode(r));
    const log = await autoBuild(db, cfg, {
      poll: async (id) => { if ((poll[id] ?? 'ok') !== 'ok') throw new Error(String(poll[id])); return []; },
      hfStatus: async (rid) => { const r = hf[rid] ?? null; if (r === null || typeof r !== 'object') throw new Error(String(r ?? 'no answer')); return r; },
    });
    const dump = {};
    for (const t of ['jobs', 'narration_lipsync']) for (const r of db.prepare(`SELECT payload FROM ${t} ORDER BY rowid`).all()) (dump[t] ??= []).push(JSON.parse(r.payload));
    return parityStable({ log, db: dump });
  },
  galleryPhotos, jobError, referenceImageUrl, spokespersonClean, jobFingerprint,
  parityEnrich: async (v, html) => { const r = await enrich(v, async () => html); delete r.detail_checked_at; return r; },
  promptNative, prompt, speechPronunciationGuide,
  narrationTextDifferences, narrationVoiceSettings,
  async parityNarrations(setup, steps, net, cfgExtra) {
    const dir = mkdtempSync(tmpdir() + '/ga-nnr-'); mkdirSync(dir + '/assets');
    const cfg = { ...cfgExtra, asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343', elevenlabs_key: 'EL', fal_key: 'FK' };
    const db = openMemoryDb();
    for (const [id, v] of Object.entries(setup.state)) save(db, id, v);
    for (const j of setup.jobs) db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(j.id, null, JSON.stringify(j));
    const out = [];
    try {
      narrationTables(db);
      for (const [action, input0] of steps) {
        const input = { ...input0 };
        for (const [k, v] of Object.entries(input)) if (v === '@preview' || v === '@lipsync') {
          const row = db.prepare(`SELECT id FROM ${v === '@preview' ? 'narrations' : 'narration_lipsync'} ORDER BY rowid DESC LIMIT 1`).get();
          input[k] = row ? row.id : 'missing';
        }
        try { out.push({ ok: await narrationApi(action, input, cfg, db, { bridge: (x) => fakeBridge(x, net) }) }); } catch (e) { out.push({ error: e.message }); }
      }
      const dump = {};
      for (const t of ['narrations', 'narration_lipsync', 'jobs']) {
        const rows = db.prepare(`SELECT id, fingerprint IS NULL AS free, payload FROM ${t} ORDER BY rowid`).all();
        if (rows.length) dump[t] = rows.map((r) => [r.id, r.free, JSON.parse(r.payload)]);
      }
      let files = 0; try { files = readdirSync(dir + '/assets/narrations').length; } catch { /* none */ }
      return parityStable({ steps: out, db: dump, files });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  dcNormalize, dcCleanDescription,
  async parityPhotoWorker(cars, photos, labels, img, other) {
    const dir = mkdtempSync(tmpdir() + '/ga-npw-'); mkdirSync(dir + '/assets');
    const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343' };
    const db = openMemoryDb();
    save(db, 'inventory:lr', { vehicles: cars }); if (other && Object.keys(other).length) save(db, 'other', other);
    const fetchFn = async (u) => { const k = photos[u] ?? 'missing'; if (k === 'missing') return { code: 404, body: '', url: u, headers: '' };
      return { code: 200, bodyBuffer: k === 'bad' ? Buffer.from('x'.repeat(2000)) : Buffer.from(img[k], 'base64'), body: '', url: u, headers: '' }; };
    const classify = labels.length ? (paths) => Object.fromEntries(paths.map((p, i) => [p, labels[i % labels.length]])) : () => null;
    try {
      const log = await dcsProcessPhotos(db, cfg, 50, fetchFn, classify);
      const inv = state(db, 'inventory:lr');
      for (const v of inv.vehicles) { v.photos = (v.photos ?? []).length; if (v.photos_checked_at !== undefined) v.photos_checked_at = 'set'; }
      return { log, inventory: inv, files: readdirSync(dir + '/assets').filter((f) => f.endsWith('.jpg')).length };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  async parityDcSync(prior, steps, jpg) {
    const dir = mkdtempSync(tmpdir() + '/ga-ndc-');
    mkdirSync(dir + '/assets'); mkdirSync(dir + '/zips');
    const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343' };
    const db = openMemoryDb();
    if (prior.length) save(db, 'inventory', { vehicles: prior });
    const out = [];
    try {
      for (const st of steps) {
        for (const f of readdirSync(dir + '/zips')) rmSync(dir + '/zips/' + f);
        for (const [stock, n] of Object.entries(st.zips)) writeFileSync(`${dir}/zips/${stock}.zip`, writeZip(Array.from({ length: n }, (_, i) => [`p${i + 1}.jpg`, Buffer.from(jpg, 'base64')])));
        const dl = async (urls) => { const o = {}; urls.forEach((u, i) => { if (!st.fail.includes(u.split('/').pop().replace(/\.jpg$/, ''))) o[i] = Buffer.from(jpg, 'base64'); }); return o; };
        let r;
        try { const log = await dcSync(db, cfg, st.snapshot, dir + '/zips', dl); delete log.at; r = { log }; } catch (e) { r = { error: e.message }; }
        const inv = state(db, 'inventory');
        if (inv) {
          delete inv.dealercenter_checked_at;
          for (const v of inv.vehicles) {
            v.photos = (v.photos ?? []).length;
            for (const k of ['imported_at', 'detail_checked_at', 'dc_checked_at', 'price_changed_at', 'removed_at']) if (v[k] !== undefined && v[k] !== null) v[k] = 'set';
            delete v.original_filenames;
          }
        }
        const sheets = {};
        for (const row of db.prepare("SELECT id, payload FROM state WHERE id LIKE 'sheet:%' ORDER BY id").all()) sheets[row.id] = JSON.parse(row.payload).photo_count;
        Object.assign(r, { inventory: inv, sheets, files: readdirSync(dir + '/assets').filter((f) => f.endsWith('.jpg')).length, log_entries: (state(db, 'sync_log')?.entries ?? []).length });
        out.push(r);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    return out;
  },
  strip_tags: stripTags,
  strnatcasecmp: (a, b) => Math.sign(strnatcasecmp(a, b)),
  parityFilterInt: (v) => filterValidateInt(v),
  parityImportMedia(fields, files, img) {
    const dir = mkdtempSync(tmpdir() + '/ga-nim-');
    const zip = dir + '/m.zip';
    writeFileSync(zip, writeZip(Object.entries(files).map(([n, k]) => [n, k === 'bad' ? Buffer.from('not an image') : Buffer.from(img[k], 'base64')])));
    const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343' };
    try {
      const v = importMediaZip(zip, fields, cfg);
      v.photos = v.photos.map((u) => { const s = probeImage(readFileSync(cfg.asset_dir + '/' + u.split('/').pop())); return [s.width, s.height, 'image/jpeg']; });
      delete v.imported_at; delete v.detail_checked_at;
      return v;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  dcsParseVdp,
  jsonp,
  parityGoldenInventory(source, pages) {
    return goldenInventory(source, async (u) => { if (!Object.hasOwn(pages, u)) throw new Error('Remote request failed (HTTP 404).'); return String(pages[u]); });
  },
  async parityImportDcs(client, first, second, prior) {
    const db = openMemoryDb();
    save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, client] });
    if (prior.length) save(db, clientInventoryKey(client.id), { vehicles: prior });
    const out = [];
    for (const pages of [first, second]) {
      try { out.push((await clientImportDcs(db, client, fakeFetch(pages))).report); } catch (e) { out.push({ error: e.message }); }
    }
    const inv = state(db, clientInventoryKey(client.id));
    if (inv) { delete inv.checked_at; for (const v of inv.vehicles) { delete v.imported_at; delete v.detail_checked_at; } }
    return { reports: out, inventory: inv, dealer: clientFind(db, client.id).dealer ?? null };
  },
  clientInventoryKey,
  clientWebsite,
  html_entity_decode: htmlEntityDecode,
  parityParseUrl(u) {
    const p = parseUrl(u);
    if (p === false) return false;
    return Object.fromEntries(['scheme', 'user', 'pass', 'host', 'port'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  },
  async parityClientAnalyze(website, pages) { const a = await clientAnalyze(website, fakeFetch(pages)); delete a.checked_at; return a; },
  async parityClientAdd(items, name, website, pages) {
    const db = openMemoryDb();
    if (items.length) save(db, 'clients', { items });
    const c = await clientAdd(db, name, website, fakeFetch(pages));
    delete c.created_at; delete c.analysis.checked_at;
    return { client: c, ids: clientsLoad(db).items.map((x) => x.id) };
  },
  paritySaveDetails(id, input) {
    const db = openMemoryDb();
    save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'x', name: 'X Motors', website: 'https://x.com' }] });
    const c = clientSaveDetails(db, id, input);
    return [c, state(db, 'clients')];
  },
};
