import { JPEG_40x30, PNG_20x20_TRANSPARENT, JPEG_1800x900, JPEG_1800x900_B } from '../fixtures/images.js';
// Seeded generator of realistic and awkward inputs for the parity check.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MAKES = ['SUBARU', 'HONDA', 'Toyota', 'MAZDA', 'BMW', 'RAM', 'FORD', 'Chevrolet', 'GMC', 'VOLVO', 'MERCEDES-BENZ', 'Jeep', 'KIA', 'Lexus', 'AUDI', 'NISSAN', 'VOLKSWAGEN'];
const MODELS = ['XV CROSSTREK', 'CR-V', 'CX-30', 'XC90', '1500 CREW CAB', '4RUNNER', 'F-150', '3 SERIES', 'RAV4', 'Civic', 'WRX STI',
  'GLC 300', 'Grand Cherokee', 'SORENTO', 'RX 350', 'Q5', 'Rogue', 'GTI', 'Sierra 1500', 'Camry', 'Model 3', 'ES 350', 'Tacoma'];
const TRIMS = ['', 'Premium Sport Utility 4D', 'EX-L', 'Laramie Longhorn Pickup 4D 5 1/2 ft', 'LE Sedan 4D', 'SR5 V6', 'XLT SuperCrew 5.5 ft',
  'Sport Coupe 2D', 'Limited', 'Touring Van', 'S Line Premium Plus', 'LTZ', '328d Sedan', 'Base', 'Platinum Hybrid AWD', 'Sport Utility'];
const DRIVES = ['', 'AWD', 'FWD', 'RWD', '4WD', '4X4', '2WD', 'All Wheel Drive', 'awd', '0'];
const COLORS = ['', 'Silver', 'BLACK', 'Pearl White', 'Magnetic Gray Metallic', 'Rouge Rubis', 'Blue'];
const WORDS = ['Explore', 'this', 'at', 'Golden', 'Auto', 'in', 'San', 'Ramon', 'Just', 'Priced', 'Book', 'your', 'test', 'drive', 'today',
  'mygoldenauto.net', 'https://www.mygoldenauto.net/', 'SUV', 'AWD', 'with', 'a', 'great', 'the', 'and', 'miles', 'It', 'comes', 'LED',
  'headlights', 'clean', 'title', 'one-owner', 'All-Wheel', 'Drive', 'XV', 'CR-V', 'CX-30', 'XC90', 'T6', '328d', 'EX-L', '4RUNNER',
  'F-150', 'call', 'now!', 'ready?', 'fuel', 'efficient;', 'roomy:', 'here', 'Café', 'Rogue’s', 'naïve', 'USB', 'GT', 'STI', 'EV', 'ok',
  '4WD', '4wd', 'AWD,', 'FWD.', 'rwd', '4x4', '4X4', '4D', '4dr', '4-dr', '4 door', '4DR.', '4DRV', 'Q4', 'HSE', 'XT6', '2WD', 'X4WD',
  'eleasereturns.com', 'www.eleasereturns.com/', 'https://eleasereturns.com', 'eleasereturns.com.au', 'best-auto.net', 'BEST-AUTO.NET'];
const SITES = [{}, { 'eleasereturns.com': 'e lease returns dot com' }, { 'best-auto.net': 'best auto dot net', 'eleasereturns.com': 'e lease returns dot com' }, { '': 'x', 'a.com': '' }];
const DEALERS = [undefined, { name: 'eLease Returns', city: 'Hayward', website: 'eleasereturns.com' }, { name: 'Best Auto', city: '', website: 'best-auto.net' }, { name: 'Best Auto', website: 'best-auto.net' }];
const CLIENT_NAMES = ['eLease Returns', 'Best Auto', 'BMW of Walnut Creek', 'A&B Motors', 'AutoNation', 'Golden Auto', ''];
const CLIENT_SITES = ['https://www.eleasereturns.com', 'https://best-auto.net/', 'http://WWW.AutoNation.com/cars', 'https://www.bmwofwalnutcreek.com', 'https://a-b-motors.co.uk', 'eleasereturns.com', 'https://user@host.com:8080/x'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

export function price(r) {
  const k = r();
  if (k < 0.1) return null;
  if (k < 0.15) return pick(r, [0, -1, '14688', ' 9000 ', '8,826', 'abc', '1e4', true]);
  const dollars = Math.floor(r() * 90000) + 500;
  return r() < 0.6 ? dollars : dollars + Math.floor(r() * 100) / 100;
}
export function vehicle(r) {
  const v = { Year: r() < 0.9 ? 1990 + Math.floor(r() * 36) : String(2000 + Math.floor(r() * 25)), Make: pick(r, MAKES), Model: pick(r, MODELS) };
  if (r() < 0.8) v.Trim = pick(r, TRIMS);
  if (r() < 0.8) v.Drivetrain = pick(r, DRIVES);
  if (r() < 0.8) v.ExteriorColor = pick(r, COLORS);
  if (r() < 0.8) v.Odometer = r() < 0.9 ? Math.floor(r() * 250000) : pick(r, [null, '60123', '12,500', 500]);
  v.price = price(r);
  for (const k of ['VehiclePrice', 'TotalPrice', 'TotalAskingPrice', 'TotalAdvertisingPrice']) if (r() < 0.4) v[k] = price(r);
  return v;
}
function moneyText(r) {
  const d = Math.floor(r() * 99999);
  const grouped = d.toLocaleString('en-US');
  const cents = r() < 0.5 ? '' : '.' + String(Math.floor(r() * 100)).padStart(2, '0');
  return '$' + (r() < 0.7 ? grouped : String(d)) + cents + (r() < 0.1 ? ' dollars' : '');
}
export function sentence(r) {
  const n = 2 + Math.floor(r() * 12), w = [];
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.08) w.push(moneyText(r));
    else if (k < 0.14) w.push(String(1950 + Math.floor(r() * 90)));
    else if (k < 0.18) w.push(Math.floor(r() * 300000).toLocaleString('en-US'));
    else if (k < 0.22) w.push(pick(r, MAKES) + ' ' + pick(r, MODELS));
    else w.push(pick(r, WORDS));
  }
  const end = pick(r, ['.', '.', '!', '?', ',', '']);
  return w.join(r() < 0.05 ? ' ' : ' ') + end;
}
export function text(r) {
  const n = 1 + Math.floor(r() * 5), s = [];
  for (let i = 0; i < n; i++) s.push(sentence(r));
  return s.join(r() < 0.1 ? '  \n' : ' ');
}
export function spans(r, end) {
  const out = []; let t = r() * 0.5;
  while (t < end - 0.3) { const len = 0.2 + r() * 4; const a = t, b = Math.min(end, t + len); out.push([round3(a), round3(b)]); t = b + (r() < 0.3 ? 0.01 + r() * 0.1 : 0.1 + r() * 1.4); }
  return out.length ? out : [[0, end]];
}
const round3 = (x) => Math.round(x * 1000) / 1000;
export function heard(r, words) {
  const out = []; let t = 0;
  for (const w of words) {
    const k = r();
    if (k < 0.08) continue;                                   // skipped
    if (k < 0.15) out.push([pick(r, WORDS), round3(t), round3(t + 0.3)]); // added
    const said = r() < 0.1 ? w.slice(0, -1) + 'o' : w;          // misheard
    out.push([said, round3(t), round3(t + 0.4)]); t += 0.25 + r() * 0.4;
  }
  return out;
}

