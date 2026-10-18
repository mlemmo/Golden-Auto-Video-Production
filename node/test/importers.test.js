// Port of the Dealer Car Search parts of tests/importers.php (the photo worker is still PHP), plus Golden Auto's
// website reader. No network: websites are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb, save, state } from '../src/lib/db.js';
import { clientFind, clientInventory } from '../src/lib/clients.js';
import { dcsParseVdp, dcsSitemapName, dcsPageError, clientImportDcs } from '../src/lib/importers.js';
import { goldenInventory, syncInventory } from '../src/lib/website.js';

const page = (id, year, make, model, price, stock, miles, photos = 3) =>
  '<html><meta charset="utf-8"><script>var init_utag_data = { "site_company_name": "eLeaseReturns", "site_company_city": "San Ramon", "site_company_state": "CA", "site_phone_main": "800-407-0303",'
  + ` "product_make": "${make}", "product_model": "${model}", "product_year": "${year}", "product_price": "${price}", "product_condition": "USED", "product_id": "${id}", };</script>`
  + '<ul><li class="detailOptTrim"><label>Trim:</label> S COUPE**LIFT**HEAT SEATS</li><li class="detailOptColor"><label>Color:</label> CHALK</li>'
  + `<li class="detailOptDrive"><label>Drive Train:</label> RWD</li><li class="detailOptMPG"><label>Mileage:</label> ${miles}</li>`
  + `<li class="detailOptStock"><label>Stock #:</label> ${stock}</li><li class="detailOptVin"><label>Vin:</label> VIN${stock}</li></ul>`
  + `<div class="i05r_detailPrice"><span class="price">$${Number(price).toLocaleString('en-US')}</span></div>`
  + '<form><span class="price">$999,999</span></form><div class="i05r_detailNotes">Vehicle Description CLEAN CARFAX. WE CHARGE A $80.00 DOC FEE.</div>'
  + Array.from({ length: photos }, (_, i) => `<img data-src='https://imagescdn.dealercarsearch.com/Media/3073/${id}/p${i + 1}.jpg'>`).join('')
  + '<img src="https://imagescdn.dealercarsearch.com/Media/3073/999/other.jpg"></html>';

test('vehicle facts from a listing page', () => {
  const v = dcsParseVdp(page('1', '2026', 'Porsche', '911', '177995.00', '0931', '2,599', 10), 'https://lr.com/vdp/1/x');
  assert.deepEqual([v.Year, v.Make, v.Model, v.Trim, v.StockNumber, v.Vin, v.Odometer], [2026, 'PORSCHE', '911', 'S COUPE', '0931', 'VIN0931', 2599]);
  assert.equal(v.price, 177995, 'the listing price, not the loan calculator inside a form or the fee text');
  assert.equal(v.photo_sources.length, 10);
  assert.ok(!v.photo_sources.some((u) => u.includes('/999/')), 'only this car’s photos');
  assert.equal(v.description, 'CLEAN CARFAX. WE CHARGE A $80.00 DOC FEE.');
  assert.equal(v.dealer.telephone, '800-407-0303');
  assert.throws(() => dcsParseVdp(page('2', 'x', 'Audi', 'Q5', '1', 'S', '1'), 'u'), /missing year, make or model/);
});

test('a sitemap car whose page is gone is named in the import errors', () => {
  const url = 'https://leasereturns.com/vdp/21455939/Used-2020-MercedesBenz-S560-for-sale-in-San-Ramon-CA';
  assert.equal(dcsSitemapName(url), '2020 MercedesBenz S560');
  assert.equal(dcsPageError(url, 'has no year, make or model on the site (it may have been sold)'),
    '2020 MercedesBenz S560 is listed in the website’s sitemap, but its page has no year, make or model on the site (it may have been sold): ' + url);
  assert.match(dcsPageError('https://lr.com/vdp/1/Used-Car', 'could not be loaded (HTTP 404)'), /^A vehicle is listed/);
});

