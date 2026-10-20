// Browser snapshot reader for Dealer.com websites (e.g. Eastbay Motorcars, eastbaymotorcars.net, which blocks the
// server). Run in Chrome on the site's /used-inventory/index.htm. Every car is in DDC.dataLayer.vehicles; each car's
// own page (loaded in a hidden frame) has its full gallery. The highest advertised price includes the site's listed
// fees (pricing.finalPrice). Cars whose only photo is the site's "coming soon" placeholder get photo_count 0.
// Photo 1 is a branded banner (logo, website, phone): always send sheet_photos that skip it. Result in
// window.__ga_snapshot; send it like the Golden Auto reader with { client: '<client id>', snapshot }.
(async () => {
  const load = (link) => new Promise((resolve) => {
    const f = document.createElement('iframe'); f.style.cssText = 'position:absolute;width:10px;height:10px;left:-9999px'; f.src = link;
    const t = setTimeout(() => { f.remove(); resolve(null); }, 30000);
    f.onload = async () => {
      for (let i = 0; i < 40; i++) { if (f.contentWindow?.DDC?.dataLayer?.vehicles?.[0]?.images?.length) break; await new Promise((r) => setTimeout(r, 250)); }
      const v = f.contentWindow?.DDC?.dataLayer?.vehicles?.[0];
      clearTimeout(t); f.remove();
      resolve(v ? { vin: v.vin, images: (v.images || []).map((i) => i.uri) } : null);
    };
    document.body.appendChild(f);
  });
  const list = DDC.dataLayer.vehicles, galleries = {};
  for (let round = 0; round < 4; round++) {
    const todo = list.filter((v) => !galleries[v.vin]);
    if (!todo.length) break;
    await Promise.all([0, 1, 2].map(async (k) => { for (let i = k; i < todo.length; i += 3) { const r = await load(todo[i].link); if (r && r.vin === todo[i].vin) galleries[r.vin] = r.images; } }));
  }
  const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };
  const counts = {};
  for (const imgs of Object.values(galleries)) if (imgs.length === 1) counts[imgs[0]] = (counts[imgs[0]] ?? 0) + 1;
  window.__ga_snapshot = list.map((v) => {
    const s = { stock: String(v.stockNumber), vin: v.vin, year: v.modelYear ?? v.year, make: v.make, model: v.model, trim: v.trim ?? '', drivetrain: v.driveLine ?? '', color: v.exteriorColor ?? '',
      mileage: v.odometer ?? null, prices: [num(v.internetPrice), num(v.askingPrice), num(v.pricing?.finalPrice)].filter((x) => x !== null), photo_urls: galleries[v.vin] ?? [] };
    if (s.photo_urls.length === 1 && counts[s.photo_urls[0]] > 1) { delete s.photo_urls; s.photo_count = 0; }  // shared placeholder
    return s;
  });
  return window.__ga_snapshot.length + ' cars read, ' + Object.keys(galleries).length + ' galleries';
})();