export function buildCases(seed = 42, count = 400) {
  const r = rng(seed), cases = [];
  const add = (fn, ...args) => cases.push({ fn, args });
  for (let i = 0; i < count; i++) {
    const v = vehicle(r), t = text(r), veh = `${v.Year} ${v.Make} ${v.Model}`;
    const sites = pick(r, SITES);
    for (const fn of ['speechScript', 'nativeSpeech', 'speechWordCount', 'speechClientSites', 'shorthandSpeech']) cases.push({ fn, args: [t], sites });
    const dealer = pick(r, DEALERS);
    cases.push({ fn: 'script', args: dealer ? [v, 15, dealer] : [v], sites });
    cases.push({ fn: 'script30', args: dealer ? [v, dealer] : [v], sites });
    const cname = pick(r, CLIENT_NAMES), csite = pick(r, CLIENT_SITES);
    add('clientWebsiteSpoken', csite.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), cname);
    add('clientDetails', r() < 0.15 ? { id: 'golden-auto', name: 'Golden Auto', website: 'https://mygoldenauto.net' }
      : { id: 'c' + i, name: cname, website: csite, ...(r() < 0.3 ? { details: { name: 'Edited ' + cname, city: 'Dublin', website: 'edited.com' } } : {}),
        ...(r() < 0.3 ? { dealer: { city: 'Hayward' } } : {}), ...(r() < 0.3 ? { analysis: { dealer: { city: 'Fremont' } } } : {}) });
    const nc = Math.floor(r() * 3), cues = [];
    let at = r() * 5;
    for (let k = 0; k < nc; k++) { const a = at, b = at + 0.3 + r() * 6; cues.push({ text: 'Cue ' + k, start: a, end: b }); at = b + 0.05; }
    add('captionCallForPrice', cues, at + r() * 4);
    const pa = price(r), pb = r() < 0.3 ? pa : price(r);
    if (typeof pa !== 'boolean' && typeof pb !== 'boolean') add('priceMatches', pa, r() < 0.2 && typeof pa === 'number' ? pa + 0.004 : pb);
    add('integerWords', Math.floor(r() * 1.2e9) * (r() < 0.02 ? -1 : 1));
    add('currencyWords', moneyText(r));
    for (const fn of ['numberSpeech', 'priceSpeech', 'speechWordCount', 'speechScript', 'nativeSpeech', 'acronymSpeech', 'captionDisplayText', 'captionSyllables', 'captionWordKey', 'captionStripExtra']) add(fn, t);
    add('speechScript', t, false);
    add('seedanceRespell', t + ' in San Ramon, san ramon.', r() < 0.5 ? {} : { 'San Ramon': 'San Ra-MOAN', Crosstrek: 'Cross-trek' });
    add('captionUnits', sentence(r), r() < 0.5 ? '' : veh);
    add('captionWrap', sentence(r).replace(/ /g, () => pick(r, [' ', ' ', '\x01', '\x02'])));
    add('captionWordsMatch', pick(r, WORDS).toLowerCase().replace(/[^a-z0-9]/g, ''), pick(r, WORDS).toLowerCase().replace(/[^a-z0-9]/g, ''));
    const end = 5 + r() * 25;
    const words = t.split(/\s+/);
    const h = heard(r, words);
    add('captionCues', t, r() < 0.3 ? '' : veh, spans(r, end), end);
    add('captionAlignWords', t, h);
    // Timing text as captionSpokenScript produces it: added words marked with \x03 (the real Seedance flow).
    const marked = t.split(' ').map((w) => (r() < 0.15 ? '\x03' + pick(r, WORDS) + ' ' + w : w)).join(' ');
    add('captionCues', marked, r() < 0.3 ? '' : veh, spans(r, end), end);
    add('captionStripExtra', marked.replace(/ /g, () => pick(r, [' ', '\x01', '\x02'])));
    add('captionSpokenScript', t, h);
    const job = { script: t, vehicle: r() < 0.2 ? undefined : veh, duration: pick(r, [15, 30, '30', undefined]) };
    if (r() < 0.7) job.price = r() < 0.4 ? null : 14688;
    add('goldenNativeCues', job, { spans: spans(r, end), speech_end: end }, r() < 0.5 ? [] : h, pick(r, [0, 0.5]));
    const dur = 5 + Math.floor(r() * 30);
    add('captionDraft', t, dur, r() < 0.5 ? '' : veh);
    add('captionSrt', [{ text: 'A\nB', start: r() * 3, end: 3 + r() * 3 }, { text: 'C', start: 6.5, end: 7.25 }], r() * 2);
    add('captionSegments', spans(r, end), 1 + Math.floor(r() * 5));
    add('captionVoicedTime', spans(r, end), r() * end);
    add('srtTime', r() * 4000 - 1);
    add('validateSrt', pick(r, ['', '0', '1\n00:00:01,000 --> 00:00:02,000\nHi', '1\n00:00:10,000 --> 00:00:09,000\nBad', '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:01,500 --> 00:00:03,000\nB', '1\n00:61:01,000 --> 00:00:02,000\nX', '1\r\n00:00:01,000 --> 00:00:02,000\r\nWin\r\n']), 15);
    add('highestPrice', v, r() < 0.5 ? [] : [{ VehiclePrice: price(r) }, { TotalPrice: price(r) }]);
    const p = price(r);
    if (typeof p === 'number' || p === null) add('money', p === null ? null : Math.abs(p));
    if (typeof p === 'number') add('adPrice', Math.abs(p));
    add('title', v);
    add('script', v);
    add('script30', v);
    if (i % 3 === 0) clientCases(r, add, i);
    if (i % 4 === 0) importerCases(r, add, i);
    if (i % 4 === 2) goldenCases(r, add);
    if (i % 6 === 1) mediaCases(r, add);
    if (i % 10 === 3) dealercenterCases(r, add);
    if (i % 8 === 5) photoWorkerCases(r, add);
    if (i % 5 === 4) narrationCases(r, add);
    promptCases(r, add, v, t);
    jobCases(r, add, v, t);
    if (i % 10 === 0) pageCases(r, add, t);
  }
  return cases;
}

