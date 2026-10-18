// Caption worker and auto build. No paid API calls and no network: status checks are fakes, the "download" copies a
// video FFmpeg makes here; captions and the render use the real finishing helper and FFmpeg. Includes the port of
// tests/auto_build.php.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save } from '../src/lib/db.js';
import { phpJsonEncode } from '../src/lib/phpjson.js';
import { narrationTables, narrationLoad } from '../src/lib/narrations.js';
import { autoBuild } from '../src/lib/autobuild.js';
import { captionWorkerRun, renderArgs, downloadMaster } from '../src/lib/worker.js';
import { heardWords } from '../src/lib/finishing.js';
import { finishingRoutes } from '../src/routes/finishing.js';
import { JPEG_40x30 } from './fixtures/images.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (db, table, r) => db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(r.id, null, phpJsonEncode(r));
const getJob = (db, id) => JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(id).payload);

function setup() {
  const dir = mkdtempSync(tmpdir() + '/ga-work-'); mkdirSync(dir + '/assets/narrations', { recursive: true }); mkdirSync(dir + '/data');
  const cfg = { asset_dir: dir + '/assets', data_dir: dir + '/data', public_base_url: 'https://example.com:4343', ffmpeg_path: '/usr/bin/ffmpeg' };
  const db = openMemoryDb(); narrationTables(db);
  const photo = 'a'.repeat(40) + '.jpg'; writeFileSync(`${dir}/assets/${photo}`, Buffer.from(JPEG_40x30, 'base64'));
  save(db, 'inventory', { vehicles: [{ StockNumber: 'S1', Vin: 'stock:S1', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price: 14688, photos: [`https://example.com:4343/assets/${photo}`] }] });
  return { dir, cfg, db };
}

