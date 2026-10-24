// Golden Auto inventory snapshot, built in Chrome in three steps in ONE tab (the data is carried between sites in the
// tab's window.name, so nothing is copied by hand). See docs/INVENTORY_SYNC.md.
//
//   Step 1  on DealerCenter's Active Inventory report (it presses Run itself):  await step1DealerCenterList()
//   Step 2  on https://www.mygoldenauto.net/ (same tab, page loaded):           await step2WebsiteDetails()
//   Step 3  on the staging (or production) dashboard, signed in as an admin:     await step3Import()
//
// DealerCenter is the authority (user, 2026-10-24): which cars are in stock ("In Inventory" only; In Recon and
// Inbound are not for sale yet) and every detail — year, make, model, trim, drive, colour, mileage, price (vehicle
// price plus the dealer fee, as advertised), description — come from DealerCenter. Only the photo list and the page
// address come from the website (its gallery shows DealerCenter's photos in their order); a car the website does
// not show yet keeps the photos the app has (keep_photos). No cost or valuation fields are read. Each step returns a short summary and a SHA-256 of what it stored.

async function sha12(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/**
 * Step 1 (DealerCenter report): the In Inventory cars with their details, all from DealerCenter (the authority):
 * the report's own data (year, make, model, trim, VIN, stock, colour, mileage, price, status, description) and, per
 * car, its inventory record (drive and dealer fee; the advertised price is the vehicle price plus the fee, as on the
 * website). It presses Run itself and reads the replies DealerCenter's page receives, with the page's own sign-in;
 * cost, valuation and flooring fields are never read. → window.name
 */
async function step1DealerCenterList() {
  const SAFE = ['InventoryId', 'StockNumber', 'Vin', 'Year', 'Make', 'Model', 'Trim', 'ExteriorColor', 'Mileage', 'Odometer', 'VehiclePrice', 'InventoryStatus', 'OnlineMarketingDescription'];
  // Catch the report's reply (and the headers the page sends) when Run is pressed.
  const seen = await new Promise((resolve, reject) => {
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send, setH = XMLHttpRequest.prototype.setRequestHeader;
    const restore = () => { XMLHttpRequest.prototype.open = open; XMLHttpRequest.prototype.send = send; XMLHttpRequest.prototype.setRequestHeader = setH; };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { (this.__h ??= {})[k] = v; return setH.apply(this, arguments); };
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      const x = this;
      if (/InventoryCustomReport\/GetInventoryDetailedReport/.test(x.__u)) x.addEventListener('load', () => { restore(); try { resolve({ data: JSON.parse(x.responseText), headers: x.__h ?? {} }); } catch (e) { reject(e); } });
      return send.apply(this, arguments);
    };
    const run = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run');
    if (!run) { restore(); reject(new Error('Open DealerCenter → Reports → Active Inventory first.')); return; }
    run.click();
    setTimeout(() => { restore(); reject(new Error('The report did not answer within 30 seconds; press Run and try again.')); }, 30000);
  });
  const rows = seen.data.Data ?? [];
  if (!rows.length || rows.length !== seen.data.Total) throw new Error(`The report sent ${rows.length} of ${seen.data.Total} cars: set the page size to 50 and run again.`);
  const headers = Object.fromEntries(Object.entries(seen.headers).filter(([k]) => /^(Authorization|X-XSRF-TOKEN|DC-User|dc-location|timezone|Accept)$/i.test(k)));
  const record = (id) => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api-gateway/inventory/Inventory/LoadInventoryById');
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { resolve(null); } };
    x.onerror = () => resolve(null);
    x.send(JSON.stringify({ inventoryId: id, loadOption: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11, 20], setIsCurrentForBook: false }));
  });
  const text = (html) => { const d = new DOMParser().parseFromString(String(html ?? ''), 'text/html'); d.querySelectorAll('script,style').forEach((s) => s.remove()); d.querySelectorAll('br').forEach((b) => b.replaceWith('\n')); d.querySelectorAll('p,div,li,h1,h2,h3,h4').forEach((b) => b.append('\n\n')); return (d.body?.textContent ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(); };
  const cars = [], other = [], problems = [];
  for (const full of rows) {
    const r = Object.fromEntries(SAFE.map((k) => [k, full[k]]));
    if (r.InventoryStatus !== 'IN INVENTORY') { other.push(`${r.StockNumber} ${r.InventoryStatus}`); continue; }
    const inv = await record(r.InventoryId);
    // Dealer fees (doc, smog…) are part of the advertised price; the total can be blank (2018 Expedition), so the
    // fees themselves are added up then.
    const feeSum = (inv?.dealerFees ?? []).reduce((t, f) => t + (Number(f?.amount) || 0), 0);
    const fee = inv && inv.isFeeIncluded !== false ? Number(inv.totalDealerFee ?? feeSum) || 0 : 0;
    const drive = inv?.vehicleBuilds?.find((b) => b?.driveTrain)?.driveTrain ?? '';
    if (!inv) problems.push(r.StockNumber + ': inventory record not read (drive and fee missing)');
    const price = Number(r.VehiclePrice) || 0;
    cars.push({ stock: r.StockNumber, vin: r.Vin, year: r.Year, make: r.Make, model: r.Model, trim: r.Trim ?? '', drivetrain: drive, color: r.ExteriorColor ?? '',
      mileage: r.Mileage ?? r.Odometer ?? null, prices: price > 0 ? [Math.round((price + fee) * 100) / 100, price] : [], description: text(r.OnlineMarketingDescription) });
  }
  const json = JSON.stringify({ dc: cars });
  window.name = json;
  return { report: rows.length, in_inventory: cars.length, other, problems, sha: await sha12(json) };
}