// ---- Clients: typed websites, entities, fake dealer websites for the analysis ----
const TYPED_SITES = ['eleasereturns.com', 'https://www.eleasereturns.com/', 'http://Best-Auto.NET', 'ftp://x.com', 'https://user@x.com', 'https://u:p@x.com/a',
  'https://x.com:8080', 'https://x.com:abc', 'https://x.com:99999', 'localhost', 'https://dealer.local', 'shop.internal', '  www.bay-motors.com  ', 'https://x',
  'https://1.2.3.4', 'https://exa_mple.com', 'HTTPS://WWW.Example.COM/path?q=1#f', 'https://[::1]/', 'https://x.com.', 'https://xn--bcher-kva.example', '', ' ',
  'https://a.b.co.uk', 'https://bay-motors.com/inventory/', 'https://www.mygoldenauto.net', 'http://', 'https://x.c0m', 'https://X.COM?#'];
const ENT = ['&amp;', '&#39;', '&apos;', '&#X41;', '&#0000065;', '&#65', '&AMP;', '&nbsp;', '&#128;', '&#xD800;', '&#xFFFFFFFFF;', '&#;', '&Aacute;', '&eacute;',
  '&quot;', '&lt;b&gt;', '&#x1F600;', '&hellip;', '&euro;', '&notanentity;', '&#9;', '&#x0A;', '&copy', '&#xfffe;'];
const MARKS = ['', '', 'dealercenter', 'inv-scripts-v2', 'pictures.dealer.com', 'dealerinspire', 'DealerOn', 'dealercarsearch', 'frazerweb', 'overfuel', 'dealer.com/', 'wordpress'];
const LD = [
  '{"@type":"AutoDealer","name":"Bay Motors","telephone":"555-0100","address":{"addressLocality":"Oakland","addressRegion":"CA","streetAddress":"1 Main St"}}',
  '{"@context":"https://schema.org","@graph":[{"@type":"Car","name":"2020 Kia"},{"@type":["AutomotiveBusiness","LocalBusiness"],"name":"Caf&eacute; Cars","address":{"addressLocality":"San Jos&eacute;"}}]}',
  '[{"@type":"Vehicle"},{"@type":"Product"},{"@type":"Thing"}]', '{"@type":"LocalBusiness","name":42,"address":"Main St"}', '{"@type":"AutoDealer"}',
  '{bad json', 'null', '"text"', '{"@graph":{"a":{"@type":"Car"},"b":{"@type":"AutoDealer","name":"Graph Map"}}}', '{"@type":"Car","@graph":5}',
  '{"@type":"AutoDealer","name":"First"} ', '{"@type":"AutoDealer","name":"Second","telephone":null}', '{"@type":[1,true,"Car"]}'];
