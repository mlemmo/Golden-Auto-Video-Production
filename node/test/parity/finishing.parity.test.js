// Auto build and caption timing on real audio, PHP vs Node: FFmpeg makes a short "narration" (three tones with
// pauses), then both run the same scenarios through the real finishing helper (private/finish_video.py) — status
// answers from Higgsfield and fal are fakes. No network, no paid APIs. Skipped without php or ffmpeg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { wrappers } from './wrappers.js';
import { JPEG_40x30 } from '../fixtures/images.js';

const harness = fileURLToPath(new URL('./harness.php', import.meta.url));
const ready = spawnSync('php', ['-v']).status === 0 && spawnSync('ffmpeg', ['-version']).status === 0;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const php = (cases) => JSON.parse(spawnSync('php', [harness], { input: JSON.stringify(cases), maxBuffer: 1 << 26 }).stdout.toString());

test('auto build and captions from real audio match PHP', { skip: !ready && 'php or ffmpeg missing' }, async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-pfin-'); mkdirSync(dir + '/assets/narrations', { recursive: true });
  try {
    // Speech-like tones at 0.3–1.8, 2.3–3.9 and 4.4–5.6 s, silence until 7 s.
    const mp3 = 'c'.repeat(32) + '.mp3', audio = `${dir}/assets/narrations/${mp3}`;
    const gate = "volume='if(between(t,0.3,1.8)+between(t,2.3,3.9)+between(t,4.4,5.6),1,0)':eval=frame";
    assert.equal(spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=7', '-af', gate, '-ar', '44100', audio]).status, 0);
    const photo = 'a'.repeat(40) + '.jpg'; writeFileSync(`${dir}/assets/${photo}`, Buffer.from(JPEG_40x30, 'base64'));
    const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343', ffmpeg_path: '/usr/bin/ffmpeg' };
    const script = 'Take a look at this 2013 Subaru XV Crosstrek. Just $14,688. Book your test drive today at mygoldenauto.net.';
    const narration = { id: 'N1', approved: true, status: 'ready', audio_name: mp3, audio_hash: sha(readFileSync(audio)) };
    const car = (price) => ({ StockNumber: '870288', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price, photos: [cfg.public_base_url + '/assets/' + photo] });
    const fal = (id, extra = {}) => ({ id, provider: 'fal_lipsync', auto_build: true, status: 'completed', video_url: 'https://v.example/x.mp4', narration_id: 'N1', stock: '870288', price: 14688, duration: 15, script, vehicle: '2013 SUBARU XV CROSSTREK', ...extra });
    const nat = (id, extra = {}) => ({ id, voice: 'native', auto_build: true, request_id: 'r-' + id, status: 'in_progress', ...extra });
    const scenarios = [
      [{ state: { inventory: { vehicles: [car(14688)] } }, narrations: [narration],
        jobs: [nat('A'), nat('B'), nat('C', { voice: 'elevenlabs' }), nat('D', { status: 'failed' }), nat('E', { finish_status: 'queued' }), fal('F'), fal('G', { auto_build: '0' }), fal('H', { duration: 6 }), fal('I', { price: 9999 }), fal('J', { stock: 'gone' })],
        narration_lipsync: [{ id: 'L1', auto_build: true, request_id: 'q1', status: 'queued' }, { id: 'L2', auto_build: true, request_id: 'q2', status: 'in_progress' }, { id: 'L3', auto_build: true, request_id: 'q3', status: 'completed' }] },
      { 'r-A': { status: 'completed', video: { url: 'https://cdn.example/a.mp4' } }, 'r-B': 'timeout', 'r-C': { status: 'failed', error: 'Bad https://x.example/y' } }, { L2: 'fal is down' }],
      [{ state: { inventory: { vehicles: [car(null)] } }, narrations: [narration], jobs: [fal('K', { price: null }), fal('M', { narration_id: 'missing' })] }, {}, {}],
    ];
    const cases = [
      ...scenarios.map((s) => ({ fn: 'parityAutoBuild', args: [cfg, ...s] })),
      ...[[{ script, vehicle: '2013 SUBARU XV CROSSTREK', duration: 15, price: 14688 }, 0], [{ script, duration: 15, price: null }, 0.5], [{ script: '', duration: 15 }, 0]]
        .map(([job, offset]) => ({ fn: 'parityNativeCaptions', args: [cfg, job, audio, offset] })),
    ];
    const expected = php(cases);
    for (const [i, c] of cases.entries()) {
      let node; try { node = { ok: await wrappers[c.fn](...structuredClone(c.args)) }; } catch (e) { node = { error: e.message }; }
      assert.deepEqual(JSON.parse(JSON.stringify(node)), expected[i], `${c.fn} case ${i}`);
    }
    assert.ok(expected[0].ok.log.includes('queued final render F') && expected[3].ok.includes('-->'), 'scenarios reach the real finishing helper');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
