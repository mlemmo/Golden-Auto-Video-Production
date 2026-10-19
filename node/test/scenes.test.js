// Background settings library and how it reaches the video prompt. No paid calls: Claude is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb } from '../src/lib/db.js';
import { sceneApi, sceneFind, sceneSuggest, SCENE_PRESETS, SHOWROOM_SETTING } from '../src/lib/scenes.js';
import { promptNative, prompt } from '../src/lib/prompts.js';

const v = { Year: 2025, Make: 'BMW', Model: 'M4' };

test('ready-made settings, showroom first and default', () => {
  const db = openMemoryDb();
  const lib = sceneApi('scene_list', {}, db);
  assert.equal(lib.items.length, SCENE_PRESETS.length);
  assert.deepEqual([lib.default, lib.items[0].description], ['showroom', SHOWROOM_SETTING]);
  for (const s of lib.items) assert.ok(/open space all around the car/.test(s.description) && !s.description.includes('"'), s.id);
  assert.equal(sceneFind(db, '').id, 'showroom', 'nothing chosen: the default');
  assert.throws(() => sceneFind(db, 'gone'), /Choose a background setting/);
});

test('add, edit, set default, delete', () => {
  const db = openMemoryDb();
  let lib = sceneApi('scene_save', { name: '  Beach   boardwalk ', description: 'Setting: a wide, level boardwalk plaza beside a sunny beach, open space all around the car.' }, db, () => Buffer.from('abcdef'));
  const added = lib.items.at(-1);
  assert.deepEqual([added.id, added.name, added.description], ['scene-616263646566', 'Beach boardwalk', 'a wide, level boardwalk plaza beside a sunny beach, open space all around the car']);
  assert.throws(() => sceneApi('scene_save', { name: 'beach boardwalk', description: 'x'.repeat(30) }, db), /already exists/);
  assert.throws(() => sceneApi('scene_save', { name: 'Short', description: 'too short' }, db), /at least 20/);
  assert.throws(() => sceneApi('scene_save', { name: 'Quote', description: 'a "quoted" place with open space all around' }, db), /double quotes/);
  lib = sceneApi('scene_save', { id: added.id, name: 'Beach at noon', description: 'a wide, level boardwalk plaza at noon, open space all around the car' }, db);
  assert.equal(lib.items.at(-1).name, 'Beach at noon');
  lib = sceneApi('scene_default', { id: added.id }, db);
  assert.equal(sceneFind(db, '').id, added.id);
  lib = sceneApi('scene_delete', { id: added.id }, db);
  assert.equal(lib.default, 'showroom', 'deleting the default falls back to the first setting');
});

test('the chosen setting goes into the prompt; the showroom prompt is unchanged', () => {
  const coastal = SCENE_PRESETS.find((x) => x.id === 'coastal-overlook').description;
  const base = promptNative(v, 'Hi there.', 30, 'adult woman', 'speech', 20);
  assert.equal(promptNative(v, 'Hi there.', 30, 'adult woman', 'speech', 20, {}, SHOWROOM_SETTING), base, 'default setting = the original prompt');
  const p = promptNative(v, 'Hi there.', 30, 'adult woman', 'speech', 20, {}, coastal);
  assert.ok(p.includes('Setting: location: a wide scenic overlook above the Pacific coast; ground: level, clean paved asphalt;') && p.includes('no readable text or logos anywhere in the scene.') && !p.includes('modern showroom'), p);
  assert.ok(prompt(v, 'x', 'showroom', 15, 'adult woman').includes('modern illustrative showroom'));
  assert.ok(prompt(v, 'x', 'showroom', 15, 'adult woman', coastal).includes('Setting: ' + coastal + '.'));
});

test('Claude turns an idea into the structured blocks; the answer is checked before it is offered', async () => {
  const answer = { name: 'Beach Sunset', location: 'a wide beachfront plaza', ground: 'level smooth pavers', background: 'gentle waves and palm trees', lighting: 'warm sunset light, car and spokesperson clearly lit.', atmosphere: 'relaxed, warm, coastal' };
  const ok = await sceneSuggest({}, 'beach at sunset', async () => answer);
  assert.equal(ok.name, 'Beach Sunset');
  assert.equal(ok.blocks.lighting, 'warm sunset light, car and spokesperson clearly lit');
  assert.equal(ok.description, 'location: a wide beachfront plaza; ground: level smooth pavers; background: gentle waves and palm trees; lighting: warm sunset light, car and spokesperson clearly lit; atmosphere: relaxed, warm, coastal; open space all around the car, no other vehicles or people, no readable text or logos anywhere in the scene');
  await assert.rejects(sceneSuggest({}, 'beach'), /anthropic_key/);
  await assert.rejects(sceneSuggest({}, 'x', async () => answer), /idea/);
  await assert.rejects(sceneSuggest({}, 'beach', async () => ({ ...answer, background: 'a "quoted" sign' })), /double quotes/);
  await assert.rejects(sceneSuggest({}, 'beach', async () => ({ name: 'No blocks' })), /setting|at least/i);
});

test('settings saved as blocks or free text', () => {
  const db = openMemoryDb();
  const blocks = { location: 'a quiet harbor pier', ground: 'level wooden planks', background: 'sailboats and calm water', lighting: 'bright overcast daylight', atmosphere: 'calm, nautical, fresh' };
  const lib = sceneApi('scene_save', { name: 'Harbor pier', blocks }, db);
  const item = lib.items.at(-1);
  assert.deepEqual(item.blocks, blocks);
  assert.ok(item.description.startsWith('location: a quiet harbor pier; ground: level wooden planks;'));
  const edited = sceneApi('scene_save', { id: item.id, name: 'Harbor pier', description: 'a quiet harbor pier with open space all around the car' }, db).items.at(-1);
  assert.ok(!('blocks' in edited) && edited.description === 'a quiet harbor pier with open space all around the car', 'free text replaces the blocks');
});
