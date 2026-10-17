// Port of tests/captions.php (plus the speech, price and script checks in tests/run.php, references.php, native_voice.php).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_EXTRA, CAPTION_MAX_LINE, captionCues, captionDisplayText, captionDraft, captionSpokenScript, captionSrt, validateSrt,
} from '../src/lib/captions.js';
import { nativeSpeech, seedanceRespell, speechScript, speechWordCount } from '../src/lib/speech.js';
import { adPrice, highestPrice } from '../src/lib/price.js';
import { script } from '../src/lib/scripts.js';

test('prices are spoken as words', () => {
  for (const [input, expected] of Object.entries({
    '$14,688.25': 'fourteen thousand six hundred eighty-eight dollars and twenty-five cents',
    '$1.01': 'one dollar and one cent',
    '$0.25': 'zero dollars and twenty-five cents',
    '$20.00': 'twenty dollars',
    '$8826.25': 'eight thousand eight hundred twenty-six dollars and twenty-five cents',
  })) assert.equal(speechScript(input), expected, input);
  assert.equal(speechScript('Price $14,688.25 dollars.'), 'Price fourteen thousand six hundred eighty-eight dollars and twenty-five cents.', 'no duplicate dollars');
  assert.ok(speechWordCount('$14,688.25') > 1, 'speech count includes expanded currency');
  assert.ok(!speechScript('Just $14,688. Call now.').includes('$') && speechScript('Just $14,688. Call now.').includes('dollars. Call now.'), 'whole-dollar price before a period');
});

test('draft captions and SRT validation', () => {
  const s = captionDraft('Golden Auto in San Ramon. Priced at $14,688.25.', 15);
  assert.ok(s.includes('$14,688.25') && s.includes('San Ramon'), 'captions keep numeric price and San Ramon');
  assert.notEqual(validateSrt(s, 15), '', 'draft has valid ordered times');
  assert.throws(() => validateSrt('1\n00:00:10,000 --> 00:00:09,000\nBad', 15), 'reversed time rejected');
});

test('phrase-aware, audio-aligned caption engine', () => {
  assert.equal(captionDisplayText('Explore this 2013 SUBARU XV CROSSTREK at GOLDEN AUTO. Priced at $14,688.00.'),
    'Explore this 2013 Subaru XV Crosstrek at Golden Auto. Priced at $14,688.', 'all-caps inventory text and .00 cents cleaned');
  assert.equal(captionDisplayText('Honda CR-V and RAV4 SUV'), 'Honda CR-V and RAV4 SUV', 'hyphen/digit names and SUV preserved');
  const text = 'Explore this 2013 SUBARU XV CROSSTREK at Golden Auto. Just $14,688.00. Book your test drive at mygoldenauto.net.';
  const spans = [[0.02, 4.86], [5.22, 7.88], [8.3, 11.14]]; // measured from the real approved narration
  const cues = captionCues(text, '2013 SUBARU XV CROSSTREK', spans, 11.15);
  assert.equal(cues.length, 5, 'five phrase cues');
  assert.equal(cues[0].text, 'Explore this\n2013 Subaru XV Crosstrek', 'vehicle name kept together on one line');
  assert.ok(cues.map((c) => c.text).join('|').includes('Just $14,688.'), 'price cue has Just + whole dollars');
  assert.ok(Math.abs(cues[3].start - 8.26) < 0.2 && Math.abs(cues[2].start - 5.18) < 0.2, 'sentence cues start at measured pauses');
  let prev = 0;
  for (const c of cues) {
    assert.ok(c.start >= prev && c.end > c.start && c.end <= 11.15 + 0.1, 'cues ordered and inside speech');
    for (const line of c.text.split('\n')) assert.ok(line.length <= CAPTION_MAX_LINE, 'line short enough');
    prev = c.end;
  }
  assert.notEqual(validateSrt(captionSrt(cues, 2.0), 15), '', 'shifted SRT passes validation');
  const fallback = captionCues(text, '2013 SUBARU XV CROSSTREK', [[0.0, 11.0]], 11.15);
  assert.ok(fallback.length === 5 && fallback[4].end <= 11.23, 'single-span fallback spreads cues over the speech');
});

