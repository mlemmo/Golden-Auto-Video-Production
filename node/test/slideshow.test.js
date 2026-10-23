// Photo slideshow videos: the timeline, the FFmpeg graph, the jobs (one per shape), the 60-second script, and a real
// small render of the master and its cards with the local helper. No paid API calls and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save } from '../src/lib/db.js';
import { jsonEncode } from '../src/lib/storedjson.js';
import { narrationTables, narrationVoiceSettings } from '../src/lib/narrations.js';
import { runProcess } from '../src/lib/finishing.js';
import { captionWorkerRun, renderArgs, jobMusic } from '../src/lib/worker.js';
import { musicApi, musicFilter } from '../src/lib/music.js';
import { backdropApi, applyBackdrop } from '../src/lib/backdrops.js';
import { goldenJobDelete } from '../src/lib/jobs.js';
import { script } from '../src/lib/scripts.js';
import { speechWordCount } from '../src/lib/speech.js';
import { slideshowPlan, slideshowArgs, slideFit, cardPrice, formatSize, goldenSlideshowBuild, slideshowMaster, heroOrder } from '../src/lib/slideshow.js';
import { dcNormalize } from '../src/lib/dealercenter.js';
import { JPEG_40x30, JPEG_1800x900 } from './fixtures/images.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (db, table, r) => db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(r.id, null, jsonEncode(r));
const getJob = (db, id) => JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(id).payload);
const DEALER = { name: 'Golden Auto', city: 'San Ramon', website: 'mygoldenauto.net', phone: '925-555-0100' };

test('slideshow timeline', () => {
  const p = slideshowPlan({ total: 60, speechEnd: 52.5, photos: 24 });
  assert.equal(p.total, 60);
  assert.deepEqual([p.slides[0].kind, p.slides.at(-1).kind], ['intro', 'outro']);
  const photos = p.slides.filter((s) => s.kind === 'photo');
  assert.equal(photos.length, 23, 'photos at least 2.2 s each; the first ones in gallery order');
  assert.deepEqual(photos.map((s) => s.photo), [...Array(23).keys()]);
  assert.ok(p.slides.at(-1).start >= 53.3 && 60 - p.slides.at(-1).start <= 6, 'closing card after the speech, at most 6 s');
  for (let i = 1; i < p.slides.length; i++) assert.equal(p.slides[i].start, p.slides[i - 1].end, 'slides follow each other');
  // Few photos: each stays longer; YouTube shape: no intro card.
  const yt = slideshowPlan({ total: 30, speechEnd: 25, photos: 3, intro: false });
  assert.equal(yt.slides[0].kind, 'photo');
  assert.equal(yt.slides.filter((s) => s.kind === 'photo').length, 3);
  // A voice that runs to the end makes the video a little longer instead of cutting the card short.
  const long = slideshowPlan({ total: 60, speechEnd: 58.6, photos: 30 });
  assert.ok(long.total === 63 && long.total - long.slides.at(-1).start >= 3);
  assert.deepEqual(slideshowPlan({ total: long.total, speechEnd: 58.6, photos: 30 }), long, 'the worker re-plans the same timeline');
});

test('slideshow FFmpeg graph', () => {
  const plan = slideshowPlan({ total: 12, speechEnd: 7, photos: 2 });
  const inputs = plan.slides.map((s, i) => ({ file: `in-${i}.jpg`, fit: i === 1 ? 'contain' : 'cover' }));
  const args = slideshowArgs({ ffmpeg_path: '/usr/bin/ffmpeg' }, plan, inputs, [1080, 1920], 'master.mp4');
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.equal(args.filter((a) => a === '-i').length, plan.slides.length);
  assert.equal((graph.match(/zoompan=/g) ?? []).length, plan.slides.length);
  assert.equal((graph.match(/xfade=/g) ?? []).length, plan.slides.length - 1);
  assert.ok(graph.includes('gblur') && graph.includes('[1:v]split=2'), 'contain: whole photo over a blurred copy');
  assert.ok(graph.includes(`offset=${plan.slides[1].start.toFixed(3)}`));
  assert.ok(args.includes('-an') && args.at(-1) === 'master.mp4' && args[args.indexOf('-t') + 1] === '12.000');
  assert.equal(slideFit({ width: 1600, height: 1200 }, formatSize('youtube')), 'cover', '4:3 fills a 16:9 frame');
  assert.equal(slideFit({ width: 1600, height: 1200 }, formatSize('instagram_reels')), 'contain');
  assert.equal(slideFit({ width: 1600, height: 1200 }, formatSize('square')), 'contain');
  assert.deepEqual([cardPrice(14688.25), cardPrice(null)], ['Just $14,688', 'Call For Price']);
});