function sitePages(r, website) {
  const code = pick(r, [200, 200, 200, 200, 200, 200, 200, 403, 503, 500, 0, 301]);
  let body = '<html><head><title>' + pick(r, ['Used Cars', 'Used Cars', 'Home', 'Home', 'Just a moment...', 'Attention Required! | Cloudflare']) + '</title>';
  for (let k = 0, n = Math.floor(r() * 3); k < n; k++) body += '<script type="application/ld+json">' + pick(r, LD) + '</script>';
  body += '<script src="/x.js"></script><div>' + pick(r, MARKS) + ' ' + pick(r, ENT) + (r() < 0.04 ? ' cf-chl' : '') + '</div></html>';
  const headers = code === 503 && r() < 0.5 ? 'HTTP/1.1 503\r\nServer: cloudflare\r\n' : 'HTTP/1.1 ' + code + '\r\n';
  const pages = { [website]: { code, body, headers } };
  const sm = pick(r, [null, website + '/sitemap.xml', website + '/sitemap', 'https://elsewhere.com/sitemap.xml', website + '/sm.xml']);
  if (r() < 0.8) pages[website + '/robots.txt'] = { code: 200, body: 'User-agent: *\n' + (sm ? pick(r, ['Sitemap: ', 'sitemap:', 'SITEMAP:\t', ' Sitemap: ']) + sm + '\n' : '') };
  const locs = Array.from({ length: Math.floor(r() * 6) }, () => '<loc>' + website + pick(r, ['/inventory/x-1/', '/vdp/123/car', '/used/abc', '/details/9', '/vehicles/2', '/about', '/blog/inventory']) + '</loc>').join('');
  if (r() < 0.8) pages[sm && sm.startsWith(website) ? sm : website + '/sitemap.xml'] = { code: pick(r, [200, 200, 404]), body: '<urlset>' + locs + '</urlset>' };
  return pages;
}
function clientCases(r, add, i) {
  const typed = pick(r, TYPED_SITES);
  add('clientWebsite', typed);
  add('parityParseUrl', /^[a-z]+:\/\//i.test(typed) ? typed : 'https://' + typed.trim());
  add('clientInventoryKey', pick(r, ['golden-auto', '', 'bay-motors', 'Bay', '../x', 'a'.repeat(40), 'a'.repeat(41), 'x_y', 'elease-returns']));
  add('html_entity_decode', Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, ENT) + pick(r, [' ', 'x', '', ';'])).join(''));
  const website = 'https://' + pick(r, ['www.baymotors.com', 'eleasereturns.com', 'best-auto.net', 'x.com']);
  add('parityClientAnalyze', website, sitePages(r, website));
  const existing = r() < 0.3 ? [] : [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, ...(r() < 0.5 ? [{ id: 'bay-motors', name: 'Bay Motors', website: 'https://www.baymotors.com' }] : [])];
  const name = pick(r, ['Bay Motors', 'bay motors', 'eLease Returns', '  Best   Auto  ', '', 'A&B Motors!!', 'x'.repeat(81), '🚗 Cars', 'Golden Auto', 'Ünïcödé Autos', '---', 'BMW of Walnut Creek and Friends Dealership Group']);
  const typed2 = pick(r, ['baymotors.com', 'https://www.baymotors.com', 'eleasereturns.com', 'https://mygoldenauto.net', 'localhost', 'https://new-dealer.com', 'new-dealer.com/x']);
  const site2 = (() => { try { return clientWebsiteLike(typed2); } catch { return 'https://none.example'; } })();
  add('parityClientAdd', existing, name, typed2, sitePages(r, site2));
  add('paritySaveDetails', pick(r, ['x', 'x', 'x', 'x', 'golden-auto', 'missing']), {
    name: pick(r, ['eLease Returns', 'eLease Returns', 'Café Cars', '  Bay\tMotors ', '', 'A "quoted" name', 'x'.repeat(81)]),
    city: pick(r, ['San Ramon', 'San Ramon', '', ' Dublin  ', 'Hay<ward', 'x'.repeat(61)]),
    website: pick(r, ['eleasereturns.com', 'https://www.EleaseReturns.com/', 'http://best-auto.net//', 'a.b', 'not a site', '', 'x_y.com']),
    website_spoken: pick(r, ['', '', 'e lease returns dot com', 'E LEASE DOT COM', "o'neil dot com", 'bad<>chars', 'x'.repeat(121)]),
  });
}
// The address clientWebsite would make, used only to put the fake website at the right URL.
function clientWebsiteLike(t) { t = t.trim(); if (!/^https?:\/\//i.test(t)) t = 'https://' + t; return 'https://' + new URL(t).hostname.toLowerCase(); }


// ---- Dealer Car Search listing pages: realistic markup plus the messes real pages have ----
const TRIM_TXT = ['S COUPE**LIFT**HEAT SEATS', 'P400 SE', '4WD 4dr V6 HSE', '', '*NO TRIM', 'Premium Plus &amp; Tech', 'Café Edition'];
const NOTE_TXT = ['LOCAL TRADE IN**CLEAN CARFAX', 'WE CHARGE A $80.00 DOC FEE', 'Café &amp; crème', '', '  spaced out  text  ', 'Line<br>break'];
function vdpPage(r, id, opts = {}) {
  const priceVal = opts.price ?? pick(r, ['177995.00', '0.00', '', 'abc', '31995', '1e5', '-5']);
  const charset = r() < 0.85 ? '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />' : r() < 0.5 ? '<meta charset="UTF-8">' : '';
  const li = (cls, label, value) => `<li class="${cls}"><label>${label}</label> ${value}${r() < 0.15 ? '' : '</li>'}`;
  const details = [
    li('detailOptTrim', 'Trim:', pick(r, TRIM_TXT)), li('detailOptColor', 'Color:', pick(r, ['CHALK', 'LOIRE BLUE', ''])),
    r() < 0.5 ? li('detailOptInterior', 'Interior:', 'COGNAC') : '', li('detailOptInteriorColor', 'Interior Color:', pick(r, ['BLACK', ''])),
    li('detailOptEngine', 'Engine:', '3.0L <span>V6</span>'), li('detailOptDrive', 'Drive Train:', pick(r, ['RWD', '4WD', ''])),
    li('detailOptMPG', 'Mileage:', pick(r, ['2,599', '110,621', '', 'N/A', '12 345'])), li('detailOptStock', 'Stock #:', opts.stock ?? pick(r, ['0931', 'crlo', '', '0', '0867T'])),
    li('detailOptVin', 'Vin:', pick(r, ['WP0AH2A90TS214310', '', 'VIN1'])), r() < 0.2 ? li('detailOptTrim', 'Trim:', 'SECOND TRIM') : '',
    r() < 0.1 ? '<li class="detailOptX">no label here</li>' : '', r() < 0.1 ? li('detailOptEmpty', ':', '') : '',
  ].join(' ');
  const photos = Array.from({ length: opts.photos ?? Math.floor(r() * 5) }, (_, k) => `<img data-src='https://imagescdn.dealercarsearch.com/Media/3073/${id}/p${k}${pick(r, ['.jpg', '.JPG', '.webp', '.png'])}'>`).join('');
  return '<!DOCTYPE html><html><head>' + charset + '<title>Car</title>'
    + `<script>var init_utag_data = { "site_company_name": "${pick(r, ['eLeaseReturns', 'Caf&eacute; Cars', '', '0'])}", "site_company_city": "San Ramon", "site_phone_main": "800-407-0303",`
    + ` "product_make": "${opts.make ?? pick(r, ['Porsche', 'Mercedes-Benz', 'BMW', ' Land Rover ', ''])}", "product_model": "${pick(r, ['911', 'C63 AMG', 'Range Rover'])}",`
    + ` "product_year": "${opts.year ?? pick(r, ['2026', '1996', '2018', '2024 ', '1899', 'x', ''])}", "product_price": "${priceVal}", "product_condition": "USED", "product_id": "${id}", };</script>`
    + '<script>if (a < b && "</div>") {}</script><!-- <li class="detailOptTrim"><label>Trim:</label> COMMENTED</li> --></head><body>'
    + `<div class="i05r_detailNamePrice"><span class="price">${pick(r, ['$177,995', ' $ 31,995.50 ', '$0', 'Call', '$1,2', '$9.999'])}</span><span class="priceold">$999,999</span></div>`
    + '<form class="calcWrap"><span class="price">$5,000,000</span><input class="loanCalcPrice" value="999999"></form>'
    + `<ul class="i05r_detailTrimEtc">${details}</ul>`
    + (r() < 0.8 ? `<div class="${pick(r, ['i05r_detailNotes', ' i05r_detailNotes  x', 'i05r_detailNotesX', 'col i05r_detailNotes'])}"><h3>Vehicle Description</h3> ${pick(r, NOTE_TXT)}</div>` : '')
    + photos + `<img src="https://imagescdn.dealercarsearch.com/Media/3073/999${id}/other.jpg">` + '</body></html>';
}
function importerCases(r, add, i) {
  const id = String(24000000 + i);
  add('dcsParseVdp', vdpPage(r, id), 'https://lr.com/vdp/' + id + '/x');
  const client = { id: 'lr', name: 'LR', website: 'https://lr.com', ...(r() < 0.7 ? { analysis: { sitemap: 'https://lr.com/sitemap' } } : {}) };
  const site = (cars) => {
    const pages = {};
    const map = r() < 0.9 ? 'https://lr.com/sitemap' : 'https://lr.com/other';
    pages[map] = { code: r() < 0.95 ? 200 : 500, body: cars.map((c) => `<loc>https://lr.com/vdp/${c.id}/Used-Car</loc>`).join('') + '<loc>https://lr.com/bdp/1/blog</loc>' };
    for (const c of cars) pages[`https://lr.com/vdp/${c.id}/Used-Car`] = r() < 0.95 ? { code: 200, body: vdpPage(r, c.id, c) } : { code: 404, body: '' };
    return pages;
  };
  const cars = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => ({ id: String(500 + k), stock: 'S' + k, year: '2020', make: 'Audi', photos: Math.floor(r() * 3) }));
  const later = cars.filter(() => r() < 0.8).map((c) => ({ ...c, price: pick(r, ['31995', '0.00', '42000.50']), photos: r() < 0.5 ? c.photos : c.photos + 1 }));
  if (r() < 0.3) later.push({ id: '999', stock: 'NEW', year: '2024', make: 'Kia', photos: 1 });
  const prior = r() < 0.3 ? [{ StockNumber: 'S0', photos: ['https://x/a.jpg'], photo_sources_done: [], sheet_photos: [2, 1], imported_at: '2026-01-01T00:00:00+00:00' }, { StockNumber: 'OLD', active: true }] : [];
  add('parityImportDcs', client, site(cars), site(later), prior);
}


// ---- Golden Auto website reader: the listing page's script tag and the JSONP vehicle list ----
function goldenCases(r, add) {
  const src = 'https://www.mygoldenauto.net';
  const script = pick(r, ['/inv-scripts-v2/inv/vehicles?cb=dws_inventory_listing_7&x=1', '/inv-scripts-v2/inv/vehicles?cb=other', '/other/vehicles?cb=dws_inventory_listing_7', '']);
  const html = `<html><head><script src="/a.js"></script>${script ? `<script src="${script.replace('&', pick(r, ['&', '&amp;']))}"></script>` : ''}</head><body></body></html>`;
  const v = () => ({ Make: pick(r, ['SUBARU', 'Land Rover', 'MERCEDES-BENZ', "O'Brien (Custom)", 'Café']), Model: pick(r, ['XV CROSSTREK', 'RANGE ROVER SPORT', 'C 300!', '911']),
    StockNumber: pick(r, ['870288', 'A13806', 870288, 'x y*']), VehiclePrice: price(r), TotalPrice: price(r), Year: 2013 });
  const list = Array.from({ length: Math.floor(r() * 4) }, v);
  const json = pick(r, [
    JSON.stringify({ Vehicles: list, TotalRecordCount: list.length }), JSON.stringify({ Vehicles: list }), JSON.stringify({ Vehicles: list, TotalRecordCount: list.length + 1 }),
    JSON.stringify({ Vehicles: list, TotalRecordCount: String(list.length) }), JSON.stringify({ NoVehicles: 1 }), JSON.stringify({ Vehicles: 'x' }), '5', '{bad', JSON.stringify(list)]);
  const body = pick(r, ['cb_123(' + json + ');', ' jQuery$1 ( ' + json + ' ) ', json, '1x(' + json + ')']);
  const pages = { [src]: html };
  if (script) pages[src + script] = body;
  add('parityGoldenInventory', src, pages);
  add('jsonp', body);
}


// ---- Photo import (DealerCenter media ZIPs): listing fields, entry names, natural order, image checks ----
const IMG = { jpg: JPEG_40x30, png: PNG_20x20_TRANSPARENT, big: JPEG_1800x900 };
const ZIP_NAMES = ['photo_1.jpg', 'photo_10.jpg', 'photo_2.JPG', 'Photo_003.jpeg', 'img 2.png', 'b.webp', 'notes.txt', 'dir/photo_5.jpg', '__MACOSX/x.jpg', 'folder/', 'a01.jpg', 'a1.jpg'];
function mediaCases(r, add) {
  const files = {};
  for (let k = 0, n = Math.floor(r() * 5); k < n; k++) files[pick(r, ZIP_NAMES)] = pick(r, ['jpg', 'jpg', 'png', 'big', 'bad']);
  if (r() < 0.05) files['../evil.jpg'] = 'jpg';
  // Each field is valid most of the time, so whole imports (images, order, sizes) are compared too.
  const f = (good, bad) => (r() < 0.88 ? pick(r, good) : pick(r, bad));
  const fields = {
    stock: f(['870288', 'A13806', ' 0939 '], ['bad stock!', '', 'x'.repeat(41)]),
    year: f(['2013', 2013, ' 2016 ', '+2016'], ['1899', '2099', 'x', '', '2016.0']),
    make: f(['Subaru', ' Land Rover '], ['', 'x'.repeat(61)]), model: f(['XV Crosstrek', '911'], ['']),
    trim: pick(r, ['', ' Premium ']), vin: f(['', 'jf2gpawc5d2870288'], ['JF2GPAWC5D287028O', 'SHORT']),
    prices: f(['', '14688.25', '$14,550; 14688.25', ' ; 9000 ;'], ['0', 'abc', '-5']), mileage: f(['', '60123', ' 60123 '], ['12,500', '2000001', '-1']),
    description: f(['', 'Clean <b>Carfax</b>', 'a < b', ' spaced '], ['x'.repeat(20001)]), drivetrain: pick(r, ['', ' AWD ']),
  };
  if (!Object.keys(files).length || r() < 0.7) files[pick(r, ['photo_1.jpg', 'photo_10.jpg', 'Photo_003.jpeg', 'img 2.png'])] = pick(r, ['jpg', 'png', 'big']);
  add('parityImportMedia', fields, files, IMG);
  add('strip_tags', pick(r, ['Clean <b>Carfax</b>', 'a < b > c', '<p>x</p>y', 'tail<', '<!-- n -->t', 'Café <i>crème</i>']));
  add('strnatcasecmp', pick(r, ZIP_NAMES), pick(r, ZIP_NAMES));
  add('parityFilterInt', pick(r, ['0', '05', '+5', ' 7 ', '5.0', '1e3', '', 'x', 5, 5.5, -3, true, null, '2016']));
}


// ---- DealerCenter sync: snapshots over several runs, ZIP and CDN photos, prices, removals, sheet picks ----
function dcCar(r, stock) {
  // Mostly valid cars (one invalid car fails the whole snapshot), with the odd bad value.
  const f = (good, bad) => (r() < 0.985 ? pick(r, good) : pick(r, bad));
  const car = { stock, year: f([2015, '2016', 2018], [1899, 'x']), make: f(['Honda', ' ford '], ['']), model: pick(r, ['CR-V', 'Focus']),
    trim: pick(r, ['EX-L', '', 'S']), color: pick(r, ['Blue', '']), mileage: f([100000, 100500, '', null], ['12,000', -1]),
    prices: f([[9000], [9000, 8500.5], ['9000', 0], [], 12000], ['x']), vin: f(['', '', 'JF2GPAWC5D2870288'], ['BAD']),
    description: pick(r, ['', 'Total price does not include State Sales Tax or Registration fees, please call us for the total price. Clean car!', ' <b>One</b> owner ']) };
  if (r() < 0.55) { const n = r() < 0.95 ? 1 + Math.floor(r() * 3) : 0; car.photo_urls = Array.from({ length: n }, (_, k) => `https://imagescf.dealercenter.net/${pick(r, ['640/480/', '1600/1200/202512-aa/', ''])}${stock}-${k}${pick(r, ['', '', 'b'])}.jpg`); }
  else car.photo_count = f([2, 3, 0, '3'], [101]);
  const shown = car.photo_urls ? car.photo_urls.length : Number(car.photo_count);
  if (r() < 0.25) car.sheet_photos = r() < 0.9 && shown >= 2 ? pick(r, [[1, 2], [2, 1]]) : r() < 0.9 && shown >= 1 ? [1] : pick(r, [[1, 1], [], [9]]);
  return car;
}
function dealercenterCases(r, add) {
  const stocks = ['S1', 'S2', 'S3', 'OLD1'];
  const prior = r() < 0.5 ? [{ source: 'zip', StockNumber: 'OLD1', Vin: 'stock:OLD1', Year: 2010, Make: 'FORD', Model: 'FOCUS', price: 5000.0, photos: [] }] : [];
  const steps = Array.from({ length: 2 + Math.floor(r() * 2) }, () => {
    const snap = stocks.filter(() => r() < 0.6).map((s) => dcCar(r, s));
    if (r() < 0.05) snap.push(snap[0] ?? dcCar(r, 'S1'));
    const zips = {};
    for (const s of stocks) if (r() < 0.5) zips[s] = 1 + Math.floor(r() * 3);
    const fail = r() < 0.2 ? ['S1-0', 'S2-1'] : [];
    return { snapshot: snap, zips, fail };
  });
  add('parityDcSync', prior, steps, JPEG_40x30);
  add('dcNormalize', dcCar(r, pick(r, ['S1', 'bad stock', ''])));
}


// ---- Photo worker: downloads (good, too small, not an image, missing), model labels, keep/drop, shared files ----
function photoWorkerCases(r, add) {
  const photos = {}, cars = [];
  for (let c = 0, n = 1 + Math.floor(r() * 3); c < n; c++) {
    const srcs = Array.from({ length: Math.floor(r() * 5) }, (_, k) => `https://imagescdn.dealercarsearch.com/Media/3073/${c}/p${k}.jpg`);
    if (r() < 0.2 && srcs.length) srcs.push(srcs[0]);
    for (const u of srcs) photos[u] ??= pick(r, ['big', 'big', 'big', 'other', 'tiny', 'bad', 'missing']);
    cars.push({ StockNumber: 'S' + c, source: pick(r, ['dcs', 'dcs', 'dcs', 'zip']), photos_pending: r() < 0.85, photo_sources: srcs, photos: r() < 0.3 ? ['https://x/old.jpg'] : [], ...(r() < 0.3 ? { sheet_photos: [1, 2] } : {}) });
  }
  const labels = r() < 0.15 ? [] : Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, ['exterior', 'exterior', 'interior', 'open', 'text', 'detail']));
  add('parityPhotoWorker', cars, photos, labels, { big: JPEG_1800x900, other: JPEG_1800x900_B, tiny: JPEG_40x30 }, r() < 0.3 ? { note: 'keeps nothing' } : {});
}