test('website is spelled for speech', () => {
  assert.equal(speechScript('Visit https://www.mygoldenauto.net.'), 'Visit my golden auto dot N, E, T.');
  assert.equal(speechScript('Visit mygoldenauto.net.'), 'Visit my golden auto dot N, E, T.');
  assert.ok(speechScript('Book at mygoldenauto.net. I like it.').includes('my golden auto dot N, E, T. I like it.'));
  assert.equal(speechScript('Visit Golden Auto in San Ramon.'), 'Visit Golden Auto in San Ramon.', 'narration says San Ramon');
});

test('captions show exactly the approved caption text, timed by what she actually said', () => {
  // Recognized words from a real Seedance take: she added "a Subaru X", said the price twice and "San Ramon" came back as "Ramio".
  const take = 'Looking for a dependable SUV? Take a look at this 2013 SUBARU XV CROSSTREK Premium, here at Golden Auto in San Ramon. It comes with all-wheel drive, a silver exterior, and just over 60,000 miles. Just $14,688. Book your test drive today at mygoldenauto.net.';
  const said = 'Looking for a dependable SUV? Take a look at this 2013 Subaru XV Crosstrek Premium here at Golden Auto in San Ramio. It comes with all-wheel drive, a Subaru X, a silver exterior, and just oast over 60,000 miles. Just $14,688. Just $14,688. Book your test drive today at MyGoldenAuto.net.';
  const heard = said.split(' ').map((w, k) => [w, k * 0.5, k * 0.5 + 0.4]);
  const timing = captionSpokenScript(take, heard);
  assert.ok(timing !== null && timing.replace(/\x03\S+ ?/g, '').replaceAll(CAPTION_EXTRA, '') === captionDisplayText(take), 'timing text is the caption text plus marked added words');
  assert.equal(timing.split(CAPTION_EXTRA).length - 1, 6, 'added words (a Subaru X, oast, the repeated price) are marked');
  const skipped = captionSpokenScript('Book your test drive today at mygoldenauto.net.', [['Book', 0, 0.3], ['your', 0.3, 0.5], ['test', 0.5, 0.8], ['drive', 0.8, 1], ['at', 1.1, 1.2], ['mygoldenauto.net.', 1.2, 2]]);
  assert.equal(skipped, 'Book your test drive today at mygoldenauto.net.', 'a word she skipped stays in the caption text');
  assert.equal(captionSpokenScript(take, [['Hello', 0, 0.5], ['there', 0.5, 1]]), null, 'too little recognized: time the caption text alone');

  const spans = [[0.4, 2.06], [2.27, 7.37], [8.52, 12.43], [12.7, 14.75], [15.87, 18.74], [19.19, 21.95], [23.43, 24.74], [25.02, 26.69]];
  const said2 = said.replace('just oast over', 'just over');
  const heard2 = said2.split(' ').map((w, k) => [w, k * 0.5, k * 0.5 + 0.4]);
  const cues = captionCues(String(captionSpokenScript(take, heard2)), '2013 SUBARU XV CROSSTREK', spans, 26.69);
  const all = cues.map((c) => c.text.replaceAll('\n', ' ')).join(' ');
  assert.equal(all, captionDisplayText(take), 'captions show exactly the approved caption text, nothing added or removed');
  assert.ok(!all.includes(CAPTION_EXTRA) && all.split('Just $14,688.').length - 1 === 1 && !all.includes('Subaru X,'), 'added words and the repeat are never shown');
  const at = Object.fromEntries(cues.map((c) => [c.text.replaceAll('\n', ' '), c]));
  assert.ok(Math.abs(at['It comes with all-wheel drive,'].start - 8.48) < 0.15 && Math.abs(at['and just over 60,000 miles.'].end - 14.95) < 0.25, 'mileage caption is gone before the price is said');
  assert.ok(Math.abs(at['Book your test drive today'].start - 23.39) < 0.15 && Math.abs(cues.at(-1).end - 26.73) < 0.25, 'captions after the repeat are still on time');
});

