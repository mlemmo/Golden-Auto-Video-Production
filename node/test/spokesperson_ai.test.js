// Spokespersons made with AI. No paid calls: Claude and the picture service are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, state, save } from '../src/lib/db.js';
import { spokespersonDescribe, spokespersonPicture, spokespersonSaveDraft, picturePrompt, spokespersonApi } from '../src/lib/spokespersons.js';
import { JPEG_1800x900, JPEG_40x30 } from './fixtures/images.js';

const blocks = { person: 'a friendly adult man in his mid forties, average build', hair: 'short salt-and-pepper hair', outfit: 'charcoal suit jacket over a light blue shirt, dark trousers, brown leather shoes', manner: 'calm, trustworthy and confident' };
const setup = () => { const dir = mkdtempSync(tmpdir() + '/ga-spai-'); return { dir, cfg: { asset_dir: dir, public_base_url: 'https://staging.example.com:4343' }, db: openMemoryDb() }; };
const jpeg = Buffer.from(JPEG_1800x900, 'base64');

test('Claude turns an idea into blocks and the prompt description', async () => {
  const r = await spokespersonDescribe({}, 'older salesman in a suit for luxury cars', async () => ({ name: 'David - charcoal suit', ...blocks }));
  assert.equal(r.description, 'a friendly adult man in his mid forties, average build with short salt-and-pepper hair, wearing charcoal suit jacket over a light blue shirt, dark trousers, brown leather shoes, calm, trustworthy and confident');
  assert.deepEqual(r.blocks, blocks);
  await assert.rejects(spokespersonDescribe({}, 'man'), /anthropic_key/);
  await assert.rejects(spokespersonDescribe({}, 'xy', async () => ({})), /few words/);
  await assert.rejects(spokespersonDescribe({}, 'a man', async () => ({ name: 'X', ...blocks, outfit: 'a "logo" shirt' })), /outfit/);
  assert.ok(/full-length/i.test(picturePrompt('x')) && /entirely fictional person/.test(picturePrompt('x')) && /No text, no logos/.test(picturePrompt('x')));
});

test('each picture needs its own approval; the same description is not drawn twice by accident', async () => {
  const { dir, cfg, db } = setup();
  const prompts = [];
  const draw = async (c, p) => { prompts.push(p); return jpeg; };
  try {
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'calm adult man, charcoal suit' }, { draw }), /approve one paid picture/);
    assert.equal(prompts.length, 0);
    const a = await spokespersonPicture(db, cfg, { description: 'calm adult man, charcoal suit', approve_spend: true, approved_by: 'mark@example.com' }, { draw });
    assert.ok(a.draft.url.startsWith('https://staging.example.com:4343/assets/spokesperson-draft-') && existsSync(dir + '/' + a.draft.url.split('/').pop()));
    assert.ok(prompts[0].includes('calm adult man, charcoal suit'));
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'calm adult man, charcoal suit', approve_spend: true }, { draw }), /another take/);
    assert.equal(prompts.length, 1, 'not paid twice');
    const b = await spokespersonPicture(db, cfg, { description: 'calm adult man, charcoal suit', approve_spend: true, new_take: true }, { draw });
    assert.notEqual(a.draft.id, b.draft.id);
    assert.equal(prompts.length, 2, 'a redo on purpose');
    // A refused request releases the description; an unclear one keeps it (never redrawn automatically).
    const refused = async () => { const e = new Error('The picture service refused the request (HTTP 422). Nothing was saved.'); e.rejected = true; throw e; };
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'cheerful adult woman, red blazer', approve_spend: true }, { draw: refused }), /HTTP 422/);
    await spokespersonPicture(db, cfg, { description: 'cheerful adult woman, red blazer', approve_spend: true }, { draw });
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'smiling adult man, polo shirt', approve_spend: true }, { draw: async () => { throw new Error('timeout'); } }), /fal history/);
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'smiling adult man, polo shirt', approve_spend: true }, { draw }), /already made/);
    await assert.rejects(spokespersonPicture(db, cfg, { description: 'tiny picture person', approve_spend: true }, { draw: async () => Buffer.from(JPEG_40x30, 'base64') }), /unusable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a ready picture is saved to the library; old drafts are cleaned up', async () => {
  const { dir, cfg, db } = setup();
  try {
    const { draft } = await spokespersonPicture(db, cfg, { description: 'calm adult man, charcoal suit', approve_spend: true }, { draw: async () => jpeg });
    const lib = spokespersonSaveDraft(db, cfg, { draft_id: draft.id, name: 'David - charcoal suit', description: 'calm adult man, charcoal suit' });
    const saved = lib.items.find((i) => i.id === lib.saved);
    assert.ok(saved.name === 'David - charcoal suit' && /^spokesperson-[a-f0-9]{16}\.jpg$/.test(saved.file) && saved.made_with === 'fal-ai/nano-banana-pro');
    assert.ok(existsSync(dir + '/' + saved.file) && !readdirSync(dir).some((f) => f.includes('draft')), 'draft file moved');
    assert.throws(() => spokespersonSaveDraft(db, cfg, { draft_id: draft.id, name: 'Again' }), /no longer available/);
    assert.equal(spokespersonApi('spokesperson_list', {}, cfg, db).items.length, 1);
    // Drafts older than two days are removed with their files.
    const { draft: old } = await spokespersonPicture(db, cfg, { description: 'old draft person look', approve_spend: true }, { draw: async () => jpeg });
    const d = state(db, 'spokesperson_drafts'); d.items.find((x) => x.id === old.id).created_at = '2020-01-01T00:00:00+00:00'; save(db, 'spokesperson_drafts', d);
    await spokespersonPicture(db, cfg, { description: 'another new look here', approve_spend: true }, { draw: async () => jpeg });
    assert.ok(!existsSync(dir + '/' + old.url.split('/').pop()) && !state(db, 'spokesperson_drafts').items.some((x) => x.id === old.id));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
