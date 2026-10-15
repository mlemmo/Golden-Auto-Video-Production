// Golden Auto inventory scraper — stopgap until the DealerCenter XML export arrives.
// HOW TO RUN: open https://www.mygoldenauto.net/ in Chrome, wait for the cars to load,
// open DevTools (F12) > Console, paste this whole file, press Enter.
// It downloads inventory.json in the same shape feed.py expects.
//
// Where the data comes from (checked Oct 2026):
//   - Listing links:  a[href*="/inventory/"] on the home page (cars load via AJAX, so run it on the rendered page)
//   - Specs:          the "Year / Make / Model / Trim / ..." block on each detail page
//   - VIN, body, fuel, base price: the schema.org AutoDealer JSON-LD (makesOffer.itemOffered)
//   - Photos:         https://imagescf.dealercenter.net/{width}/{height}/{DocumentId}.jpg  (no overlays)
//   - Advertised price: the "$xx,xxx.xx *Includes Dealer Fees" figure (JSON-LD price excludes the fee)

(async () => {
  const LABELS = ['Year','Make','Model','Trim','Drivetrain','Transmission','Engine','Mileage','Doors',
                  'Exterior Color','Interior Color','VIN','Stock No\\.','REQUEST'];
  const field = (T, k) => {
    const m = T.match(new RegExp(k + ' (.+?) (?=' + LABELS.join('|') + ')'));
    return m ? m[1].trim() : null;
  };
  const money = s => s ? Number(String(s).replace(/[^0-9.]/g, '')) : null;

  const urls = [...new Set([...document.querySelectorAll('a[href*="/inventory/"]')]
    .map(a => a.href.split('?')[0]))];
  if (!urls.length) {
    if (window.__GA_RETURN) throw new Error('No vehicle links found on page');
    alert('No vehicles found — wait for the inventory to load and run again.'); return;
  }

  const vehicles = [];
  for (const url of urls) {
    const html = await fetch(url).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let offer = null;
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { const j = JSON.parse(s.textContent); if (j.makesOffer) offer = j.makesOffer; } catch (e) {}
    }
    const car = offer ? offer.itemOffered : {};
    const T = doc.body.textContent.replace(/\s+/g, ' ');
    const photoIds = [...new Set((html.match(/imagescf\.dealercenter\.net\/\d+\/\d+\/[^"'&\s]+?\.jpg/g) || [])
      .map(x => x.split('/').pop().replace('.jpg', '')))].filter(id => !id.includes('{'));

    vehicles.push({
      stock: field(T, 'Stock No\\.'),
      vin: car.vehicleIdentificationNumber || field(T, 'VIN'),
      year: Number(field(T, 'Year')),
      make: field(T, 'Make'),
      model: field(T, 'Model'),
      trim: field(T, 'Trim'),
      body: car.bodyType || null,
      fuel: car.fuelType || null,
      drivetrain: field(T, 'Drivetrain'),
      transmission: field(T, 'Transmission'),
      engine: field(T, 'Engine'),
      mileage: money(field(T, 'Mileage')),
      exterior_color: field(T, 'Exterior Color'),
      interior_color: field(T, 'Interior Color'),
      price_advertised: money((T.match(/\$[\d,]+\.\d{2}/) || [])[0]),   // includes dealer fees
      price_base: offer ? offer.priceSpecification.price : null,           // excludes dealer fees
      description: car.description || '',
      url,
      photos: photoIds.map(id => `https://imagescf.dealercenter.net/1920/1080/${id}.jpg`)
    });
  }

  const payload = { source: 'mygoldenauto.net', scraped_at: new Date().toISOString(), vehicles };
  if (window.__GA_RETURN) return payload;          // headless mode (fetch_inventory.py on the server)
  const blob = new Blob([JSON.stringify(payload, null, 2)],
                        { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'inventory.json' });
  a.click();
  console.log(`Saved ${vehicles.length} vehicles`, vehicles);
})();
