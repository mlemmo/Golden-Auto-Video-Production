// Voice previews and lip-sync. No paid API calls: the Python helper is replaced by a fake that records requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save } from '../src/lib/db.js';
import { jsonEncode } from '../src/lib/storedjson.js';
import { narrationApi, narrationTables, narrationTextDifferences, narrationVoiceSettings, lipsyncSource } from '../src/lib/narrations.js';

function setup() {
  const dir = mkdtempSync(tmpdir() + '/ga-nar-'); mkdirSync(dir + '/assets/narrations', { recursive: true });
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343', elevenlabs_key: 'EL-KEY', fal_key: 'FAL-KEY' };
  const db = openMemoryDb(); narrationTables(db);
  save(db, 'inventory', { vehicles: [{ StockNumber: '870288', Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', price: 14688.25 }] });
  return { dir, cfg, db };
}
const put = (db, table, r) => db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`).run(r.id, null, jsonEncode(r));

test('no paid request without its approval; a repeat is refused, not paid twice', async () => {
  const { dir, cfg, db } = setup();
  const calls = [];
  const bridge = (x) => { calls.push(x); if (x.op === 'probe') return { duration: 24.3 }; return { status: 200, body: Buffer.from('ID3-mp3').toString('base64') }; };
  try {
    const input = { stock: '870288', voice_id: 'v1', text: 'Take a look at this twenty thirteen Subaru.', caption_script: 'Take a look at this 2013 Subaru.', duration: 30 };
    await assert.rejects(narrationApi('narration_preview', input, cfg, db, { bridge }), /Approve one paid/);
    assert.equal(calls.length, 0, 'nothing sent without the approval');
    const r = await narrationApi('narration_preview', { ...input, approve_spend: true }, cfg, db, { bridge });
    assert.match(r.message, /Voice preview saved/);
    const tts = calls.find((c) => c.op === 'http');
    assert.equal(tts.headers['xi-api-key'], 'EL-KEY');
    assert.deepEqual(JSON.parse(Buffer.from(tts.body, 'base64')).voice_settings, { stability: 0.65, similarity_boost: 0.75, speed: 0.9 }, '30 s read slower');
    await assert.rejects(narrationApi('narration_preview', { ...input, approve_spend: true }, cfg, db, { bridge }), /already exists/);
    assert.equal(calls.filter((c) => c.op === 'http').length, 1, 'the identical request was not sent again');
    await narrationApi('narration_preview', { ...input, approve_spend: true, new_take: true }, cfg, db, { bridge });
    assert.equal(calls.filter((c) => c.op === 'http').length, 2, 'a new take is allowed on purpose');
    await assert.rejects(narrationApi('narration_lipsync', { narration_id: 'x', video_id: 'y', approve_spend: false, confirm_current: true }, cfg, db, { bridge }), /approve one paid lip-sync/);
    // A provider rejection releases the reservation; an unclear outcome keeps it (never retried automatically).
    const failing = (status) => (x) => (x.op === 'http' ? { status, body: '' } : { duration: 1 });
    await assert.rejects(narrationApi('narration_preview', { ...input, text: input.text + ' Again.', approve_spend: true }, cfg, db, { bridge: failing(401) }), /HTTP 401/);
    await assert.rejects(narrationApi('narration_preview', { ...input, text: input.text + ' Again.', approve_spend: true }, cfg, db, { bridge: failing(500) }), /HTTP 500/);
    const rows = db.prepare('SELECT fingerprint IS NULL AS free, payload FROM narrations ORDER BY rowid').all().map((x) => [x.free, JSON.parse(x.payload).status]);
    assert.deepEqual(rows.slice(-2), [[1, 'failed'], [0, 'submission_uncertain']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deleting previews and lip-sync jobs', async () => {
  const { dir, cfg, db } = setup();
  const mp3 = (id) => { const f = `${dir}/assets/narrations/${id}.mp3`; writeFileSync(f, 'x'); return f; };
  const api = (a, i) => narrationApi(a, i, cfg, db, { bridge: () => { throw new Error('no helper calls expected'); } });
  try {
    const free = 'a'.repeat(32); put(db, 'narrations', { id: free, status: 'ready', audio_name: free + '.mp3' }); const f1 = mp3(free);
    await api('narration_delete', { id: free });
    assert.ok(!existsSync(f1) && db.prepare('SELECT COUNT(*) AS n FROM narrations').get().n === 0, 'unused preview and its audio deleted');
    const busy = 'b'.repeat(32); put(db, 'narrations', { id: busy, status: 'submitting' });
    await assert.rejects(api('narration_delete', { id: busy }), /still being created/);
    const used = 'c'.repeat(32); put(db, 'narrations', { id: used, status: 'ready', audio_name: used + '.mp3' }); const f2 = mp3(used);
    const wav = 'd'.repeat(32) + '.wav'; writeFileSync(`${dir}/assets/narrations/${wav}`, 'w');
    put(db, 'narration_lipsync', { id: 'L1', narration_id: used, status: 'queued', audio_file: wav });
    await assert.rejects(api('narration_delete', { id: used }), /Delete that lip-sync job first/);
    await assert.rejects(api('narration_lipsync_delete', { id: 'L1' }), /still running/);
    db.prepare('UPDATE narration_lipsync SET payload=? WHERE id=?').run(jsonEncode({ id: 'L1', narration_id: used, status: 'completed', audio_file: wav }), 'L1');
    put(db, 'jobs', { id: 'L1', narration_id: used, status: 'completed', provider: 'fal_lipsync' });
    const r = await api('narration_lipsync_delete', { id: 'L1' });
    assert.ok(r.message.includes('stays in Video jobs') && !existsSync(`${dir}/assets/narrations/${wav}`), 'finished lip-sync job and padded audio deleted');
    await assert.rejects(api('narration_delete', { id: used }), /cannot be deleted/);
    assert.ok(existsSync(f2), 'protected preview audio kept');
    const failed = 'e'.repeat(32); put(db, 'narrations', { id: failed, status: 'ready', audio_name: failed + '.mp3' }); mp3(failed);
    put(db, 'narration_lipsync', { id: 'L2', narration_id: failed, status: 'failed' });
    await api('narration_delete', { id: failed });
    await assert.rejects(api('narration_delete', { id: 'missing' }), /not found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('caption/spoken text differences and voice speed', () => {
  assert.deepEqual(narrationTextDifferences('and just over sixty thousand miles', 'with just over 60,000 miles'), ['"with" (captions) vs "and" (spoken)']);
  assert.deepEqual(narrationTextDifferences('here at Golden Auto in San Ruh-mone.', 'here at Golden Auto in San Ramon.'), []);
  assert.equal(narrationVoiceSettings({}, 30).speed, 0.9);
  assert.equal(narrationVoiceSettings({}, 15).speed, undefined);
  assert.equal(narrationVoiceSettings({ narration_speed: 1.5 }, 30).speed, 1.2);
});

test('lip-sync only offers and accepts silent videos', () => {
  assert.ok(lipsyncSource({ voice: 'narration' }) && lipsyncSource({}), 'silent video (older jobs had no voice field)');
  assert.ok(!lipsyncSource({ voice: 'elevenlabs' }) && !lipsyncSource({ voice: 'native' }), 'Seedance already speaks');
  assert.ok(!lipsyncSource({ voice: null, provider: 'fal_lipsync' }) && !lipsyncSource({ provider: 'footage' }), 'lip-sync results and footage');
});
