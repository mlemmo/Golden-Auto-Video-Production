// Video jobs, references, spokespersons, footage. No paid API calls: Higgsfield is a fake transport that records
// requests. Includes ports of tests/references.php, tests/spokespersons.php, tests/job_delete.php, tests/footage.php.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save, state } from '../src/lib/db.js';
import { phpJsonEncode } from '../src/lib/phpjson.js';
import { narrationTables } from '../src/lib/narrations.js';
import { promptNative, prompt, SPOKESPERSON_DEFAULT_DESCRIPTION } from '../src/lib/prompts.js';
import { speechScript } from '../src/lib/speech.js';
import { spokespersonApi, spokespersonFind, spokespersonClean } from '../src/lib/spokespersons.js';
import { uploadReference, referenceFile, referenceImageUrl, jobError, generateJob, pollJob, jobsForClient, goldenJobDelete, goldenFootageBuild, footageLocalPath, galleryPhotos } from '../src/lib/jobs.js';
import { parseMultipart } from '../src/lib/multipart.js';
import { JPEG_1800x900 } from './fixtures/images.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from(JPEG_1800x900, 'base64');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = (p) => mkdtempSync(tmpdir() + '/' + p);
const put = (db, table, r) => db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(r.id, null, phpJsonEncode(r));
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;