test('auto build (port of tests/auto_build.php)', { skip: !hasFfmpeg && 'ffmpeg missing' }, async () => {
  const { dir, cfg, db } = setup();
  try {
    put(db, 'narration_lipsync', { id: 'L1', auto_build: true, request_id: 'r1', status: 'queued' });
    put(db, 'narration_lipsync', { id: 'L2', auto_build: false, request_id: 'r2', status: 'queued' });
    put(db, 'narration_lipsync', { id: 'L3', auto_build: true, request_id: 'r3', status: 'completed' });
    const polled = [];
    await autoBuild(db, cfg, { poll: async (id) => polled.push(id), hfStatus: async () => { throw new Error('no native jobs'); } });
    assert.deepEqual(polled, ['L1'], 'only running auto-build lip-sync jobs are checked');
    await autoBuild(db, cfg, { poll: async () => { throw new Error('fal unreachable'); } });
    assert.match(narrationLoad(db, 'narration_lipsync', 'L1').error, /fal unreachable/, 'failed check recorded, job kept');

    put(db, 'jobs', { id: 'J1', auto_build: true, provider: 'fal_lipsync', status: 'completed', video_url: 'https://v.example/x.mp4', stock: 'S1', vehicle: '2013 SUBARU XV CROSSTREK', price: 14688, duration: 15, script: 'Just $14,688.', narration_id: 'missing' });
    put(db, 'jobs', { id: 'J2', auto_build: false, provider: 'fal_lipsync', status: 'completed', video_url: 'https://v.example/y.mp4', narration_id: 'missing' });
    await autoBuild(db, cfg, { poll: async () => null });
    assert.ok(getJob(db, 'J1').finish_status === 'failed' && getJob(db, 'J1').finish_error.includes('Automatic build stopped'));
    assert.equal(getJob(db, 'J2').finish_status, undefined, 'manual lip-sync videos are left for manual finishing');

    const mp3 = `${dir}/assets/narrations/${'b'.repeat(32)}.mp3`;
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-filter_complex', '[0][1]concat=n=2:v=0:a=1[s];[s]atrim=0:4,asetpts=N/SR/TB', '-t', '4', mp3]).status, 0);
    put(db, 'narrations', { id: 'N1', status: 'ready', approved: true, audio_name: 'b'.repeat(32) + '.mp3', audio_hash: sha(readFileSync(mp3)), caption_script: 'Explore this SUBARU XV CROSSTREK. Just $14,688.' });
    put(db, 'jobs', { id: 'J3', auto_build: true, provider: 'fal_lipsync', status: 'completed', video_url: 'https://v.example/z.mp4', stock: 'S1', vehicle: '2013 SUBARU XV CROSSTREK', price: 14688, duration: 15, format: 'instagram_reels', script: 'Explore this SUBARU XV CROSSTREK. Just $14,688.', narration_id: 'N1' });
    await autoBuild(db, cfg, { poll: async () => null });
    const j3 = getJob(db, 'J3');
    assert.ok(j3.finish_status === 'queued' && j3.finishing_plan && j3.captions_srt.includes('-->') && j3.captions_srt.includes('$14,688'), 'captioned and queued');
    await autoBuild(db, cfg, { poll: async () => null });
    assert.equal(getJob(db, 'J3').auto_queued_at, j3.auto_queued_at, 'queued job is not processed twice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('worker: native video captioned from its own speech and rendered; stuck renders fail', { skip: !hasFfmpeg && 'ffmpeg missing' }, async () => {
  const { dir, cfg, db } = setup();
  try {
    // A 6-second vertical "generated video": speech-like tones with a pause.
    const master = dir + '/source.mp4';
    const gate = "volume='if(between(t,0.4,2.2)+between(t,2.8,4.6),1,0)':eval=frame";
    assert.equal(spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=6:r=24', '-f', 'lavfi', '-i', 'sine=f=200:d=6', '-af', gate, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', master]).status, 0);
    put(db, 'jobs', { id: 'OLD', status: 'completed', finish_status: 'rendering', finish_started_at: '2026-01-01T00:00:00+00:00' });
    put(db, 'jobs', { id: 'N1', voice: 'native', auto_build: true, request_id: 'r-n1', status: 'in_progress', format: 'square', duration: 6, price: null,
      script: 'Explore this 2013 Subaru XV Crosstrek. Book your test drive today.', vehicle: '2013 SUBARU XV CROSSTREK' });
    const downloads = [];
    const opts = {
      autoBuildOpts: { hfStatus: async () => ({ status: 'completed', video: { url: 'https://cdn.example/n1.mp4' } }), poll: async () => null },
      download: async (url, path) => { downloads.push(url); copyFileSync(master, path); },
    };
    const log = await captionWorkerRun(db, cfg, opts);
    assert.deepEqual(log, ['checked seedance N1: completed', 'queued final render N1', 'Caption render completed']);
    assert.deepEqual(downloads, ['https://cdn.example/n1.mp4']);
    assert.ok(getJob(db, 'OLD').finish_status === 'failed' && /stopped before completing/.test(getJob(db, 'OLD').finish_error), 'stuck render marked failed');
    const n1 = getJob(db, 'N1');
    assert.ok(n1.finish_status === 'completed' && /^https:\/\/example\.com:4343\/assets\/[a-f0-9]{40}\.mp4$/.test(n1.captioned_url));
    assert.ok(n1.captions_srt.includes('Call For Price'), 'no price: Call For Price shown after the speech');
    const out = cfg.asset_dir + '/' + n1.captioned_url.split('/').pop();
    const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', out]).stdout.toString());
    assert.deepEqual(probe.streams.map((s) => s.codec_type === 'video' ? [s.width, s.height] : s.codec_type), [[1080, 1080], 'audio'], 'square render with sound');
    assert.deepEqual(readdirSync(cfg.data_dir), [], 'work folder removed');
    assert.deepEqual(await captionWorkerRun(db, cfg, opts), [], 'nothing queued: nothing to do');

    // A failed download is saved on the job; no partial file is left.
    put(db, 'jobs', { id: 'N2', voice: 'native', status: 'completed', finish_status: 'queued', video_url: 'https://cdn.example/gone.mp4', captions_srt: '', captions_from_audio: true, duration: 6, script: 'Hi.' });
    const failed = await captionWorkerRun(db, cfg, { ...opts, download: async () => { throw new Error('Video download failed (HTTP 403). Refresh the generation result if its link expired.'); } });
    assert.deepEqual(failed, ['Caption render failed; details saved to job']);
    assert.match(getJob(db, 'N2').finish_error, /HTTP 403/);
    assert.deepEqual(readdirSync(cfg.data_dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render arguments match the PHP worker', () => {
  const cfg = { ffmpeg_path: '/usr/bin/ffmpeg' };
  const a = renderArgs(cfg, { format: 'facebook_feed', voice: 'native' }, null, '/x/out.mp4');
  assert.equal(a.join(' '), "/usr/bin/ffmpeg -nostdin -n -hide_banner -loglevel error -i master.mp4 -vf scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1,subtitles=captions.srt:force_style='FontName=DejaVu Sans,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=1,Outline=0,Shadow=1.5,Alignment=2,MarginV=28' -c:v libx264 -preset veryfast -crf 20 -threads 1 -pix_fmt yuv420p -c:a aac -movflags +faststart /x/out.mp4");
  const f = renderArgs(cfg, { format: 'square', voice: 'elevenlabs', provider: 'footage', duration: 27 }, '/n/v.mp3', 'o.mp4');
  assert.deepEqual(f.slice(8, 20), ['-i', '/n/v.mp3', '-filter_complex', '[1:a]adelay=500:all=1,apad[a]', '-map', '0:v', '-map', '[a]', '-shortest', '-t', '27', '-vf']);
  assert.ok(renderArgs(cfg, { format: 'instagram_reels' }, null, 'o').join(' ').includes('FontSize=10') && renderArgs(cfg, { format: 'x' }, null, 'o').join(' ').includes('1080:1920'));
});

test('downloads only from public https hosts', async () => {
  await assert.rejects(downloadMaster('http://cdn.example.com/a.mp4', '/dev/null'), /Invalid generated-video URL/);
  await assert.rejects(downloadMaster('https://u:p@cdn.example.com/a.mp4', '/dev/null'), /Invalid generated-video URL/);
  await assert.rejects(downloadMaster('https://cdn.example.com:8443/a.mp4', '/dev/null'), /Invalid generated-video URL/);
  await assert.rejects(downloadMaster('https://localhost/a.mp4', '/dev/null'), /public IPv4/);
  assert.deepEqual(await heardWords({}, '/x.wav', '/tmp'), [], 'no speech recognition configured');
  assert.deepEqual(await heardWords({ whisper_cli: '/missing', whisper_model: '/missing.bin' }, '/x.wav', '/tmp'), []);
});

test('Review captions and Finish actions', async () => {
  const db = openMemoryDb(); narrationTables(db);
  const cfg = { render_backend: 'linux' };
  put(db, 'jobs', { id: 'J', status: 'completed', video_url: 'https://v/x.mp4', script: 'Explore this car. Just $14,688.', duration: 15, vehicle: '' });
  put(db, 'jobs', { id: 'P', status: 'in_progress' });
  put(db, 'jobs', { id: 'F', status: 'completed', video_url: 'https://v/y.mp4', provider: 'fal_lipsync' });
  const call = (a, body) => finishingRoutes[a]({ cfg, db, body });
  await assert.rejects(call('caption_draft', { id: 'nope' }), /Job not found/);
  await assert.rejects(call('caption_draft', { id: 'P' }), /Wait for the video generation/);
  await assert.rejects(call('finish', { id: 'F', reviewed: true }), /Open Review captions first/);
  const draft = await call('caption_draft', { id: 'J' });
  assert.ok(draft.srt.includes('-->') && /Draft timing/.test(draft.note));
  await assert.rejects(call('finish', { id: 'J', srt: draft.srt }), /Review caption wording/);
  assert.match((await call('finish', { id: 'J', srt: draft.srt, reviewed: true })).message, /Caption render queued/);
  const j = getJob(db, 'J');
  assert.deepEqual([j.finish_status, j.render_backend, j.captioned_url], ['queued', 'linux', null]);
  await assert.rejects(call('finish', { id: 'J', srt: draft.srt, reviewed: true }), /already queued/);
});
