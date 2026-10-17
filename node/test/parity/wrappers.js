// Node counterparts of the fixture wrappers in harness.php (fake websites, in-memory database, no network).
import { htmlEntityDecode } from '../../src/lib/html.js';
import { parseUrl } from '../../src/lib/php.js';
import { clientAnalyze, clientAdd, clientsLoad, clientSaveDetails, clientInventoryKey, clientWebsite } from '../../src/lib/clients.js';
import { openMemoryDb, save, state } from '../../src/lib/db.js';
import { dcsParseVdp, clientImportDcs } from '../../src/lib/importers.js';
import { jsonp, goldenInventory } from '../../src/lib/website.js';
import { importMediaZip } from '../../src/lib/media.js';
import { dcNormalize, dcCleanDescription, dcSync } from '../../src/lib/dealercenter.js';
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
export const wrappers = {
  dcNormalize, dcCleanDescription,
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