test('prices, scripts and acronym speech (tests/run.php)', () => {
  assert.equal(highestPrice({ VehiclePrice: 8688, TotalAskingPrice: 8826.25, TotalAdvertisingPrice: 0 }, [{ VehiclePrice: 9000 }]), 9000, 'highest price across same vehicle sources');
  assert.equal(highestPrice({ VehiclePrice: 0, TotalPrice: -1 }), null, 'call-for-price stays unknown');
  const v = { Year: 2011, Make: 'HONDA', Model: 'CR-V', Drivetrain: '4WD', price: 8826.25 };
  assert.ok(script(v).includes('Just $8,826.') && !script(v).includes('.25'), 'script uses selected price in whole dollars');
  const long = { Year: 2015, Make: 'RAM', Model: '1500 CREW CAB', Trim: 'Laramie Longhorn Pickup 4D 5 1/2 ft', Drivetrain: '4WD', ExteriorColor: 'Green', Odometer: 154785, price: 15688.25 };
  const s30 = script(long, 30);
  assert.ok(script(v, 15) === script(v) && speechWordCount(script(v)) <= 38, '15-second script unchanged and within limit');
  assert.ok(speechWordCount(s30) >= 45 && speechWordCount(s30) <= 62, `30-second script fills most of the time (${speechWordCount(s30)} spoken words)`);
  assert.ok(s30.includes('Laramie Longhorn') && !s30.includes('Pickup 4D') && s30.includes('four-wheel drive') && s30.includes('just over 154,000 miles') && s30.includes('truck'), '30-second script uses trim, drive, mileage and body style');
  assert.ok(s30.includes('Just $15,688.') && !s30.includes('.25') && s30.includes('mygoldenauto.net'), '30-second script keeps whole-dollar price and website');
  assert.equal(speechScript('Explore this 2013 SUBARU XV CROSSTREK with AWD. A great SUV!'), 'Explore this twenty thirteen Subaru X-V Crosstrek with A-W-D. A great S-U-V!');
  assert.equal(speechScript('2011 HONDA CR-V EX-L, 2022 MAZDA CX-30, 2018 VOLVO XC90 T6, 2015 BMW 3 SERIES 328d, 2015 RAM 1500 CREW CAB, 2008 TOYOTA 4RUNNER, 4WD'),
    'twenty eleven Honda C-R-V E-X-L, twenty twenty-two Mazda C-X 30, twenty eighteen Volvo X-C 90 T 6, twenty fifteen B-M-W 3 Series 328d, twenty fifteen Ram 1500 Crew Cab, two thousand eight Toyota 4 Runner, 4-W-D');
  assert.ok(script(v).includes('with 4WD'), '15-second script keeps drive code uppercase');
  assert.equal(speechScript('with 2WD'), 'with 2-W-D');
  assert.ok(adPrice(14688.25) === '$14,688' && adPrice(14688.0) === '$14,688' && adPrice(999.99) === '$999', 'ad price drops cents');
});

test('native voice speech (tests/native_voice.php)', () => {
  assert.ok(!speechScript('This 2013 SUBARU has 60,000 miles. Just $14,688.').includes('2013') && speechScript('Just $14,688.').includes('fourteen thousand six hundred eighty-eight dollars'));
  const speech = nativeSpeech('Take a look at this 2013 SUBARU XV CROSSTREK here at Golden Auto in San Ramon. Just $14,688. Book your test drive at mygoldenauto.net.');
  assert.ok(speech.includes('my golden auto dot net') && !speech.includes('N, E, T'), 'native voice says "dot net"');
  assert.ok(seedanceRespell(speech).includes('San Rah-moan') && seedanceRespell(speech, { 'San Ramon': 'San Ra-MOAN' }).includes('San Ra-MOAN'), 'respelling default and config override');
});