// ---- Narrations: preview/approve/lip-sync/poll/delete runs against fake ElevenLabs, fal and audio helper ----
function narrationCases(r, add) {
  // Each input valid most of the time, so the deeper steps (approve, lip-sync, status, deletes) are compared too.
  const f = (good, bad) => (r() < 0.9 ? pick(r, good) : pick(r, bad));
  const price = pick(r, [14688.25, 9000, null]);
  const setup = { state: { inventory: { vehicles: [{ StockNumber: '870288', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price, active: f([true], [false]) }] } },
    jobs: [{ id: 'V1', stock: '870288', price, vehicle: '2013 SUBARU XV CROSSTREK', status: f(['completed'], ['in_progress']), video_url: f(['https://cdn.example.com/v.mp4'], ['http://x/v.mp4']), duration: f([30], [15]), format: 'instagram_reels' }] };
  const net = {
    voices: [{ status: 200, body: { voices: [{ voice_id: 'v1', name: 'Bella', labels: { accent: 'american' } }], has_more: r() < 0.5, next_page_token: 'p1' } }, { status: f([200], [500]), body: { voices: [{ voice_id: 'v2', name: 'Adam' }] } }],
    tts: f([{ status: 200, body: 'ID3-fake-mp3-' + Math.floor(r() * 1000) }], [{ status: 401, body: '' }, { status: 500, body: '' }, { error: 'Transport or audio processing failed; check dependencies. A submitted paid request may be uncertain.' }]),
    probe: f([24.3, 22.0, 14.2], [31.5, { error: 'Invalid audio duration.' }]),
    pad: f(['ok'], ['bad', 'long']),
    fal_submit: f([{ status: 200, body: { request_id: 'R1', status_url: 'https://queue.fal.run/fal-ai/sync-lipsync/requests/R1/status', response_url: 'https://queue.fal.run/fal-ai/sync-lipsync/requests/R1' } }],
      [{ status: 200, body: { request_id: 'R1', status_url: 'https://evil.example/x', response_url: 'https://queue.fal.run/fal-ai/sync-lipsync/requests/R1' } }, { status: 200, body: {} }, { status: 422, detail: 'audio_url invalid' }, { status: 503 }]),
    fal_status: pick(r, [{ status: 200, body: { status: 'COMPLETED' } }, { status: 200, body: { status: 'COMPLETED' } }, { status: 202, body: { status: 'IN_PROGRESS' } }, { status: 200, body: { status: 'IN_QUEUE' } }, { status: 200, body: { status: 'COMPLETED', error: 'x' } }, { status: 500 }]),
    fal_result: f([{ status: 200, body: { video: { url: 'https://v3.fal.media/out.mp4' } } }], [{ status: 422 }, { status: 500 }, { status: 200, body: { video: { url: 'http://bad/x.mp4' } } }]),
  };
  const preview = { stock: '870288', voice_id: f(['v1'], ['bad voice!']), text: f(['Take a look at this twenty thirteen Subaru X-V Crosstrek, here at Golden Auto in San Rah-moan.'], ['short']),
    caption_script: pick(r, ['Take a look at this 2013 SUBARU XV CROSSTREK, here at Golden Auto in San Ramon.', 'Take a look at this 2013 Subaru Outback at Golden Auto.']),
    duration: f([30], [15, 20]), approve_spend: f([true], [false]), new_take: r() < 0.2 };
  // "@preview" / "@lipsync" are replaced by the newest record of that kind before each step.
  const steps = [['narration_voices', {}], ['narration_preview', preview]];
  if (r() < 0.3) steps.push(['narration_preview', preview]);
  steps.push(['narration_list', {}], ['narration_approve', { id: '@preview', reviewed: f([true], [false]) }],
    ['narration_lipsync', { narration_id: '@preview', video_id: 'V1', approve_spend: f([true], [false]), confirm_current: true, auto_build: r() < 0.5 }],
    ['narration_poll', { id: '@lipsync' }], ['narration_poll', { id: '@lipsync' }], ['narration_list', {}]);
  if (r() < 0.4) steps.push(['narration_delete', { id: '@preview' }], ['narration_lipsync_delete', { id: '@lipsync' }], ['narration_delete', { id: '@preview' }]);
  add('parityNarrations', setup, steps, net, r() < 0.3 ? { narration_speed: pick(r, [1.5, 0.5, '0.85', 1.0]) } : {});
  add('narrationTextDifferences', pick(r, [preview.text, 'and just over sixty thousand miles', 'San Ruh-mone']), pick(r, [preview.caption_script, 'with just over 60,000 miles', 'San Ramon']), r() < 0.3 ? { 'San Ramon': 'San Ruh-mone' } : {});
  add('narrationVoiceSettings', r() < 0.5 ? {} : { narration_speed: pick(r, [1.5, 0.5, '0.85', 'x', 1.0]) }, pick(r, [15, 30, 20]));
}