test('reference uploads (port of tests/references.php)', async () => {
  const dir = tmp('ga-ref-'); writeFileSync(dir + '/avatar.png', PNG_1x1);
  const cfg = { asset_dir: dir, public_base_url: 'https://example.com/studio', higgsfield_key: 'test-placeholder' };
  const calls = [];
  const mock = async (method, url, headers, body) => { calls.push([method, url, headers, body]); return Buffer.from(method === 'POST' ? JSON.stringify({ upload_url: 'https://storage.example.com/signed', public_url: 'https://cdn.example.com/image.png', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary' } }) : ''); };
  try {
    assert.equal(await uploadReference('https://example.com/studio/assets/avatar.png', cfg, mock), 'https://cdn.example.com/image.png');
    assert.deepEqual(calls.map((c) => c[0]), ['POST', 'PUT']);
    assert.equal(JSON.parse(calls[0][3]).content_type, 'image/png');
    assert.deepEqual(calls[1][2], ['Content-Type: image/png', 'x-amz-tagging: retention=temporary'], 'storage headers only, no API key');
    assert.ok(Buffer.compare(calls[1][3], PNG_1x1) === 0, 'actual file bytes uploaded');
    assert.equal(speechScript('Visit Golden Auto in San Ramon.'), 'Visit Golden Auto in San Ramon.');
    const walk = prompt({ Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK' }, 'Visit San Ramon. A great SUV.', 'showroom', 30);
    assert.ok(!walk.includes('Visit San Ramon') && walk.includes('walks slowly forward') && walk.includes('side nearest the camera') && walk.includes('no watermark'));
    assert.throws(() => referenceFile('https://example.com/studio/assets/../config.php', cfg), /filename/, 'path traversal rejected');
    const fail = async (m, u, h, b) => { if (m === 'PUT') throw new Error('PUT rejected'); return mock(m, u, h, b); };
    await assert.rejects(uploadReference('https://example.com/studio/assets/avatar.png', cfg, fail), /^Error: PUT rejected$/);
    const unsafe = async () => Buffer.from(JSON.stringify({ upload_url: 'https://s.example.com/x', public_url: 'https://c.example.com/x', upload_headers: { Authorization: 'Key leak' } }));
    await assert.rejects(uploadReference('https://example.com/studio/assets/avatar.png', cfg, unsafe), /Unsafe upload headers/);
    assert.ok(!jobError('Failure at https://storage.example.com/?secret=test').includes('secret'), 'signed URLs omitted from displayed errors');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('spokesperson library (port of tests/spokespersons.php) and uploads', () => {
  const dir = tmp('ga-spokes-'); mkdirSync(dir + '/assets'); writeFileSync(dir + '/assets/spokesperson.png', PNG_1x1);
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://example.com:4343' };
  const db = openMemoryDb();
  try {
    let lib = spokespersonApi('spokesperson_list', {}, cfg, db);
    assert.ok(lib.items.length === 1 && lib.items[0].file === 'spokesperson.png' && lib.default === lib.items[0].id, 'original registered as default');
    assert.equal(lib.items[0].url, 'https://example.com:4343/assets/spokesperson.png');
    assert.equal(referenceImageUrl(lib.items[0].url, cfg), lib.items[0].url);
    assert.equal(spokespersonApi('spokesperson_list', {}, cfg, db).items.length, 1, 'seeding runs once');
    writeFileSync(dir + '/assets/spokesperson-abc123.png', PNG_1x1);
    const saved = state(db, 'spokespersons'); saved.items.push({ id: 'abc123', name: 'Dan', description: 'friendly adult man age 40, navy blazer', file: 'spokesperson-abc123.png', created_at: '2026-01-01T00:00:00+00:00' }); save(db, 'spokespersons', saved);
    assert.equal(spokespersonFind(db, cfg, 'abc123').name, 'Dan');
    assert.throws(() => spokespersonFind(db, cfg, 'missing'), /Choose a spokesperson/);
    assert.equal(spokespersonApi('spokesperson_default', { id: 'abc123' }, cfg, db).default, 'abc123');
    lib = spokespersonApi('spokesperson_delete', { id: 'abc123' }, cfg, db);
    assert.ok(lib.items.length === 1 && lib.default === lib.items[0].id, 'delete falls back to remaining default');
    assert.ok(!existsSync(dir + '/assets/spokesperson-abc123.png'), 'uploaded image removed on delete');
    spokespersonApi('spokesperson_delete', { id: lib.items[0].id }, cfg, db);
    assert.ok(existsSync(dir + '/assets/spokesperson.png'), 'original kept on disk');
    assert.throws(() => spokespersonClean('Say "buy now"', 300, 'description'), /double quotes/);
    const v = { Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK' };
    for (const style of ['showroom', 'dynamic']) {
      const p = prompt(v, 'Visit us.', style, 15, 'friendly adult man age 40, navy blazer.');
      assert.ok(p.includes('friendly adult man age 40, navy blazer') && !p.includes('woman age 28') && !p.includes('She '), style);
    }
    assert.ok(prompt(v, 'Visit us.', 'showroom').includes(SPOKESPERSON_DEFAULT_DESCRIPTION));
    // Uploads (multipart file entries, like $_FILES).
    const up = (bytes) => { const f = dir + '/up.tmp'; writeFileSync(f, bytes); return { image: { name: 'me.jpg', tmp_name: f, size: bytes.length, error: 0 } }; };
    assert.throws(() => spokespersonApi('spokesperson_upload', { name: 'Ann', description: 'adult woman' }, cfg, db, up(PNG_1x1)), /at least 300×300/);
    assert.throws(() => spokespersonApi('spokesperson_upload', { name: 'Ann', description: 'adult woman' }, cfg, db, { image: { error: 1 } }), /Image upload failed/);
    lib = spokespersonApi('spokesperson_upload', { name: '  Ann ', description: 'adult\nwoman' }, cfg, db, up(JPEG));
    const ann = lib.items.at(-1);
    assert.ok(ann.name === 'Ann' && ann.description === 'adult woman' && /^spokesperson-[a-f0-9]{16}\.jpg$/.test(ann.file) && existsSync(dir + '/assets/' + ann.file));
    assert.equal(lib.default, ann.id, 'first remaining upload becomes the default');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deleting video jobs (port of tests/job_delete.php)', () => {
  const dir = tmp('ga-jdel-'); mkdirSync(dir + '/assets');
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://example.com:4343' };
  const db = openMemoryDb(); narrationTables(db);
  try {
    const file = 'e'.repeat(40) + '.mp4'; writeFileSync(`${dir}/assets/${file}`, 'v');
    put(db, 'jobs', { id: 'J1', status: 'completed', finish_status: 'completed', captioned_url: `https://example.com:4343/assets/${file}` });
    const r = goldenJobDelete(db, cfg, 'J1');
    assert.ok(count(db) === 0 && !existsSync(`${dir}/assets/${file}`) && r.message.includes('Higgsfield history'));
    put(db, 'jobs', { id: 'J2', status: 'in_progress' });
    assert.throws(() => goldenJobDelete(db, cfg, 'J2'), /still being generated/);
    put(db, 'jobs', { id: 'J3', status: 'completed', finish_status: 'rendering' });
    assert.throws(() => goldenJobDelete(db, cfg, 'J3'), /being captioned/);
    put(db, 'jobs', { id: 'J4', status: 'completed' }); put(db, 'narration_lipsync', { id: 'L1', source_video_id: 'J4', status: 'queued' });
    assert.throws(() => goldenJobDelete(db, cfg, 'J4'), /lip-sync job is still using/);
    put(db, 'jobs', { id: 'J5', status: 'failed', captioned_url: 'https://elsewhere.example/assets/../../x.mp4' });
    goldenJobDelete(db, cfg, 'J5');
    assert.equal(count(db), 3, 'failed video deleted; foreign URLs never touch local files');
    assert.throws(() => goldenJobDelete(db, cfg, 'missing'), /not found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('"My footage" jobs (port of tests/footage.php)', () => {
  const dir = tmp('ga-foot-'); mkdirSync(dir + '/assets/narrations', { recursive: true });
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://example.com:4343' };
  const db = openMemoryDb(); narrationTables(db);
  try {
    save(db, 'inventory', { vehicles: [{ StockNumber: '870288', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price: 14688.25, Vin: 'V1' }] });
    const mp3 = 'a'.repeat(32) + '.mp3'; writeFileSync(`${dir}/assets/narrations/${mp3}`, 'voice');
    const voice = { id: 'N1', stock: '870288', price: 14688.25, status: 'ready', approved: true, duration: 30, audio_duration: 24.3, audio_name: mp3, audio_hash: sha('voice'), text: 'spoken words', caption_script: 'Caption words.' };
    put(db, 'narrations', voice);
    const t = `${dir}/upload.tmp`; writeFileSync(t, 'video bytes');
    const file = { name: 'walkaround.MOV', tmp_name: t, size: 11, error: 0 };
    const probe = (sec, w = 1080, h = 1920, fmt = 'mov,mp4,m4a,3gp,3g2,mj2') => () => ({ duration: sec, width: w, height: h, format: fmt });
    const move = (from, to) => { writeFileSync(to, readFileSync(from)); return true; };
    const inp = { stock: '870288', format: 'instagram_reels', narration_id: 'N1', confirm_current: '1' };
    const build = (i, f, p) => goldenFootageBuild(db, cfg, i, f, { probe: p, move });
    assert.throws(() => build({ ...inp, confirm_current: false }, file, probe(40)), /Confirm the vehicle/);
    assert.throws(() => build({ ...inp, narration_id: 'missing' }, file, probe(40)), /not found/);
    assert.throws(() => build(inp, { ...file, name: 'car.avi' }, probe(40)), /MP4 or MOV/);
    assert.throws(() => build(inp, file, probe(40, 1080, 1920, 'avi')), /MP4 or MOV/);
    assert.throws(() => build(inp, file, probe(20)), /needs at least 25\.3 s/);
    assert.throws(() => build(inp, { ...file, size: 70 * 1024 * 1024 }, probe(40)), /64 MB/);
    assert.throws(() => build(inp, { ...file, error: 1 }, probe(40)), /Upload failed/);
    assert.ok(count(db) === 0 && (!existsSync(`${dir}/assets/footage`) || readdirSync(`${dir}/assets/footage`).length === 0), 'nothing saved when checks fail');
    const job = build(inp, file, probe(41.7));
    assert.ok(job.provider === 'footage' && job.status === 'completed' && job.finish_status === 'queued' && job.audio_swap === true && job.captions_from_audio === true);
    assert.ok(job.script === 'Caption words.' && job.narration_id === 'N1' && job.duration === 30);
    assert.ok(/^[a-f0-9]{32}\.mov$/.test(job.footage_file) && existsSync(footageLocalPath(cfg, job)));
    assert.equal(build(inp, file, probe(27.4)).duration, 27, 'video ends with the footage');
    assert.throws(() => footageLocalPath(cfg, { footage_file: '../x.mov' }), /missing/);
    const inv = state(db, 'inventory'); inv.vehicles.push({ StockNumber: '0939', Year: 2016, Make: 'LAND ROVER', Model: 'RANGE ROVER SPORT', price: null, Vin: 'V2' }); save(db, 'inventory', inv);
    put(db, 'narrations', { ...voice, id: 'N2', stock: '0939', price: null });
    const np = build({ ...inp, stock: '0939', narration_id: 'N2' }, file, probe(40));
    assert.ok(np.price === null && np.stock === '0939', 'no-price car');
    goldenJobDelete(db, cfg, job.id);
    assert.ok(!existsSync(`${dir}/assets/footage/${job.footage_file}`), 'deleting the video removes its uploaded footage');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function generateSetup() {
  const dir = tmp('ga-gen-'); mkdirSync(dir + '/assets/narrations', { recursive: true });
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343', higgsfield_key: 'HF-KEY' };
  const db = openMemoryDb(); narrationTables(db);
  const photos = ['https://imagescf.dealercenter.net/640/480/a.jpg'];
  const car = { StockNumber: '870288', Vin: 'V1', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price: 14688.25, source: 'dcs', photos };
  save(db, 'inventory', { vehicles: [car] });
  writeFileSync(dir + '/assets/sheet-v1.jpg', JPEG); writeFileSync(dir + '/assets/spokesperson.png', JPEG);
  save(db, 'sheet:V1', { url: cfg.public_base_url + '/assets/sheet-v1.jpg', gallery_hash: sha(phpJsonEncode(photos)) });
  const mp3 = 'b'.repeat(32) + '.mp3'; writeFileSync(`${dir}/assets/narrations/${mp3}`, 'voice');
  put(db, 'narrations', { id: 'N1', stock: '870288', price: 14688.25, status: 'ready', approved: true, duration: 30, audio_duration: 24.3, audio_name: mp3, audio_hash: sha('voice'), text: 'Take a look at this twenty thirteen Subaru.', caption_script: 'Take a look at this 2013 Subaru.' });
  const spokes = spokespersonApi('spokesperson_list', {}, cfg, db).items[0].id;
  const calls = [];
  let seedance = () => ({ request_id: 'req-1', status: 'queued' });
  const transport = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body });
    if (url.endsWith('/files/generate-upload-url')) return Buffer.from(JSON.stringify({ upload_url: 'https://storage.example.com/put/' + calls.length, public_url: 'https://cdn.example.com/' + calls.length + '.jpg', upload_headers: { 'Content-Type': 'image/jpeg' } }));
    if (method === 'PUT') return Buffer.from('');
    return Buffer.from(JSON.stringify(seedance()));
  };
  const inp = { stock: '870288', voice: 'elevenlabs', narration_id: 'N1', duration: 30, style: 'showroom', format: 'instagram_reels', spokesperson: spokes, confirm_current: true, approve_spend: true };
  return { dir, cfg, db, calls, transport, inp, car, setSeedance: (f) => { seedance = f; } };
}

test('generate: approval, exact prompt, one paid request per fingerprint, no automatic retries', async () => {
  const { dir, cfg, db, calls, transport, inp, car, setSeedance } = generateSetup();
  const gen = (i) => generateJob(db, cfg, 'golden-auto', { ...i, client: 'golden-auto' }, { transport });
  const submits = () => calls.filter((c) => c.url.includes('seedance')).length;
  try {
    await assert.rejects(gen({ ...inp, approve_spend: false }), /Confirm this paid generation/);
    await assert.rejects(gen({ ...inp, confirm_current: false }), /Confirm that imported availability/);
    await assert.rejects(gen({ ...inp, duration: 15 }), /made for a 30-second video/);
    await assert.rejects(gen({ ...inp, style: 'dynamic' }), /fixed at 15 seconds/);
    await assert.rejects(gen({ ...inp, format: 'tv' }), /Choose a video format/);
    assert.equal(calls.length, 0, 'nothing sent for a refused request');

    const job = await gen(inp);
    assert.deepEqual([job.status, job.request_id, job.auto_build, job.narration_id, job.script], ['queued', 'req-1', true, 'N1', 'Take a look at this 2013 Subaru.']);
    assert.ok(calls.slice(0, 4).every((c) => c.url.startsWith('https://api.higgsfield.ai/files/') ? c.headers.includes('Authorization: Key HF-KEY') : !c.headers.some((h) => /authorization/i.test(h))), 'key only to the API, never to storage');
    const sent = JSON.parse(calls.find((c) => c.url.includes('seedance')).body);
    const expected = promptNative(car, 'Take a look at this twenty thirteen Subaru.', 30, SPOKESPERSON_DEFAULT_DESCRIPTION, 'speech', 24.3, {});
    assert.equal(sent.prompt, expected, 'the exact native prompt with the approved narration');
    assert.deepEqual(sent.audio_urls, [cfg.public_base_url + '/assets/narrations/' + 'b'.repeat(32) + '.mp3']);
    assert.deepEqual([sent.duration, sent.resolution, sent.aspect_ratio, sent.generate_audio, sent.image_urls.length], [30, '720p', '9:16', true, 2]);

    await assert.rejects(gen(inp), /already exists/);
    assert.equal(submits(), 1, 'the identical request was not paid twice');

    // Provider marks it failed → the same request may be made again on purpose.
    db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(phpJsonEncode({ ...job, status: 'failed' }), job.id);
    setSeedance(() => { throw new Error('network'); });
    await assert.rejects(gen(inp), /could not be confirmed/);
    assert.equal(submits(), 2);
    const uncertain = JSON.parse(db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 1').get().payload);
    assert.equal(uncertain.status, 'submission_uncertain');
    await assert.rejects(gen(inp), /already exists/, 'an unclear outcome keeps the reservation');
    assert.equal(submits(), 2);

    // A failed reference upload releases the reservation before anything is submitted.
    const before = submits();
    await assert.rejects(generateJob(db, cfg, 'golden-auto', { ...inp, format: 'square' }, { transport: async () => { throw new Error('Reference upload POST failed (HTTP 500). No video was submitted.'); } }), /HTTP 500/);
    const failed = db.prepare('SELECT fingerprint, payload FROM jobs ORDER BY rowid DESC LIMIT 1').get();
    assert.ok(failed.fingerprint === null && JSON.parse(failed.payload).status === 'reference_upload_failed' && submits() === before);

    // Status poll (free) and the client's job list.
    const polled = await pollJob(db, cfg, job.id, async (url, payload, key) => { assert.ok(url.endsWith('/requests/req-1/status') && payload === null && key === 'HF-KEY'); return JSON.stringify({ status: 'completed', video: { url: 'https://cdn.example.com/v.mp4' } }); });
    assert.deepEqual([polled.status, polled.video_url, polled.error], ['completed', 'https://cdn.example.com/v.mp4', '']);
    await pollJob(db, cfg, job.id, async () => { throw new Error('a finished job is not asked again'); });
    await assert.rejects(pollJob(db, cfg, uncertain.id), /Submission uncertain/);
    const list = jobsForClient(db, 'golden-auto');
    assert.ok(list.length === 3 && list.every((s) => typeof s === 'string'), 'stored JSON strings, newest first');
    assert.equal(jobsForClient(db, 'bay-motors').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('generate: native voice and silent walkaround prompts; changed photos stop the request', async () => {
  const { dir, cfg, db, calls, transport, inp, car } = generateSetup();
  try {
    const native = await generateJob(db, cfg, 'golden-auto', { ...inp, voice: 'native', script: 'Visit Golden Auto in San Ramon at mygoldenauto.net.' }, { transport });
    assert.equal(native.speech_script, 'Visit Golden Auto in San Ramon at my golden auto dot net.');
    const sent = JSON.parse(calls.at(-1).body);
    assert.ok(!('audio_urls' in sent) && sent.generate_audio === true && sent.prompt.includes('San Rah-moan'));
    await generateJob(db, cfg, 'golden-auto', { ...inp, voice: 'narration', style: 'dynamic', duration: 15, script: 'Hi.' }, { transport });
    const silent = JSON.parse(calls.at(-1).body);
    assert.ok(silent.generate_audio === false && silent.prompt === prompt(car, 'Hi.', 'dynamic', 15, SPOKESPERSON_DEFAULT_DESCRIPTION));
    save(db, 'inventory', { vehicles: [{ ...car, photos: ['https://imagescf.dealercenter.net/640/480/b.jpg'] }] });
    await assert.rejects(generateJob(db, cfg, 'golden-auto', { ...inp, format: 'square' }, { transport }), /photos changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gallery photos come from the vehicle media block, resized to 640×480', () => {
  const html = '<div id="DWS_VDP_Media_1"><img data-pin-media="https://imagescf.dealercenter.net/1024/768/a.jpg"><img data-base-img-url="https://imagescf.dealercenter.net/1024/768/a.jpg"><img data-pin-media="https://evil.example/x.jpg"></div><img data-pin-media="https://imagescf.dealercenter.net/1/1/related.jpg">';
  assert.deepEqual(galleryPhotos(html), ['https://imagescf.dealercenter.net/640/480/a.jpg']);
  assert.deepEqual(galleryPhotos('<meta property="og:image" content="https://imagescf.dealercenter.net/9/9/b.jpg">'), ['https://imagescf.dealercenter.net/640/480/b.jpg']);
});

test('multipart uploads read like $_POST and $_FILES', async () => {
  const dir = tmp('ga-mp-');
  try {
    const form = new FormData();
    form.append('stock', '870288'); form.append('name', 'Ann "A" é');
    form.append('footage', new Blob([Buffer.from('video\r\n--bytes')]), 'C:\\clips\\walk.mov');
    const req = new Request('http://x/', { method: 'POST', body: form });
    const { fields, files } = parseMultipart(Buffer.from(await req.arrayBuffer()), req.headers.get('content-type'), dir);
    assert.deepEqual(fields, { stock: '870288', name: 'Ann "A" é' });
    assert.deepEqual([files.footage.name, files.footage.size, files.footage.error, readFileSync(files.footage.tmp_name, 'utf8')], ['walk.mov', 14, 0, 'video\r\n--bytes']);
    const raw = Buffer.from('--b\r\nContent-Disposition: form-data; name="image"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--b--\r\n');
    assert.equal(parseMultipart(raw, 'multipart/form-data; boundary=b', dir).files.image.error, 4, 'no file chosen');
    const f2 = new FormData(); f2.append('media', new Blob([Buffer.alloc(20)]), 'a.zip');
    const r2 = new Request('http://x/', { method: 'POST', body: f2 });
    assert.equal(parseMultipart(Buffer.from(await r2.arrayBuffer()), r2.headers.get('content-type'), dir, 10).files.media.error, 1, 'over upload_max_filesize');
    assert.throws(() => parseMultipart(Buffer.from('x'), 'application/json', dir), /Invalid request/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