function setup() {
  const dir = mkdtempSync(tmpdir() + '/ga-slides-'); mkdirSync(dir + '/assets/narrations', { recursive: true }); mkdirSync(dir + '/data');
  const cfg = { asset_dir: dir + '/assets', data_dir: dir + '/data', public_base_url: 'https://example.com:4343', ffmpeg_path: '/usr/bin/ffmpeg' };
  const db = openMemoryDb(); narrationTables(db);
  const names = ['a', 'b', 'c'].map((c) => c.repeat(40) + '.jpg');
  for (const n of names) writeFileSync(`${dir}/assets/${n}`, Buffer.from(JPEG_40x30, 'base64'));
  save(db, 'inventory', { vehicles: [{ StockNumber: 'S1', Vin: 'V1', Year: 2015, Make: 'VOLKSWAGEN', Model: 'GOLF', price: 13550, photos: names.map((n) => `https://example.com:4343/assets/${n}`) }] });
  const mp3 = 'a'.repeat(32) + '.mp3'; writeFileSync(`${dir}/assets/narrations/${mp3}`, 'voice');
  put(db, 'narrations', { id: 'N1', stock: 'S1', price: 13550, status: 'ready', approved: true, duration: 60, audio_duration: 52, audio_name: mp3, audio_hash: sha('voice'), text: 'spoken words', caption_script: 'Caption words.' });
  return { dir, cfg, db };
}

test('slideshow jobs: one per shape', () => {
  const { dir, cfg, db } = setup();
  try {
    const inp = { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['instagram_reels', 'facebook_feed', 'youtube'], approved_by: 'sawyer@example.com' };
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, confirm_current: false }, DEALER), /Confirm the vehicle/);
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, formats: ['tiktok'] }, DEALER), /at least one video shape/);
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, stock: 'nope' }, DEALER), /current vehicle/);
    put(db, 'narrations', { id: 'N2', stock: 'S1', price: 12000, status: 'ready', approved: true, duration: 60, audio_duration: 50, audio_name: 'a'.repeat(32) + '.mp3', audio_hash: sha('voice') });
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, narration_id: 'N2' }, DEALER), /old price/);
    const jobs = goldenSlideshowBuild(db, cfg, inp, DEALER);
    assert.deepEqual(jobs.map((j) => j.format), ['instagram_reels', 'facebook_feed', 'youtube']);
    for (const j of jobs) {
      assert.ok(j.provider === 'slideshow' && j.finish_status === 'queued' && j.audio_swap && j.captions_from_audio && j.voice === 'elevenlabs');
      assert.ok(j.duration === 60 && j.speech_end === 52.5 && j.photos.length === 3 && j.approved_by === 'sawyer@example.com');
      assert.deepEqual(j.cards, { dealer: 'Golden Auto', website: 'mygoldenauto.net', phone: '925-555-0100', city: 'San Ramon', vehicle: '2015 VOLKSWAGEN GOLF', price: 'Just $13,550' });
    }
    assert.deepEqual(jobs.map((j) => j.intro_card), [true, true, false], 'YouTube opens on the car (skip button at 5 s)');
    assert.equal(goldenJobDelete(db, cfg, jobs[0].id).message, 'Slideshow video deleted.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('60-second script and voice', () => {
  const car = { StockNumber: 'S1', Vin: 'V1', Year: 2015, Make: 'VOLKSWAGEN', Model: 'GOLF', Trim: 'TDI S Hatchback Sedan 4D', Drivetrain: 'FWD', ExteriorColor: 'Gray', Odometer: 77611, price: 13550 };
  const s60 = script(car, 60, DEALER, { hook: 'Want a fun, practical hatchback for everyday driving?', highlight: 'It makes every errand a little more enjoyable.' });
  const n = speechWordCount(s60);
  assert.ok(n >= 100 && n <= 122, `about 105–120 spoken words (${n})`);
  assert.ok(s60.includes('Priced at $13,550.') && s60.endsWith('mygoldenauto.net.') && s60.includes('photos'));
  assert.ok(!script({ ...car, price: null }, 60, DEALER).includes('$'), 'no price, no price mentioned');
  assert.ok(speechWordCount(script({ ...car, Model: 'GOLF SPORTWAGEN ALLTRACK', Trim: 'TSI SE Premium Wagon with a Very Long Trim Name' }, 60, DEALER)) <= 122);
  assert.equal(narrationVoiceSettings({}, 60).speed, 0.9, 'read a little slower, like the 30-second previews');
});

