// Speech check: what was said in a finished video vs the approved script. Whisper is faked; nothing is sent anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechCheck } from '../src/lib/speechcheck.js';
import { speechChunks, nativeCues } from '../src/lib/finishing.js';

const script = 'Need a truck with style? Take a look at this 2015 RAM 1500 CREW CAB Laramie Longhorn, here at Golden Auto in San Ramon. It comes with four-wheel drive, a green exterior, and just over 154,000 miles. Priced at $15,688. Book your test drive today at mygoldenauto.net.';
// Whisper's words: digits, dollar signs and the website as written, one entry per word with its time.
const words = (text, from = 0) => text.split(' ').map((w, i) => [w, from + i * 0.3, from + i * 0.3 + 0.25]);
const now = () => 'T';

test('a clean take passes; numbers, prices, letters and the website compare as spoken', () => {
  const heard = words('Need a truck with style? Take a look at this 2015 Ram 1500 Crew Cab Laramie Longhorn, here at Golden Auto in San Ramon. It comes with four-wheel drive, a green exterior, and just over 154,000 miles. Priced at $15,688. Book your test drive today at mygoldenauto.net.');
  assert.deepEqual(speechCheck(script, heard, now), { ok: true, issues: [], checked_at: 'T' });
});

test('the 2015 Ram take: a phrase left out and the price said again are both reported with times', () => {
  const heard = words('Need a truck with style? Take a look at this 2015 Ram 1500 Crew Cab Laramie Longhorn, here at Golden Auto in San Ramon. It comes with four-wheel drive, 154,000 miles, priced at $15,688 San Ramalers. At $15,688 dollars. Book your test drive today at mygoldenauto.net.');
  const r = speechCheck(script, heard, now);
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((x) => x.kind), ['missing', 'repeat']);
  assert.ok(r.issues[0].message.startsWith('Left out “a green exterior and just over” at '), r.issues[0].message);
  assert.ok(/^Said again: “.*\$15,688.*San Ramalers.*” at \d+\.\d s$/.test(r.issues[1].message), r.issues[1].message);
});

test('a changed word and added words; one stray filler word is ignored', () => {
  const r = speechCheck('Take a look at this 2016 CHEVROLET SILVERADO Z71 at Golden Auto in San Ramon.', words('Take a look at this 2016 Chevrolet Silverado Z70 at the Golden Auto in San Rojo today folks.'), now);
  assert.deepEqual(r.issues.map((x) => [x.kind, x.said || x.expected]), [['changed', 'Z70 at the'], ['changed', 'Rojo today folks.']]);
  assert.equal(speechCheck('', words('hello')), null, 'nothing to compare');
});

test('speech is split at pauses into pieces of up to 8 seconds', () => {
  assert.deepEqual(speechChunks([[0.5, 2], [2.3, 6], [6.4, 9.1], [9.5, 12], [12.2, 20]]), [[0.5, 6], [6.4, 12], [12.2, 20]]);
  assert.deepEqual(speechChunks([]), []);
});
