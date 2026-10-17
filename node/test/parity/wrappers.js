// Node counterparts of the fixture wrappers in harness.php (fake websites, in-memory database, no network).
import { htmlEntityDecode } from '../../src/lib/html.js';
import { parseUrl } from '../../src/lib/php.js';
import { clientAnalyze, clientAdd, clientsLoad, clientSaveDetails, clientInventoryKey, clientWebsite } from '../../src/lib/clients.js';
import { openMemoryDb, save, state } from '../../src/lib/db.js';

const fakeFetch = (pages) => async (url) => {
  const p = pages[url];
  return p ? { code: Number(p.code), body: String(p.body ?? ''), url, headers: String(p.headers ?? '') } : { code: 404, body: '', url, headers: '' };
};
export const wrappers = {
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