/**
 * Step 2 (mygoldenauto.net): each car's photos (the website gallery shows DealerCenter's photos, in their order) and
 * page address. Every other detail stays as DealerCenter gave it. A car the website does not show yet keeps the
 * photos the app already has (keep_photos). → window.name (the snapshot)
 */
async function step2WebsiteDetails() {
  const dc = JSON.parse(window.name || '{}').dc;
  if (!Array.isArray(dc) || !dc.length) throw new Error('Run step 1 on the DealerCenter report in this tab first.');
  const links = {};
  for (const a of document.querySelectorAll('a[href*="/inventory/"]')) {
    const x = a.href.match(/\/inventory\/[^/]+\/[^/]+\/([A-Za-z0-9-]+)\/?$/);
    if (x) links[x[1].toUpperCase()] = a.href;
  }
  const snap = [], keep = [];
  for (const car of dc) {
    const url = links[String(car.stock).toUpperCase()];
    if (!url) { snap.push({ ...car, keep_photos: true }); keep.push(car.stock); continue; }
    const d = new DOMParser().parseFromString(await (await fetch(url, { credentials: 'include' })).text(), 'text/html');
    const ids = [...new Set([...d.querySelectorAll('li.dws-media-slide-image')].map((li) => (li.getAttribute('data-thumb') || '').match(/([0-9]{6}-[a-f0-9]{32})\.jpg/)?.[1]).filter(Boolean))];
    if (!ids.length) { snap.push({ ...car, keep_photos: true, page_url: url }); keep.push(car.stock); continue; }
    snap.push({ ...car, photo_urls: ids.map((i) => 'https://imagescf.dealercenter.net/1600/1200/' + i + '.jpg'), page_url: url });
  }
  const notInStock = Object.keys(links).filter((s) => !dc.some((c) => String(c.stock).toUpperCase() === s));
  const json = JSON.stringify(snap);
  window.name = json;
  return { cars: snap.length, with_website_photos: snap.length - keep.length, keep_photos: keep, on_website_not_in_stock: notInStock, bytes: json.length, sha: await sha12(json) };
}

/** Step 3 (dashboard, admin): send the snapshot to the import (runs in the background; see Inventory changes). */
async function step3Import() {
  const json = window.name;
  const snapshot = JSON.parse(json || 'null');
  if (!Array.isArray(snapshot) || !snapshot.length) throw new Error('Run steps 1 and 2 in this tab first.');
  const r = await fetch('/api/node/snapshot_import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.GA.csrf }, body: JSON.stringify({ client: 'golden-auto', snapshot }) });
  return { status: r.status, sha: await sha12(json), answer: await r.json() };
}
