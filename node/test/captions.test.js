// Captions, plus the speech, price and script checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_EXTRA, CAPTION_MAX_LINE, captionCallForPrice, captionCues, captionDisplayText, captionDraft, captionSpokenScript, captionSrt, validateSrt,
  captionRetime, captionSnap, captionWrapLines,
} from '../src/lib/captions.js';
import { nativeSpeech, seedanceRespell, speechScript, speechWordCount, withSpeechSites } from '../src/lib/speech.js';
import { adPrice, highestPrice, priceMatches } from '../src/lib/price.js';
import { nativeCues } from '../src/lib/finishing.js';
import { clientDetails } from '../src/lib/clients.js';
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

test('prices, scripts and acronym speech', () => {
  assert.equal(highestPrice({ VehiclePrice: 8688, TotalAskingPrice: 8826.25, TotalAdvertisingPrice: 0 }, [{ VehiclePrice: 9000 }]), 9000, 'highest price across same vehicle sources');
  assert.equal(highestPrice({ VehiclePrice: 0, TotalPrice: -1 }), null, 'call-for-price stays unknown');
  const v = { Year: 2011, Make: 'HONDA', Model: 'CR-V', Drivetrain: '4WD', price: 8826.25 };
  assert.ok(script(v).includes('Priced at $8,826.') && !script(v).includes('.25'), 'script uses selected price in whole dollars');
  const long = { Year: 2015, Make: 'RAM', Model: '1500 CREW CAB', Trim: 'Laramie Longhorn Pickup 4D 5 1/2 ft', Drivetrain: '4WD', ExteriorColor: 'Green', Odometer: 154785, price: 15688.25 };
  const s30 = script(long, 30);
  assert.ok(script(v, 15) === script(v) && speechWordCount(script(v)) <= 38, '15-second script unchanged and within limit');
  assert.ok(speechWordCount(s30) >= 45 && speechWordCount(s30) <= 62, `30-second script fills most of the time (${speechWordCount(s30)} spoken words)`);
  assert.ok(s30.includes('Laramie Longhorn') && !s30.includes('Pickup 4D') && s30.includes('four-wheel drive') && s30.includes('just over 154,000 miles') && s30.includes('truck'), '30-second script uses trim, drive, mileage and body style');
  assert.ok(s30.includes('Priced at $15,688.') && !s30.includes('.25') && s30.includes('mygoldenauto.net'), '30-second script keeps whole-dollar price and website');
  assert.equal(speechScript('Explore this 2013 SUBARU XV CROSSTREK with AWD. A great SUV!'), 'Explore this twenty thirteen Subaru X-V Crosstrek with all wheel drive. A great S-U-V!');
  assert.equal(speechScript('2011 HONDA CR-V EX-L, 2022 MAZDA CX-30, 2018 VOLVO XC90 T6, 2015 BMW 3 SERIES 328d, 2015 RAM 1500 CREW CAB, 2008 TOYOTA 4RUNNER, 4WD'),
    'twenty eleven Honda C-R-V E-X-L, twenty twenty-two Mazda C-X 30, twenty eighteen Volvo X-C 90 T 6, twenty fifteen B-M-W 3 Series 328d, twenty fifteen Ram 1500 Crew Cab, two thousand eight Toyota 4 Runner, four wheel drive');
  assert.ok(script(v).includes('with 4WD'), '15-second script keeps drive code uppercase');
  assert.equal(speechScript('with 2WD'), 'with 2-W-D');
  assert.ok(adPrice(14688.25) === '$14,688' && adPrice(14688.0) === '$14,688' && adPrice(999.99) === '$999', 'ad price drops cents');
});

test('native voice speech', () => {
  assert.ok(!speechScript('This 2013 SUBARU has 60,000 miles. Just $14,688.').includes('2013') && speechScript('Just $14,688.').includes('fourteen thousand six hundred eighty-eight dollars'));
  const speech = nativeSpeech('Take a look at this 2013 SUBARU XV CROSSTREK here at Golden Auto in San Ramon. Just $14,688. Book your test drive at mygoldenauto.net.');
  assert.ok(speech.includes('my golden auto dot net') && !speech.includes('N, E, T'), 'native voice says "dot net"');
  assert.ok(seedanceRespell(speech).includes('San Rah-moan') && seedanceRespell(speech, { 'San Ramon': 'San Ra-MOAN' }).includes('San Ra-MOAN'), 'respelling default and config override');
});