test('website import: new, updated and sold cars; photos left to the photo worker', async () => {
  const db = openMemoryDb();
  save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' },
    { id: 'lr', name: 'LR', website: 'https://lr.com', analysis: { sitemap: 'https://lr.com/sitemap', platform: 'Dealer Car Search', reachable: true } }] });
  const site = {
    'https://lr.com/sitemap': '<loc>https://lr.com/vdp/1/Used-2026-Porsche-911</loc><loc>https://lr.com/vdp/2/Used-2023-Audi-Q5</loc><loc>https://lr.com/bdp/9/blog</loc>',
    'https://lr.com/vdp/1/Used-2026-Porsche-911': page('1', '2026', 'Porsche', '911', '177995.00', '0931', '2,599', 10),
    'https://lr.com/vdp/2/Used-2023-Audi-Q5': page('2', '2023', 'Audi', 'Q5', '31995.00', '0944', '18,250'),
  };
  const fetched = [];
  const fetchFn = async (url) => { fetched.push(url); return Object.hasOwn(site, url) ? { code: 200, body: site[url], url, headers: '' } : { code: 404, body: '', url, headers: '' }; };
  const r = await syncInventory(db, {}, 'lr', { fetchFn });
  assert.deepEqual(r.report, { added: 2, updated: 0, gone: 0, errors: [] }, 'both cars, blog page ignored');
  assert.ok(!fetched.some((u) => u.endsWith('.jpg')), 'no photo downloads during the import');
  assert.equal(clientInventory(db, 'lr').vehicles[0].photos_pending, true);
  assert.equal(state(db, 'inventory'), null, 'Golden Auto’s inventory untouched');
  assert.equal(clientFind(db, 'lr').dealer.name, 'eLeaseReturns');
  // The photo worker sorted the Porsche; then the Audi left the website.
  const inv = clientInventory(db, 'lr');
  inv.vehicles[0] = { ...inv.vehicles[0], photos: ['https://x/a.jpg'], photo_sources_done: inv.vehicles[0].photo_sources, photos_pending: false, sheet_photos: [2, 1] };
  save(db, 'inventory:lr', inv);
  delete site['https://lr.com/vdp/2/Used-2023-Audi-Q5'];
  site['https://lr.com/sitemap'] = '<loc>https://lr.com/vdp/1/Used-2026-Porsche-911</loc>';
  const r2 = await clientImportDcs(db, clientFind(db, 'lr'), fetchFn);
  assert.deepEqual([r2.report.updated, r2.report.gone], [1, 1]);
  const byStock = Object.fromEntries(clientInventory(db, 'lr').vehicles.map((v) => [v.StockNumber, v]));
  assert.equal(byStock['0944'].active, false, 'a sold car stays listed as inactive');
  assert.deepEqual([byStock['0931'].photos_pending, byStock['0931'].photos, byStock['0931'].sheet_photos], [false, ['https://x/a.jpg'], [2, 1]], 'unchanged photos kept');
  site['https://lr.com/sitemap'] = '<loc>https://lr.com/about</loc>';
  await assert.rejects(clientImportDcs(db, clientFind(db, 'lr'), fetchFn), /no vehicle pages/);
  await assert.rejects(syncInventory(db, {}, 'nope', { fetchFn }), /Client not found/);
});

test('Golden Auto’s website reader; cars imported by ZIP are kept', async () => {
  const db = openMemoryDb();
  save(db, 'inventory', { vehicles: [{ StockNumber: 'Z1', source: 'zip' }, { StockNumber: '870288', source: 'zip' }, { StockNumber: 'OLD' }] });
  const pages = {
    'https://www.mygoldenauto.net': '<script src="/inv-scripts-v2/inv/vehicles?cb=dws_inventory_listing_7"></script>',
    'https://www.mygoldenauto.net/inv-scripts-v2/inv/vehicles?cb=dws_inventory_listing_7': 'cb_1({"Vehicles":[{"Make":"SUBARU","Model":"XV CROSSTREK","StockNumber":"870288","VehiclePrice":14688.25}],"TotalRecordCount":1});',
  };
  const getText = async (u) => pages[u];
  const r = await syncInventory(db, { source: 'https://www.mygoldenauto.net' }, 'golden-auto', { getText });
  assert.deepEqual(r.vehicles.map((v) => v.StockNumber), ['870288', 'Z1'], 'website list plus ZIP-only cars');
  assert.equal(r.vehicles[0].url, 'https://www.mygoldenauto.net/inventory/subaru/xv-crosstrek/870288/');
  assert.equal(r.vehicles[0].price, 14688.25);
  pages['https://www.mygoldenauto.net'] = '<p>changed</p>';
  await assert.rejects(goldenInventory('https://www.mygoldenauto.net', getText), /format changed/);
});