// ---- Seedance prompts: durations, approved-narration lengths (pan shots), voice references, presenters ----
function promptCases(r, add, v, t) {
  const presenter = pick(r, ['friendly adult woman, navy blazer.', '  x  ', 'Café owner, 40s...', '']);
  const sec = pick(r, [null, 20.7, 22.0, 24.3, 26.0, 26.95, 27.45, 29.0, 12.3, 14.9, 5.04]);
  const speech = pick(r, [t, t + ' in San Ramon at my golden auto dot net', 'Visit "Golden Auto" today.', '   ', 'Book at mygoldenauto.net, Golden Auto.']);
  add('promptNative', v, speech, pick(r, [15, 30, 30]), presenter, pick(r, [false, true, 'speech', 'voice']), sec, pick(r, [{}, { 'San Ramon': 'San Ra-MOAN' }, { Crosstrek: 'Cross-trek' }]));
  add('prompt', v, t, pick(r, ['showroom', 'dynamic', 'other']), pick(r, [15, 30]), presenter);
  add('speechPronunciationGuide', speech);
}


// ---- Video jobs: detail pages (gallery, price, notes), errors, reference URLs, spokesperson text, fingerprints ----
const CDN = ['https://imagescf.dealercenter.net/1024/768/202401-abc.jpg', 'https://imagescf.dealercenter.net/W/H/logo/202401-def.jpg',
  'http://imagescf.dealercenter.net/640/480/x.jpg', 'https://images.example.com/1/2/y.jpg', 'https://imagescf.dealercenter.net/800/600/202401-abc.jpg', '0', ''];