test('no advertised price: no price in scripts, "Call For Price" caption', () => {
  const noPrice = { Year: 2016, Make: 'LAND ROVER', Model: 'RANGE ROVER SPORT', Trim: 'HSE', Drivetrain: '4WD', ExteriorColor: 'LOIRE BLUE', Odometer: 67351, price: null };
  assert.ok(!script(noPrice).includes('$') && !script(noPrice, 30).includes('$') && !script(noPrice, 30).toLowerCase().includes('price'), 'no price: scripts never mention a price');
  const cfp = captionCallForPrice([{ text: 'Book your test drive', start: 20.0, end: 23.5 }], 29.5);
  assert.ok(cfp.at(-1).text === 'Call For Price' && Math.abs(cfp.at(-1).start - 23.8) < 0.01 && Math.abs(cfp.at(-1).end - 29.3) < 0.01, 'Call For Price shown after the speech until the end');
  const tight = captionCallForPrice([{ text: 'Book', start: 20.0, end: 29.4 }], 29.5);
  assert.ok(tight.at(-1).text === 'Call For Price' && tight[0].end <= 28.1 && tight.at(-1).start > tight[0].end && validateSrt(captionSrt(tight, 0.5), 30) !== '', 'speech to the very end: last caption shortened to make room');
  assert.ok(priceMatches(null, null) && !priceMatches(null, 14688.0) && priceMatches(14688.25, 14688.25) && !priceMatches(14688.0, 14690.0), 'no price matches no price only');
});

test('listing shorthand said as words; captions keep it', () => {
  assert.equal(speechScript('2016 RANGE ROVER SPORT 4WD 4dr V6 HSE'), 'twenty sixteen Range Rover Sport four wheel drive four door V 6 H-S-E');
  assert.equal(nativeSpeech('Sedan 4D with 4WD'), 'Sedan four door with four wheel drive');
  assert.ok(speechScript('Q4 4DRV') !== '' && !speechScript('Q4 4DRV').includes('four door') && captionDisplayText('SPORT 4WD 4dr') === 'Sport 4WD 4dr', 'other codes untouched; captions keep 4WD and 4dr');
  assert.equal(speechScript('XT6 AWD, FWD sedan, RWD coupe, a 4x4 truck'), 'X-T 6 all wheel drive, front wheel drive sedan, rear wheel drive coupe, a four by four truck');
  assert.equal(captionDisplayText('AWD FWD RWD 4x4'), 'AWD FWD RWD 4x4');
});

test('each client is named in scripts and its website is said in words', async () => {
  const client = { id: 'elease', name: 'eLease Returns', website: 'https://www.eleasereturns.com', analysis: { dealer: { city: 'Hayward' } } };
  const dealer = clientDetails(client);
  assert.deepEqual(dealer, { name: 'eLease Returns', city: 'Hayward', website: 'eleasereturns.com', website_spoken: 'e lease returns dot com', phone: '' });
  assert.equal(clientDetails({ id: 'golden-auto' }).website_spoken, 'my golden auto dot net');
  const v = { Year: 2019, Make: 'BMW', Model: 'X3', Drivetrain: 'AWD', price: 21500 };
  const s30 = script(v, 30, dealer);
  assert.ok(s30.includes('here at eLease Returns in Hayward.') && s30.endsWith('today at eleasereturns.com.') && !s30.includes('Golden Auto'), '30-second script names the client');
  assert.ok(script(v, 15, dealer).includes('at eLease Returns.') && script(v).includes('at Golden Auto.'), '15-second script names the client; default stays Golden Auto');
  // Client websites stay with the request that set them, even when two requests interleave.
  const sites = { [dealer.website]: dealer.website_spoken };
  const [a, b] = await Promise.all([
    withSpeechSites(sites, async () => { await new Promise((r) => setTimeout(r, 5)); return speechScript('Visit eleasereturns.com.'); }),
    withSpeechSites({}, async () => speechScript('Visit eleasereturns.com.')),
  ]);
  assert.equal(a, 'Visit e lease returns dot com.');
  assert.equal(b, 'Visit eleasereturns.com.');
});

