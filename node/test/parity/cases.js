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
  'F-150', 'call', 'now!', 'ready?', 'fuel', 'efficient;', 'roomy:', 'here', 'Café', 'Rogue’s', 'naïve', 'USB', 'GT', 'STI', 'EV', 'ok'];
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
  }
  return cases;
}