test('slideshow master and cards (real FFmpeg)', { skip: !hasFfmpeg }, async () => {
  const { dir, cfg, db } = setup();
  try {
    const [job] = goldenSlideshowBuild(db, cfg, { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['square'] }, DEALER);
    job.duration = 7; job.speech_end = 3;   // short, so the test renders quickly
    const work = dir + '/data/w'; mkdirSync(work);
    const ffmpeg = async (args, w) => (await runProcess(args[0], args.slice(1), { cwd: w })).code;
    const plan = await slideshowMaster(cfg, job, work, ffmpeg);
    assert.deepEqual(plan.slides.map((s) => s.kind), ['intro', 'photo', 'outro']);
    assert.ok(existsSync(work + '/intro.png') && existsSync(work + '/outro.png'));
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', work + '/master.mp4']);
    const d = JSON.parse(p.stdout.toString());
    assert.deepEqual([d.streams[0].width, d.streams[0].height], [1080, 1080]);
    assert.ok(Math.abs(Number(d.format.duration) - 7) < 0.1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('caption worker draws slideshows instead of downloading', async () => {
  const { dir, cfg, db } = setup();
  try {
    const [job] = goldenSlideshowBuild(db, cfg, { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['youtube'] }, DEALER);
    const seen = [];
    const opts = {
      autoBuildOpts: { poll: async () => ({}) },
      download: async () => { throw new Error('no download for slideshows'); },
      slideshow: async (c, j, work) => { seen.push(j.id); writeFileSync(work + '/master.mp4', 'video'); },
      captions: async () => '1\n00:00:00,500 --> 00:00:02,000\nCaption words.\n',
      ffmpeg: async (args) => { seen.push(args.join(' ')); writeFileSync(args.at(-1), Buffer.alloc(2000)); return 0; },
    };
    await captionWorkerRun(db, cfg, opts);
    const done = getJob(db, job.id);
    assert.equal(done.finish_status, 'completed', done.finish_error);
    assert.equal(seen[0], job.id);
    assert.ok(seen[1].includes('scale=1920:1080') && seen[1].includes('narrations/'), '16:9 render with the approved voice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('background music library and mix', { skip: !hasFfmpeg }, async () => {
  const { dir, cfg, db } = setup();
  try {
    const tmp = (n, body = 'x') => { const f = `${dir}/data/${n}`; writeFileSync(f, body); return f; };
    const up = (name, file, probe = () => ({ duration: 95, codec: 'mp3' })) => musicApi('music_upload', { name }, cfg, db, { music: file }, { probe });
    assert.deepEqual(musicApi('music_list', {}, cfg, db).items, []);
    assert.throws(() => up('', { name: 'a.mp3', tmp_name: tmp('a'), size: 1, error: 0 }), /name/);
    assert.throws(() => up('Song', { name: 'a.ogg', tmp_name: tmp('a'), size: 1, error: 0 }), /MP3, M4A or WAV/);
    assert.throws(() => up('Song', { name: 'a.mp3', tmp_name: tmp('a'), size: 1, error: 0 }, () => null), /no audio/);
    assert.throws(() => up('Song', { name: 'a.mp3', tmp_name: tmp('a'), size: 1, error: 0 }, () => ({ duration: 4 })), /shorter than 10/);
    // A real short track (FFmpeg tone) so the final render mixes it.
    const track = `${dir}/data/tone.mp3`;
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=330:d=12', '-ac', '2', track]);
    const lib = up('Upbeat <test>', { name: 'Tone.MP3', tmp_name: track, size: 1000, error: 0 }, () => ({ duration: 12, codec: 'mp3' }));
    assert.equal(lib.items.length, 1);
    const t = lib.items[0];
    assert.ok(t.url.startsWith('https://example.com:4343/assets/music/music-') && t.duration === 12);
    const [job] = goldenSlideshowBuild(db, cfg, { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['square'], music: t.id }, DEALER);
    assert.ok(job.music_id === t.id && /^music-[a-f0-9]{16}\.mp3$/.test(job.music_file));
    assert.throws(() => goldenSlideshowBuild(db, cfg, { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['square'], music: 'gone' }, DEALER), /removed/);
    const args = renderArgs(cfg, job, '/n/v.mp3', 'o.mp4', jobMusic(cfg, job));
    assert.ok(args.includes('-stream_loop') && args.join(' ').includes('sidechaincompress') && args.includes('-shortest'));
    assert.ok(musicFilter('1:a', '2:a', 500, 60).includes('afade=t=out:st=57.50'), 'faded out over the last 2.5 s');
    assert.equal(jobMusic(cfg, { music_file: '' }), null);
    musicApi('music_delete', { id: t.id }, cfg, db);
    assert.throws(() => jobMusic(cfg, job), /music for this video was deleted/);
    assert.deepEqual(musicApi('music_list', {}, cfg, db).items, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('showroom backdrops: library, build option, only outside photos replaced, cached', async () => {
  const { dir, cfg, db } = setup();
  try {
    assert.equal(backdropApi('backdrop_list', {}, cfg, db).available, false, 'no cut-out model configured');
    const inp = { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['square'] };
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, background: 'studio' }, DEALER), /not set up/);
    cfg.cutout_python = process.execPath;   // any executable: the composer itself is faked below
    const list = backdropApi('backdrop_list', {}, cfg, db);
    assert.ok(list.available && list.builtin.map((b) => b.id).join() === 'studio,white' && list.items.length === 0);
    const img = `${dir}/data/showroom.jpg`; writeFileSync(img, Buffer.from(JPEG_1800x900, 'base64'));
    assert.throws(() => backdropApi('backdrop_upload', { name: 'Floor' }, cfg, db, { backdrop: { name: 'a.jpg', tmp_name: `${dir}/assets/${'a'.repeat(40)}.jpg`, size: 10, error: 0 } }), /at least 1200/);
    const up = backdropApi('backdrop_upload', { name: 'Our showroom' }, cfg, db, { backdrop: { name: 's.jpg', tmp_name: img, size: 10, error: 0 } });
    assert.ok(up.items.length === 1 && up.items[0].url.includes('/assets/backdrops/backdrop-'));
    assert.throws(() => backdropApi('backdrop_delete', { id: 'studio' }, cfg, db), /Built-in/);
    const [job] = goldenSlideshowBuild(db, cfg, { ...inp, background: up.items[0].id }, DEALER);
    assert.ok(job.background === up.items[0].id && job.background_name === 'Our showroom');
    assert.throws(() => goldenSlideshowBuild(db, cfg, { ...inp, background: 'nope' }, DEALER), /removed/);
    // Three photos: exterior, interior, exterior. Only the two exteriors are composed, and only once.
    const photo = (n, body) => { const f = `${dir}/data/p${n}.jpg`; writeFileSync(f, body); return { file: f, size: { width: 40, height: 30 } }; };
    const files = () => [photo(0, 'ext-a'), photo(1, 'int'), photo(2, 'ext-b')];
    const label = { 'ext-a': 'exterior', int: 'interior', 'ext-b': 'exterior' };
    let classified = 0, composed = 0;
    const opts = {
      classify: (paths) => { classified += paths.length; return Object.fromEntries(paths.map((p) => [p, label[readFileSync(p, 'utf8')]])); },
      compose: async (c, items, spec, layout) => { composed += items.length; assert.equal(spec, 'studio'); assert.deepEqual(layout, { width: 1080, height: 1920, floor: 0.64 }); for (const it of items) writeFileSync(it.out, 'composed'); return items.map((it) => it.out); },
    };
    const first = files();
    assert.equal(await applyBackdrop(cfg, first, { id: 'studio', spec: 'studio' }, [1080, 1920], opts), 2);
    assert.ok(first[0].file.includes('backdrop-cache') && first[1].file.endsWith('p1.jpg') && first[2].file.includes('backdrop-cache'));
    assert.deepEqual(first[0].size, { width: 1080, height: 1920 }, 'a studio sweep is drawn at the video size');
    const again = files();
    assert.equal(await applyBackdrop(cfg, again, { id: 'studio', spec: 'studio' }, [1080, 1920], opts), 2);
    assert.deepEqual([classified, composed], [3, 2], 'the second shape reuses labels and pictures');
    assert.equal(await applyBackdrop(cfg, [photo(3, 'new')], { id: 'white', spec: 'white' }, [1080, 1920], { ...opts, classify: () => null }), 0, 'no classifier: photos unchanged');
    backdropApi('backdrop_delete', { id: up.items[0].id }, cfg, db);
    assert.equal(backdropApi('backdrop_list', {}, cfg, db).items.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ad cut: no intro card, hero exterior then interior and detail first', async () => {
  assert.deepEqual(heroOrder(['a', 'b', 'c', 'd', 'e'], ['text', 'interior', 'exterior', 'detail', 'exterior']), ['c', 'b', 'd', 'a', 'e']);
  assert.deepEqual(heroOrder(['a', 'b'], ['interior', 'interior']), ['a', 'b'], 'missing kinds are skipped');
  const { dir, cfg, db } = setup();
  try {
    const [job] = goldenSlideshowBuild(db, cfg, { client: 'golden-auto', stock: 'S1', narration_id: 'N1', confirm_current: '1', formats: ['facebook_feed'], ad_cut: '1' }, DEALER);
    assert.ok(job.ad_cut === true && job.intro_card === false);
    job.duration = 12; job.speech_end = 6;
    const seen = [];
    const ffmpeg = async (args) => { seen.push(args.filter((a, i) => args[i - 1] === '-i')); return 0; };
    const labels = (c, files) => ({ labels: ['interior', 'detail', 'exterior'], sums: files.map(() => 'x') });
    const plan = await slideshowMaster(cfg, job, dir + '/data', ffmpeg, { labels, python: async () => ({}) });
    assert.equal(plan.slides[0].kind, 'photo', 'opens on a photo');
    assert.deepEqual(seen[0].slice(0, 3).map((f) => f.split('/').pop()), ['photo-2.jpg', 'photo-0.jpg', 'photo-1.jpg'], 'exterior first, then interior, then detail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const car = { stock: 'S1', year: 2015, make: 'RAM', model: '1500', photo_count: 0 };
  assert.equal(dcNormalize({ ...car, page_url: 'https://www.mygoldenauto.net/inventory/ram/1500-crew-cab/666777/' }).page_url, 'https://www.mygoldenauto.net/inventory/ram/1500-crew-cab/666777/');
  assert.throws(() => dcNormalize({ ...car, page_url: 'javascript:alert(1)' }), /page_url/);
  assert.equal(dcNormalize(car).page_url, '');
});
