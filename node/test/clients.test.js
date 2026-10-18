// Clients (storage, website analysis, adding clients, dealer details). No network: websites are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb } from '../src/lib/db.js';
import { clientsLoad, clientFind, clientInventoryKey, clientInventory, clientAnalyze, clientAdd, clientReanalyze, clientDetails,
  clientWebsiteSpoken, clientSaveDetails, clientWebsite, isPublicIPv4, pinnedLookup } from '../src/lib/clients.js';
import { script } from '../src/lib/scripts.js';
import { speechScript, nativeSpeech, withSpeechSites } from '../src/lib/speech.js';

const site = (pages) => async (url) => {
  for (const [suffix, page] of Object.entries(pages)) if (url.endsWith(suffix)) return { url, headers: '', ...page };
  return { code: 404, body: '', url, headers: '' };
};
const dc = site({
  '.com': { code: 200, body: '<html><script src="/inv-scripts-v2/inv/vehicles?cb=dws_inventory_listing_1"></script>'
    + '<script type="application/ld+json">{"@type":"AutoDealer","name":"Bay Motors","telephone":"555-0100","address":{"addressLocality":"Oakland","addressRegion":"CA"}}</script></html>' },
  '/robots.txt': { code: 200, body: 'Sitemap: https://www.baymotors.com/sitemap.xml' },
  '/sitemap.xml': { code: 200, body: '<loc>https://www.baymotors.com/inventory/ford-f150-1/</loc><loc>https://www.baymotors.com/inventory/kia-soul-2/</loc><loc>https://www.baymotors.com/about</loc>' },
});

test('clients: Golden Auto first, inventory keys', () => {
  const db = openMemoryDb();
  const c = clientsLoad(db);
  assert.equal(c.items.length, 1);
  assert.deepEqual([c.items[0].id, c.items[0].name], ['golden-auto', 'Golden Auto']);
  assert.match(c.items[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/, 'gmdate("c") format');
  assert.equal(clientInventoryKey('golden-auto'), 'inventory');
  assert.equal(clientInventoryKey('bay-motors'), 'inventory:bay-motors');
  assert.throws(() => clientInventoryKey('../x'), /Invalid client/);
  assert.deepEqual(clientInventory(db, 'bay-motors'), { vehicles: [] });
});

test('website analysis recommends an import method', async () => {
  const a = await clientAnalyze('https://www.baymotors.com', dc);
  assert.equal(a.platform, 'DealerCenter');
  assert.equal(a.best, 'feed');
  assert.ok(a.options.some((o) => o.method === 'website_dealercenter'));
  assert.equal(a.dealer.name, 'Bay Motors');
  assert.equal(a.dealer.city, 'Oakland');
  assert.equal(a.vehicle_pages, 2);
  const b = await clientAnalyze('https://www.blocked.com', site({ '.com': { code: 403, body: '<title>Just a moment...</title> cf-chl' } }));
  assert.ok(b.blocked);
  assert.equal(b.best, 'browser_snapshot');
  assert.equal((await clientAnalyze('https://www.plain.com', site({ '.com': { code: 200, body: '<h1>Used cars</h1>' } }))).best, 'zip');
  assert.equal((await clientAnalyze('https://www.ddc.com', site({ '.com': { code: 200, body: '<img src="https://pictures.dealer.com/x.jpg">' } }))).platform, 'Dealer.com (Cox Automotive)');
});

test('adding clients: ids, duplicates, private websites', async () => {
  const db = openMemoryDb();
  const n = await clientAdd(db, 'Bay Motors', 'baymotors.com', dc);
  assert.deepEqual([n.id, n.website, n.analysis.platform], ['bay-motors', 'https://baymotors.com', 'DealerCenter']);
  assert.equal(clientsLoad(db).items.length, 2);
  assert.equal(clientFind(db, 'bay-motors').name, 'Bay Motors');
  await assert.rejects(clientAdd(db, 'bay motors', 'other.com', dc), /already exists/);
  await assert.rejects(clientAdd(db, 'Other', 'https://baymotors.com/cars', dc), /already belongs/);
  await assert.rejects(clientAdd(db, 'Local', 'http://localhost', dc), /website/);
  await assert.rejects(clientAdd(db, '', 'x.com', dc), /client name/);
  const again = await clientReanalyze(db, 'bay-motors', site({ '.com': { code: 403, body: '' } }));
  assert.ok(again.analysis.blocked);
  assert.ok(clientFind(db, 'bay-motors').analysis.blocked, 'saved');
});

test('dealer details in scripts and speech', async () => {
  const db = openMemoryDb();
  await clientAdd(db, 'Bay Motors', 'baymotors.com', dc);
  assert.deepEqual(clientDetails(clientFind(db, 'golden-auto')), { name: 'Golden Auto', city: 'San Ramon', website: 'mygoldenauto.net', website_spoken: 'my golden auto dot net' });
  const bd = clientDetails(clientFind(db, 'bay-motors'));
  assert.deepEqual([bd.name, bd.city, bd.website, bd.website_spoken], ['Bay Motors', 'Oakland', 'baymotors.com', 'bay motors dot com']);
  assert.equal(clientWebsiteSpoken('eleasereturns.com', 'eLease Returns'), 'e lease returns dot com');
  const ed = clientDetails(clientSaveDetails(db, 'bay-motors', { name: 'eLease Returns', city: 'San Ramon', website: 'https://www.eleasereturns.com/', website_spoken: '' }));
  assert.deepEqual([ed.website, ed.website_spoken, ed.city], ['eleasereturns.com', 'e lease returns dot com', 'San Ramon']);
  const car = { Year: 2016, Make: 'LAND ROVER', Model: 'RANGE ROVER SPORT', Trim: 'HSE', Drivetrain: '4WD', ExteriorColor: 'LOIRE BLUE', Odometer: 67351, price: null };
  const s30 = script(car, 30, ed);
  assert.ok(s30.includes('here at eLease Returns in San Ramon.') && s30.includes('at eleasereturns.com.') && !s30.includes('Golden Auto'));
  withSpeechSites({ [ed.website]: ed.website_spoken }, () => {
    assert.ok(speechScript(s30).includes('at e lease returns dot com.'));
    assert.ok(nativeSpeech(s30).includes('e lease returns dot com'));
  });
  assert.throws(() => clientSaveDetails(db, 'golden-auto', { name: 'X', website: 'x.com' }), /fixed/);
  assert.throws(() => clientSaveDetails(db, 'bay-motors', { name: 'X', website: 'not a site' }), /website/);
});

test('fetching only public addresses', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.16.0.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1']) assert.ok(!isPublicIPv4(ip), ip);
  for (const ip of ['50.209.159.73', '8.8.8.8', '172.32.0.1']) assert.ok(isPublicIPv4(ip), ip);
  assert.equal(clientWebsite(' WWW.Example.COM/path '), 'https://www.example.com');
});

test('pinned DNS lookup answers both ways Node asks', () => {
  const l = pinnedLookup('50.209.159.73');
  l('x.com', {}, (e, a, f) => assert.deepEqual([e, a, f], [null, '50.209.159.73', 4]));
  l('x.com', { all: true }, (e, a) => assert.deepEqual([e, a], [null, [{ address: '50.209.159.73', family: 4 }]]));
});
