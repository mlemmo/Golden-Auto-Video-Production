// Golden Auto inventory snapshot, built in Chrome in three steps in ONE tab (the data is carried between sites in the
// tab's window.name, so nothing is copied by hand). See docs/INVENTORY_SYNC.md.
//
//   Step 1  on DealerCenter's Active Inventory report (press Run first):        await step1DealerCenterList()
//   Step 2  on https://www.mygoldenauto.net/ (same tab, page loaded):           await step2WebsiteDetails()
//   Step 3  on the staging (or production) dashboard, signed in as an admin:     await step3Import()
//
// Which cars are in stock comes from DealerCenter ("In Inventory" status only; In Recon and Inbound are not for
// sale yet). Details and photos come from each car's website page. A car In Inventory that the website does not
// show yet is sent as { list_only: true } so the sync keeps it (or reports it as waiting) instead of hiding it.
// No cost or valuation fields are read. Each step returns a short summary and a SHA-256 of what it stored.

async function sha12(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** Step 1 (DealerCenter report): the In Inventory list → window.name. */
async function step1DealerCenterList() {
  const titles = [...document.querySelectorAll('a, span, div')].filter((e) => e.children.length === 0 && /^(19|20)\d\d [A-Z]/.test(e.textContent.trim()) && e.textContent.trim().length < 90);
  const cars = [], seen = new Set();
  for (const t of titles) {
    let box = t;
    for (let i = 0; i < 12 && box; i++) { box = box.parentElement; if (box && /Stock #/.test(box.innerText) && /Status/.test(box.innerText)) break; }
    if (!box) continue;
    const lines = box.innerText.split('\n').map((l) => l.trim());
    const get = (k) => (lines.find((l) => l.startsWith(k)) ?? '').slice(k.length).trim();
    const stock = get('Stock #');
    if (!stock || seen.has(stock)) continue;
    seen.add(stock);
    cars.push({ stock, vin: get('Vin'), title: t.textContent.trim(), status: get('Status') });
  }
  const total = Number(document.body.innerText.match(/(\d+) Results Found/)?.[1] ?? 0);
  if (!cars.length || (total && cars.length !== total)) throw new Error(`Read ${cars.length} of ${total} cars: show all rows on one page (page size 50) and Run the report again.`);
  const inInventory = cars.filter((c) => c.status === 'IN INVENTORY');
  const json = JSON.stringify({ dc: inInventory });
  window.name = json;
  return { report: cars.length, in_inventory: inInventory.length, other: cars.filter((c) => c.status !== 'IN INVENTORY').map((c) => `${c.stock} ${c.status}`), sha: await sha12(json) };
}

/** Step 2 (mygoldenauto.net): details of the DealerCenter cars from their website pages → window.name (snapshot). */
async function step2WebsiteDetails() {
  const dc = JSON.parse(window.name || '{}').dc;
  if (!Array.isArray(dc) || !dc.length) throw new Error('Run step 1 on the DealerCenter report in this tab first.');
  const links = {};
  for (const a of document.querySelectorAll('a[href*="/inventory/"]')) {
    const x = a.href.match(/\/inventory\/[^/]+\/[^/]+\/([A-Za-z0-9-]+)\/?$/);
    if (x) links[x[1].toUpperCase()] = a.href;
  }
  // The description as text, without the page's scripts (Cloudflare puts one inside it).
  const text = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('script,style,noscript').forEach((s) => s.remove());
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    c.querySelectorAll('p,div,li,h1,h2,h3,h4').forEach((b) => b.append('\n\n'));
    return c.textContent.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const snap = [], listOnly = [];
  for (const car of dc) {
    const url = links[car.stock.toUpperCase()];
    if (!url) { snap.push({ stock: car.stock, vin: car.vin, title: car.title, list_only: true }); listOnly.push(car.stock); continue; }
    const d = new DOMParser().parseFromString(await (await fetch(url, { credentials: 'include' })).text(), 'text/html');
    const f = {};
    for (const l of d.querySelectorAll('.dws-vehicle-fields-label')) {
      const k = l.textContent.trim(), row = l.closest('.row') ?? l.parentElement;
      if (!(k in f)) f[k] = row.textContent.replace(/\s+/g, ' ').trim().slice(k.length).trim();
    }
    const ld = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } }).find((x) => x && x['@type'] === 'AutoDealer');
    const offer = ld?.makesOffer ?? {}, item = offer.itemOffered ?? {};
    // Photos in the page's own gallery order (the order the sync's photo key was made with).
    const ids = [...new Set([...d.querySelectorAll('li.dws-media-slide-image')].map((li) => (li.getAttribute('data-thumb') || '').match(/([0-9]{6}-[a-f0-9]{32})\.jpg/)?.[1]).filter(Boolean))];
    const pagePrice = Number(d.querySelector('.dws-vdp-single-field-value-vehicleprice')?.textContent.replace(/[^0-9.]/g, ''));
    const name = (item.name || '').split(' ');
    snap.push({
      stock: car.stock, vin: item.vehicleIdentificationNumber || car.vin, year: Number(f['Year'] || item.modelDate), make: f['Make'] || name[1] || '', model: f['Model'] || name.slice(2).join(' '),
      trim: f['Trim'] || '', drivetrain: f['Drivetrain'] || '', color: f['Exterior Color'] || item.color || '',
      mileage: f['Mileage'] ? Number(f['Mileage'].replace(/[^0-9]/g, '')) : null,
      prices: [pagePrice, Number(offer.priceSpecification?.price)].filter((p) => p > 0),
      description: text(d.querySelector('.dws-vdp-seller-notes-container')),
      photo_urls: ids.map((i) => 'https://imagescf.dealercenter.net/1600/1200/' + i + '.jpg'), page_url: url,
    });
  }
  const notInStock = Object.keys(links).filter((s) => !dc.some((c) => c.stock.toUpperCase() === s));
  const json = JSON.stringify(snap);
  window.name = json;
  return { cars: snap.length, with_details: snap.length - listOnly.length, list_only: listOnly, on_website_not_in_stock: notInStock,
    no_photos: snap.filter((s) => !s.list_only && !s.photo_urls.length).map((s) => s.stock), bytes: json.length, sha: await sha12(json) };
}

/** Step 3 (dashboard, admin): send the snapshot to the import (runs in the background; see Inventory changes). */
async function step3Import() {
  const json = window.name;
  const snapshot = JSON.parse(json || 'null');
  if (!Array.isArray(snapshot) || !snapshot.length) throw new Error('Run steps 1 and 2 in this tab first.');
  const r = await fetch('/api/node/snapshot_import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.GA.csrf }, body: JSON.stringify({ client: 'golden-auto', snapshot }) });
  return { status: r.status, sha: await sha12(json), answer: await r.json() };
}
