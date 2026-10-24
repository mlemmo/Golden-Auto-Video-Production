// Vehicle-fitted script openers and the 30-second script wording. No paid calls: Claude is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb, state } from '../src/lib/db.js';
import { vehicleIntro, introProblem, ruleIntro, vehicleClass, introFacts } from '../src/lib/intros.js';
import { script, colorPhrase } from '../src/lib/scripts.js';
import { speechWordCount } from '../src/lib/speech.js';

const m4 = { StockNumber: '9180', Vin: 'WBS23HK01SCS63216', Year: 2025, Make: 'BMW', Model: 'M4', Trim: 'Competition', Drivetrain: 'Rear-Wheel Drive', ExteriorColor: 'Brooklyn Gray', Odometer: 8547, price: 80914 };
const dealer = { name: 'Eastbay Motorcars', city: 'Pleasanton', website: 'eastbaymotorcars.net' };

test('Claude lines are used, saved per listing, and asked again only when the listing changes', async () => {
  const db = openMemoryDb(), asked = [];
  const ask = async (cfg, facts) => { asked.push(facts); return { hook: 'Built for drivers who live for the drive.', highlight: 'It makes every back road feel like a race track.', model: 'claude-opus-5-5' }; };
  const cfg = { anthropic_key: 'test' };
  const a = await vehicleIntro(db, cfg, 'eastbay-motorcars', m4, 26, ask);
  assert.deepEqual([a.source, a.hook], ['claude', 'Built for drivers who live for the drive.']);
  assert.ok(!('cost' in asked[0]) && asked[0].make === 'BMW', 'listing facts only');
  await vehicleIntro(db, cfg, 'eastbay-motorcars', m4, 26, ask);
  assert.equal(asked.length, 1, 'saved lines reused');
  await vehicleIntro(db, cfg, 'eastbay-motorcars', { ...m4, price: 79914 }, 26, ask);
  assert.equal(asked.length, 2, 'a changed listing is asked again');
  assert.equal(state(db, 'intro:eastbay-motorcars:9180').hook, 'Built for drivers who live for the drive.');
});

test('falls back to the rule lines without a key, on errors and on answers that break the rules', async () => {
  const db = openMemoryDb();
  assert.equal((await vehicleIntro(db, {}, 'c', m4, 26, async () => { throw new Error('must not be called'); })).source, 'rules');
  const bad = [{ hook: 'Only $80,914 today!', highlight: 'It is fast.' }, { hook: 'Looking for a dependable vehicle?', highlight: 'It is a great fit for daily drives.' }, { hook: 'Hi', highlight: 'x' }];
  for (const x of bad) assert.equal((await vehicleIntro(openMemoryDb(), { anthropic_key: 'k' }, 'c', m4, 26, async () => x)).source, 'rules', JSON.stringify(x));
  assert.equal((await vehicleIntro(db, { anthropic_key: 'k' }, 'c', m4, 26, async () => { throw new Error('network'); })).source, 'rules');
  assert.equal(introProblem({ hook: 'Built for drivers who love the drive.', highlight: 'It turns every drive into an event.' }), null);
});

test('rule lines fit the type of vehicle', () => {
  const cls = (Make, Model, Trim = '', price = 30000) => vehicleClass({ Make, Model, Trim, price });
  assert.deepEqual([cls('Mercedes-Benz', 'G-Class', 'G 550 4MATIC', 139914), cls('BMW', 'M4', 'Competition'), cls('Porsche', 'Taycan', 'Turbo'), cls('Jeep', 'Wrangler', 'Rubicon'),
    cls('Ram', '2500', 'Laramie'), cls('LEXUS', 'RX 350'), cls('Honda', 'Odyssey', 'SE'), cls('Honda', 'Civic', 'EX-L'), cls('SUBARU', 'XV CROSSTREK')],
  ['flagship', 'performance', 'ev_performance', 'offroad', 'truck', 'luxury_suv', 'family', 'commuter', 'commuter']);
  assert.ok(!/dependable/.test(ruleIntro(m4).hook));
});

test('30-second script: fitted opener, a/an, no "Base", paint names, word budget', () => {
  const intro = { hook: 'Built for drivers who love the drive.', highlight: 'It turns every drive into an event.' };
  const s = script(m4, 30, dealer, intro);
  // The sentence naming the car varies by VIN (scripts.js NAME_LINES); it follows the opener and names the car.
  assert.ok(s.startsWith('Built for drivers who love the drive. ') && s.includes(' 2025 BMW M4 Competition') && s.includes('It turns every drive into an event.'), s);
  const lexus = script({ ...m4, Make: 'LEXUS', Model: 'RX 350', Trim: 'Base', ExteriorColor: 'Caviar', Drivetrain: '' }, 30, dealer, intro);
  assert.ok(/2025 LEXUS RX 350[ ,]/.test(lexus) && lexus.includes('It comes with Caviar paint and just over 8,000 miles.'), lexus);
  assert.equal(colorPhrase('Ice Grey Metallic'), 'an ice grey metallic exterior');
  assert.equal(colorPhrase('Obsidian Blue Pearl'), 'an obsidian blue pearl exterior');
  assert.equal(colorPhrase('Silver'), 'a silver exterior');
  const ram = script({ StockNumber: '9227', Year: 2022, Make: 'RAM', Model: '2500', Trim: 'Laramie', Drivetrain: '4WD', ExteriorColor: 'Granite Crystal', Odometer: 89270, price: 44914 }, 30, dealer,
    { hook: 'Need a truck that can really work?', highlight: 'It is ready for work during the week and adventures on the weekend.' });
  assert.ok(speechWordCount(ram) <= 62, ram + ' (' + speechWordCount(ram) + ')');
  assert.ok(script(m4, 15, dealer, intro).startsWith('Explore this'), '15-second script unchanged');
  assert.ok(s.includes('Priced at $80,914.') && script(m4, 15, dealer).includes('Priced at $80,914.') && !/\bJust \$/.test(s), 'price wording');
  assert.equal(introFacts({ ...m4, description: 'x'.repeat(3000) }).description.length, 1500);
});

test('the opener and highlight fit each car’s word budget', async () => {
  const { introBudget } = await import('../src/lib/scripts.js');
  const b = introBudget(m4, dealer);
  assert.ok(b > 4 && b < 30, String(b));
  const lines = { hook: 'Built for drivers who love the drive.', highlight: 'It turns every drive into an event.' };
  assert.ok(speechWordCount(script(m4, 30, dealer, lines)) <= 60 || words(lines) > b);
  assert.equal(introProblem({ hook: 'Built for drivers who love the drive.', highlight: '' }, 8), null, 'hook alone when the budget is small');
  assert.equal(introProblem(lines, 10), 'over the word budget');
  assert.equal((await vehicleIntro(openMemoryDb(), { anthropic_key: 'k' }, 'c', m4, 2, async () => { throw new Error('not called'); })).source, 'none', 'no room: no opener');
});
const words = (l) => (l.hook + ' ' + l.highlight).split(/\s+/).filter(Boolean).length;

test('over budget with both lines: the opener alone is kept', async () => {
  const r = await vehicleIntro(openMemoryDb(), { anthropic_key: 'k' }, 'c', m4, 12, async () => ({ hook: 'Craving a coupe that turns every drive into an event?', highlight: 'It is pure joy on every single back road.' }));
  assert.deepEqual([r.source, r.hook, r.highlight], ['claude', 'Craving a coupe that turns every drive into an event?', '']);
});
