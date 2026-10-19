// Background settings for AI videos: where the car is parked while the spokesperson walks around it. A library in
// state row "scenes" ({ items: [{ id, name, blocks?, description, builtin? }], default }), seeded with ready-made
// settings; admins add, edit, delete and pick the default; step 4 chooses one per video. Settings are Seedance's
// structured blocks (location, ground, background, lighting, atmosphere) plus fixed rules, written into the video prompt
// as one "Setting: …" block. The modern showroom is the original free-text setting, word for word, so videos made with
// it are prompted exactly as before. scene_suggest asks Claude (config anthropic_key) to turn a plain-English idea into
// the blocks; the admin reviews and edits them before saving.
import { randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { state, save } from './db.js';
import { str, trim, U_SPACE } from './text.js';
import { INTRO_MODEL } from './intros.js';

import { SHOWROOM_SETTING } from './prompts.js';
export { SHOWROOM_SETTING };

/**
 * Seedance's structured setting blocks. A setting is written into the prompt as one labelled block:
 * "Setting: location: …; ground: …; background: …; lighting: …; atmosphere: …; open space all around the car, no other
 * vehicles or people, no readable text or logos anywhere in the scene." The rules after the blocks are always added.
 */
export const SCENE_BLOCKS = [
  ['location', 'Location', 'Where the car is parked', 'a wide scenic overlook above the Pacific coast'],
  ['ground', 'Ground', 'What the car stands on', 'level, clean paved asphalt'],
  ['background', 'Background', 'What is behind the car, softly out of focus', 'ocean and cliffs'],
  ['lighting', 'Lighting', 'Time of day and light; keep the car and spokesperson clearly lit', 'warm low golden-hour sunlight'],
  ['atmosphere', 'Atmosphere', 'Mood and feel', 'calm, premium, cinematic'],
];
const SCENE_RULES = 'open space all around the car, no other vehicles or people, no readable text or logos anywhere in the scene';
export function sceneDescription(blocks) {
  return SCENE_BLOCKS.map(([k]) => k + ': ' + blocks[k]).join('; ') + '; ' + SCENE_RULES;
}
const preset = (id, name, location, ground, background, lighting, atmosphere) => {
  const blocks = { location, ground, background, lighting, atmosphere };
  return { id, name, blocks, description: sceneDescription(blocks), builtin: true };
};
export const SCENE_PRESETS = [
  { id: 'showroom', name: 'Modern showroom', description: SHOWROOM_SETTING, builtin: true },
  preset('coastal-overlook', 'Coastal overlook at golden hour', 'a wide scenic overlook above the Pacific coast', 'level, clean paved asphalt', 'ocean and rugged cliffs, softly out of focus', 'warm low golden-hour sunlight', 'calm, premium, cinematic'),
  preset('city-rooftop-dusk', 'City rooftop at dusk', 'an open rooftop parking deck high above a city', 'clean level concrete', 'a softly lit city skyline at dusk', 'warm deck lights and the last blue light of dusk, the car and spokesperson clearly lit', 'urban, sleek, upscale'),
  preset('white-studio', 'White photo studio', 'a seamless bright white photo studio with a curved infinity backdrop', 'a glossy white floor with a subtle reflection', 'plain white infinity cove', 'soft, even professional studio lighting', 'clean, minimal, high-end'),
  preset('wine-country', 'Wine country afternoon', 'a wide courtyard beside a California vineyard', 'level, fine light-colored gravel', 'rolling vineyard hills and oak trees', 'soft natural afternoon sunlight', 'relaxed, sunny, refined'),
  preset('mountain-pass', 'Mountain pass morning', 'a wide pull-out on a mountain road', 'level paved asphalt', 'pine forest and snow-dusted peaks', 'crisp clear morning light', 'fresh, adventurous, open'),
  preset('desert-sunset', 'Desert highway at sunset', 'a wide flat pull-out beside an empty two-lane desert highway', 'level packed sand and gravel', 'red rock formations in the distance', 'warm golden sunset light on the car', 'rugged, free, cinematic'),
  preset('estate-driveway', 'Luxury estate driveway', 'the wide circular driveway of an elegant modern estate, not a real or identifiable property', 'smooth level stone pavers', 'manicured hedges and modern architecture', 'soft architectural lighting at dusk, the car and spokesperson evenly lit', 'exclusive, elegant, quiet'),
  preset('neon-night', 'City lights at night', 'a quiet open city plaza at night', 'level pavement, wet with soft reflections', 'colorful city lights, softly out of focus, with no readable signs', 'bright enough that the car and spokesperson are clearly lit', 'cinematic, energetic, modern'),
  preset('industrial-loft', 'Industrial loft', 'a spacious industrial warehouse', 'a polished concrete floor', 'exposed brick, steel beams and tall factory windows', 'soft daylight through the windows', 'raw, stylish, bold'),
];

const SPACES = new RegExp(U_SPACE + '+', 'gu');
export function sceneClean(s, max, field, min = 1) {
  s = trim(str(s).replace(SPACES, ' '));
  if ([...s].length < min) throw new Error(field === 'name' ? 'Enter a name for the setting.' : field === 'idea' ? 'Describe your idea in a few words.' : 'Describe the setting in a sentence or two (at least ' + min + ' characters).');
  if ([...s].length > max) throw new Error('The setting ' + field + ' must be at most ' + max + ' characters.');
  if (s.includes('"')) throw new Error('Do not use double quotes in the setting ' + field + '.');
  return s;
}
/** Blocks (preferred) or one free-text description; returns { blocks, description } as written into the prompt. */
export function sceneBody(inp) {
  if (inp.blocks && typeof inp.blocks === 'object') {
    const blocks = {};
    for (const [k, label] of SCENE_BLOCKS) blocks[k] = sceneClean(inp.blocks[k], 160, label.toLowerCase(), 3).replace(/[.;]+$/, '');
    return { blocks, description: sceneDescription(blocks) };
  }
  return { blocks: null, description: cleanDescription(inp.description) };
}
const cleanDescription = (s) => sceneClean(s, 400, 'description', 20).replace(/^setting:\s*/i, '').replace(/\.+$/, '');

export function sceneLibrary(db) {
  let lib = state(db, 'scenes');
  if (lib === null) {
    lib = { items: SCENE_PRESETS.map((p) => ({ ...p })), default: 'showroom' };
    save(db, 'scenes', lib);
  }
  if (!Array.isArray(lib.items)) lib.items = [];
  return lib;
}
/** The chosen setting, or the default when none is chosen; an unknown id is an error (never a silent swap). */
export function sceneFind(db, id) {
  const lib = sceneLibrary(db);
  const want = str(id ?? '') || lib.default;
  const item = lib.items.find((x) => x.id === want);
  if (item) return item;
  if (!str(id ?? '') && !lib.items.length) return { id: 'showroom', name: 'Modern showroom', description: SHOWROOM_SETTING };
  throw new Error('Choose a background setting. It may have been deleted; pick another in step 4.');
}

/** Actions scene_list (everyone), scene_save, scene_delete, scene_default (admins). */
export function sceneApi(action, inp, db, random = randomBytes) {
  const lib = sceneLibrary(db);
  if (action === 'scene_list') { /* list only */ }
  else if (action === 'scene_save') {
    const name = sceneClean(inp.name, 60, 'name');
    const { blocks, description } = sceneBody(inp);
    const id = str(inp.id ?? '');
    if (id) {
      const item = lib.items.find((x) => x.id === id);
      if (!item) throw new Error('Setting not found. Reload the list.');
      if (lib.items.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('A setting with this name already exists.');
      item.name = name; item.description = description;
      if (blocks) item.blocks = blocks; else delete item.blocks;
    } else {
      if (lib.items.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error('A setting with this name already exists.');
      if (lib.items.length >= 100) throw new Error('The library holds up to 100 settings. Delete some first.');
      lib.items.push({ id: 'scene-' + random(6).toString('hex'), name, ...(blocks ? { blocks } : {}), description });
    }
    lib.default ??= lib.items[0]?.id ?? null;
    save(db, 'scenes', lib);
  } else if (action === 'scene_default') {
    const id = str(inp.id ?? '');
    if (!lib.items.some((x) => x.id === id)) throw new Error('Setting not found. Reload the list.');
    lib.default = id; save(db, 'scenes', lib);
  } else if (action === 'scene_delete') {
    const id = str(inp.id ?? '');
    if (!lib.items.some((x) => x.id === id)) throw new Error('Setting not found. Reload the list.');
    if (lib.items.length === 1) throw new Error('Keep at least one setting.');
    lib.items = lib.items.filter((x) => x.id !== id);
    if (lib.default === id) lib.default = lib.items[0].id;
    save(db, 'scenes', lib);
  } else throw new Error('Unknown action.');
  return { items: lib.items, default: lib.default };
}

const SUGGEST_SYSTEM = `You turn a plain-English idea into the structured "Setting" blocks of a Seedance 2.5 video prompt for a car dealership ad. In the video a spokesperson walks around one parked car while the camera films four wide shots from the front, side, rear and the other front corner.

Return a short title-case name (2 to 5 words) and these blocks, each a short lowercase phrase of 3 to 20 words with no ending period:
- location: where the car is parked; always a wide, open place with room to walk all around the car.
- ground: what the car stands on; always level and clean.
- background: what is behind the car, kept softly out of focus.
- lighting: time of day and light; the car and the spokesperson must stay clearly lit, even at night.
- atmosphere: the mood in two to four adjectives.

Never describe the car or the spokesperson, never put people, other vehicles, readable text, signs, logos or license plates in the scene, never name a real business or an identifiable private property, and never use double quotes or semicolons.`;

const SUGGEST_SCHEMA = { type: 'object', properties: { name: { type: 'string' }, ...Object.fromEntries(SCENE_BLOCKS.map(([k]) => [k, { type: 'string' }])) },
  required: ['name', ...SCENE_BLOCKS.map(([k]) => k)], additionalProperties: false };

/** Claude turns a short idea into the structured setting blocks, for the admin to review before saving. */
export async function sceneSuggest(cfg, idea, ask = null) {
  idea = sceneClean(idea, 200, 'idea', 3);
  if (!ask && !trim(str(cfg.anthropic_key ?? ''))) throw new Error('Writing settings needs anthropic_key in private/config.json. You can still fill in the blocks yourself.');
  const run = ask ?? (async () => {
    const ws = trim(str(cfg.anthropic_workspace_id ?? ''));
    const client = new Anthropic({ apiKey: str(cfg.anthropic_key), timeout: 60000, maxRetries: 1, defaultHeaders: ws ? { 'anthropic-workspace-id': ws } : undefined });
    const r = await client.beta.messages.create({
      model: str(cfg.intro_model ?? INTRO_MODEL), max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
      system: SUGGEST_SYSTEM,
      messages: [{ role: 'user', content: 'IDEA: ' + idea }],
    });
    if (r.stop_reason === 'refusal') throw new Error('Claude declined this idea. Try describing the place differently.');
    return JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  });
  const x = (await run(idea)) ?? {};
  const { blocks, description } = sceneBody({ blocks: x });
  return { name: sceneClean(x.name, 60, 'name'), blocks, description };
}
