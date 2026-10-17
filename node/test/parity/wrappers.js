// Node counterparts of the fixture wrappers in harness.php (fake websites, in-memory database, no network).
import { htmlEntityDecode } from '../../src/lib/html.js';
import { parseUrl } from '../../src/lib/php.js';
import { clientAnalyze, clientAdd, clientsLoad, clientSaveDetails, clientInventoryKey, clientWebsite } from '../../src/lib/clients.js';
import { openMemoryDb, save, state } from '../../src/lib/db.js';
import { dcsParseVdp, clientImportDcs } from '../../src/lib/importers.js';
import { jsonp, goldenInventory } from '../../src/lib/website.js';
import { importMediaZip } from '../../src/lib/media.js';
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