function detailPage(r) {
  const img = () => { const a = pick(r, ['data-pin-media', 'data-base-img-url', 'both', 'src']); const u = pick(r, CDN);
    return a === 'both' ? `<img data-pin-media="${pick(r, CDN)}" data-base-img-url="${u}">` : `<img ${a}="${u}">`; };
  const media = () => `<div id="${pick(r, ['DWS_VDP_Media_1', 'DWS_VDP_Media_', 'dws_vdp_media_2', 'Gallery'])}"><ul><li>${img()}</li><li>${img()}<div>${img()}</div></li></ul></div>`;
  const meta = () => pick(r, [`<meta name="description" content="2013 Subaru for $14,688.25 at Golden Auto">`, `<meta property="og:description" content="Only $9,000! Call $1,234,567.891">`,
    `<meta property="product:price:amount" content="${pick(r, ['14688', '14,688', ' 9000', '1e4', 'abc', '0'])}">`, `<meta property="og:image" content="${pick(r, CDN)}">`, `<meta name="keywords" content="$99">`]);
  const notes = pick(r, ['', '<div class="x dws-vdp-seller-notes-container  y">  Clean\n title,\t one owner.  </div>', '<p class="dws-vdp-seller-notes-container-x">no</p>', '<div class="dws-vdp-seller-notes-container">Café naïve</div>']);
  let h = pick(r, ['<html><head><meta charset="utf-8">', '<html><head>']);
  for (let i = Math.floor(r() * 3); i > 0; i--) h += meta();
  h += '</head><body>';
  for (let i = Math.floor(r() * 3); i > 0; i--) h += media();
  return h + notes + '</body></html>';
}
function jobCases(r, add, v, t) {
  const page = detailPage(r);
  add('galleryPhotos', page);
  add('parityEnrich', { ...v, url: 'https://www.mygoldenauto.net/x', source: pick(r, ['website', 'zip', 'dcs', undefined]) }, page);
  add('jobError', pick(r, [null, 'Failed at https://storage.example.com/x?sig=abc "y"', { detail: [{ msg: 'bad', url: 'http://a.b/c' }] }, 'é'.repeat(1500), 42, 'x'.repeat(2500)]));
  const cfg = { public_base_url: pick(r, ['https://video.mygoldenauto.net:4343', 'https://video.mygoldenauto.net:4343/', 'http://127.0.0.1:4343', 'https://example.com']), allow_local_http: r() < 0.5 };
  add('referenceImageUrl', pick(r, ['https://video.mygoldenauto.net:4343/assets/sheet-abc.jpg', 'https://video.mygoldenauto.net:4343/assets/../x.jpg', 'https://cdn.example.com/a.png', 'https://10.0.0.1/a.png', 'https://user:p@cdn.example.com/a.png', 'http://127.0.0.1:4343/assets/spokesperson.png', 'https://x.local/a.jpg']), cfg);
  add('spokespersonClean', pick(r, ['  friendly   adult\nwoman ', 'Say "hi"', '', 'é'.repeat(61), 'é'.repeat(60), 'a b c']), pick(r, [60, 300]), pick(r, ['name', 'description']));
  add('jobFingerprint', v, t, 'https://a/assets/sheet.jpg', 'https://a/assets/s.png', SPOKESPERSON_DESC, 'instagram_reels', 'showroom', pick(r, [15, 30]), pick(r, ['elevenlabs', 'native']), t + ' café', pick(r, ['', 'https://a/assets/narrations/x.mp3']));
}
const SPOKESPERSON_DESC = 'trustworthy friendly adult woman age 28–33, casual professional attire';


// ---- Pages: the shared templates filled by PHP's strtr and Node's renderer ----
function pageCases(r, add, t) {
  const val = () => pick(r, ['', 'NODE TEST • ', 'STAGING • ', t, '$1 $& {{CSRF}}', '<b>"x" & \'y\'</b>', 'é—ü']);
  add('pageRender', 'login', { TITLE_PREFIX: val(), CSRF: val(), ERROR: val() });
  add('pageRender', 'dashboard', { TITLE_PREFIX: val(), BANNER: val(), BOOT: 'window.CSRF=' + JSON.stringify(val()) + ';' });
  add('pageRender', 'login', {});
  add('esc', val() + ' & < > " \' &amp;');
}
