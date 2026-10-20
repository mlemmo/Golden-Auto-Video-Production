// Browser snapshot reader for Golden Auto (mygoldenauto.net, a DealerCenter website that blocks the server).
// Run in Chrome on https://www.mygoldenauto.net/ (e.g. with Claude in Chrome's javascript tool). Leaves the snapshot
// in window.__ga_snapshot: listing facts, highest advertised prices, seller notes with their line breaks, and every
// gallery photo URL; no cost or valuation fields. Trim and colour come in capitals from the site and are put in
// normal case here (codes such as TDI, 4D, AWD stay as they are). Then copy it to a signed-in staging/production tab
// (clipboard), check its SHA-256 fingerprint on both sides, and POST it to /api/node/snapshot_import with
// { client: 'golden-auto', snapshot } (admin), or save it as JSON and run node src/cli/dealercenter-sync.js.
// New cars need sheet_photos (1-based: front, side, other side, rear); look at their gallery first.
(async () => {
  const src = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).find((s) => s.includes('cb=dws_inventory_listing_') && s.startsWith('/inv-scripts-v2/inv/vehicles?'));
  const t = await (await fetch(src, { credentials: 'include' })).text();
  const m = t.trim().match(/^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/);
  const d = JSON.parse(m ? m[1] : t);
  const list = Array.isArray(d.Vehicles) ? d.Vehicles : Object.values(d.Vehicles || {});
  const KEEP = new Set(['TDI', 'AWD', 'FWD', 'RWD', '4WD', '4X4', 'SUV', 'XLT', 'LTZ', 'SR5', 'TRD', 'XLE', 'LE', 'SE', 'GT', 'RS', 'SS', 'AMG', 'STI', 'GTI', 'TSI', 'HSE', 'EX', 'LX', 'EXL', 'SV', 'SL', 'LT', 'LS', 'XV', 'MAX']);
  const part = (w) => (/\d/.test(w) || KEEP.has(w) || w.length === 1 || (w.length <= 3 && !/[AEIOUY]/.test(w)) ? w : w.charAt(0) + w.slice(1).toLowerCase());
  const tc = (s) => String(s || '').split(' ').map((w) => w.split('-').map(part).join('-')).join(' ');
  const notesText = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    c.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li').forEach((b) => b.append('\n\n'));
    return c.textContent.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const snap = [];
  for (const v of list) {
    const path = '/inventory/' + [v.Make, v.Model, v.StockNumber].map((s) => encodeURIComponent(String(s).toLowerCase().replaceAll(' ', '-'))).join('/') + '/';
    const doc = new DOMParser().parseFromString(await (await fetch(path, { credentials: 'include' })).text(), 'text/html');
    const photos = [];
    for (const box of doc.querySelectorAll('[id^="DWS_VDP_Media_"]')) for (const n of box.querySelectorAll('[data-pin-media],[data-base-img-url]')) {
      const u = n.getAttribute('data-pin-media') || n.getAttribute('data-base-img-url');
      if (u && u.startsWith('https://imagescf.dealercenter.net/') && !photos.includes(u)) photos.push(u);
    }
    const notes = [...doc.querySelectorAll('.dws-vdp-seller-notes-container')].pop();
    snap.push({ stock: String(v.StockNumber), vin: v.Vin || '', year: v.Year, make: v.Make, model: v.Model, trim: tc(v.Trim), drivetrain: v.Drivetrain || '', color: tc(v.ExteriorColor),
      mileage: v.Odometer ?? null, prices: [v.VehiclePrice, v.TotalPrice, v.TotalAskingPrice, v.TotalAdvertisingPrice].filter((p) => typeof p === 'number' && p > 0),
      description: notes ? notesText(notes) : '', photo_urls: photos });
  }
  window.__ga_snapshot = snap;
  return snap.length + ' cars read';
})();