test('captions re-timed from recognized words: comma said without a pause, repeated word, short cue joined', () => {
  // The 2013 Subaru take (2026-10-18): no pause after "Premium," and an added line "Just 14,060 miles." after "miles."
  const script = 'Looking for a dependable SUV? Take a look at this 2013 SUBARU XV CROSSTREK Premium, here at Golden Auto in San Ramon. It comes with all-wheel drive, a silver exterior, with just over 60,000 miles. Just $14,688. Book your test drive today at mygoldenauto.net.';
  const heard = [['Looking', 0.31, 0.46], ['for', 0.46, 0.65], ['a', 0.65, 0.7], ['dependable', 0.7, 1.32], ['SUV?', 1.32, 1.74], ['Take', 2.4, 2.4], ['a', 2.4, 2.4], ['look', 2.4, 2.47], ['at', 2.47, 2.71], ['this', 2.71, 2.86], ['2013', 2.86, 3.76], ['Subaru', 3.76, 4.26], ['XV', 4.26, 4.85], ['Cross', 4.85, 4.89], ['Premium', 4.89, 5.46], ['here', 5.46, 5.7], ['at', 5.7, 5.82], ['Golden', 5.82, 6.23], ['Auto', 6.23, 6.53], ['in', 6.53, 6.54], ['San', 6.54, 6.72], ['Ramon.', 6.72, 7.24], ['It', 7.24, 7.55], ['comes', 7.55, 7.77], ['with', 7.77, 8.08], ['all-wheel', 8.08, 8.76], ['drive,', 8.76, 9.36], ['a', 9.36, 9.73], ['silver', 9.73, 9.82], ['exterior,', 9.82, 10.66], ['and', 10.66, 10.83], ['just', 10.83, 11.07], ['over', 11.07, 11.37], ['60,000', 11.37, 12.23], ['miles.', 12.23, 12.72], ['Just', 13.24, 13.55], ['14,060', 13.55, 15.03], ['miles.', 15.03, 15.92], ['Just', 16.56, 16.56], ['$14,688.', 16.56, 18.84], ['Book', 19.98, 19.98], ['your', 19.98, 20.05], ['test', 20.05, 20.29], ['drive', 20.29, 20.67], ['today', 20.67, 21.21], ['at', 21.21, 21.42], ['MyGoldenAuto.net.', 21.42, 23.76]];
  const spans = [[0.31, 2.0], [2.49, 7.33], [7.9, 9.36], [9.69, 10.93], [11.11, 12.83], [13.25, 13.47], [13.66, 16.16], [16.58, 19.54], [20.59, 23.83]];
  const srt = nativeCues({ script, vehicle: '2013 SUBARU XV CROSSTREK', duration: 30, price: 14688 }, { spans, speech_end: 23.83 }, heard);
  const cues = [...srt.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([\s\S]*?)(?:\n\n|\n?$)/g)].map((m) => [m[1].slice(6), m[2].slice(6), m[3].replace(/\n/g, ' / ')]);
  assert.deepEqual(cues[1], ['02,450', '05,420', 'Take a look / at this 2013 Subaru / XV Crosstrek Premium,'], 'short "Crosstrek Premium," joined; no line ends on "at"');
  assert.deepEqual(cues[2].slice(0, 2), ['05,420', '07,530'], '"here at Golden Auto in San Ramon." while she says it, not a pause later');
  assert.deepEqual(cues[5], ['11,070', '13,030', 'with just over / 60,000 miles.'], 'first "miles.", not the one in her added line');
  assert.equal(cues[6][0], '16,540', 'nothing shown during the added line');
  assert.equal(captionWrapLines('Take a look at this 2013 Subaru XV Crosstrek Premium, and more words here to overflow it'), null, 'too long for three lines');
  assert.equal(captionSnap([[1, 2], [3, 4]], 2.8, true), 3, 'a start just before speech snaps to it');
  assert.equal(captionSnap([[1, 2], [3, 4]], 1.5, true), 1.5, 'a start mid-speech stays');
});
