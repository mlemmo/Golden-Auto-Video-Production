// Saved spokesperson library: images live in the assets folder, metadata in state row "spokespersons".
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { state, save } from './db.js';
import { trim, str, gmdateC, U_SPACE } from './text.js';
import { probeImage } from './images.js';
import { SPOKESPERSON_DEFAULT_DESCRIPTION } from './prompts.js';

const SPACES = new RegExp(U_SPACE + '+', 'gu');
export const spokespersonDir = (cfg) => String(cfg.asset_dir ?? '');

export function spokespersonLibrary(db, cfg, random = randomBytes) {
  let lib = state(db, 'spokespersons');
  if (lib === null) {
    // First run: register the original single spokesperson image so nothing is lost.
    lib = { items: [], default: null };
    for (const legacy of ['spokesperson.png', 'spokesperson.jpg', 'spokesperson.jpeg', 'spokesperson.webp']) if (existsSync(spokespersonDir(cfg) + '/' + legacy)) {
      const id = random(8).toString('hex');
      lib.items.push({ id, name: 'Original spokesperson', description: SPOKESPERSON_DEFAULT_DESCRIPTION, file: legacy, created_at: gmdateC() });
      lib.default = id; break;
    }
    save(db, 'spokespersons', lib);
  }
  if (!Array.isArray(lib.items)) lib.items = [];
  return lib;
}
export const spokespersonPublic = (item, cfg) => ({ ...item, url: item.url ?? str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/' + item.file });
export function spokespersonFind(db, cfg, id) {
  for (const item of spokespersonLibrary(db, cfg).items) if (item.id === id) return spokespersonPublic(item, cfg);
  throw new Error('Choose a spokesperson. Upload one under Spokespersons if the list is empty.');
}
export function spokespersonClean(s, max, field) {
  s = trim(s.replace(SPACES, ' '));
  if (s === '') throw new Error('Enter the spokesperson ' + field + '.');
  if ([...s].length > max) throw new Error('Spokesperson ' + field + ' must be at most ' + max + ' characters.');
  if (s.includes('"')) throw new Error('Do not use double quotes in the spokesperson ' + field + '.');
  return s;
}

/** files.image: { tmp_name, size, error } from the multipart upload (src/lib/multipart.js), (error 0 = OK). */
export function spokespersonApi(action, inp, cfg, db, files = {}, random = randomBytes) {
  const lib = spokespersonLibrary(db, cfg, random);
  if (action === 'spokesperson_list') { /* list only */ }
  else if (action === 'spokesperson_upload') {
    const name = spokespersonClean(str(inp.name ?? ''), 60, 'name'), description = spokespersonClean(str(inp.description ?? ''), 300, 'description');
    const file = files.image ?? null;
    if (!file || file.error !== 0 || !existsSync(file.tmp_name)) throw new Error('Image upload failed. The file may be too large or the upload was interrupted.');
    if (file.size > 20000000) throw new Error('Spokesperson image must be 20 MB or smaller.');
    const size = probeImage(readFileSync(file.tmp_name));
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[size?.type] ?? null;
    if (!size || !ext) throw new Error('Upload a JPG, PNG or WebP image.');
    if (size.width * size.height > 16000000) throw new Error('Spokesperson image is too large to decode; keep it under 16 megapixels.');
    if (size.width < 300 || size.height < 300) throw new Error('Spokesperson image must be at least 300×300 pixels.');
    const dir = spokespersonDir(cfg);
    try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { throw new Error('Cannot create assets folder.'); }
    const id = random(8).toString('hex'), stored = 'spokesperson-' + id + '.' + ext;
    try { copyFileSync(file.tmp_name, dir + '/' + stored); unlinkSync(file.tmp_name); } catch { throw new Error('Could not save the spokesperson image.'); }
    chmodSync(dir + '/' + stored, 0o644);
    lib.items.push({ id, name, description, file: stored, created_at: gmdateC() });
    lib.default ??= id; save(db, 'spokespersons', lib);
  } else if (action === 'spokesperson_default') {
    const id = str(inp.id ?? ''); spokespersonFind(db, cfg, id); lib.default = id; save(db, 'spokespersons', lib);
  } else if (action === 'spokesperson_delete') {
    const id = str(inp.id ?? ''); const item = spokespersonFind(db, cfg, id);
    lib.items = lib.items.filter((i) => i.id !== id);
    if (lib.default === id) lib.default = lib.items[0]?.id ?? null;
    save(db, 'spokespersons', lib);
    // Only uploaded files are removed; the original spokesperson.* stays on disk.
    const path = spokespersonDir(cfg) + '/' + item.file;
    if (item.file.startsWith('spokesperson-') && existsSync(path)) unlinkSync(path);
  } else throw new Error('Unknown action.');
  return { items: lib.items.map((i) => spokespersonPublic(i, cfg)), default: lib.default };
}

// ---- Spokespersons made with AI: Claude writes the description, Nano Banana Pro (fal) draws the picture ----
// The admin types an idea; Claude turns it into structured blocks (person, hair, outfit, manner) and the description
// used in video prompts; each picture is one paid fal request that needs its own approval tick (about $0.15). Pictures
// are drafts (state "spokesperson_drafts", files assets/spokesperson-draft-*.jpg) until saved to the library; drafts
// are removed after two days. The same description is not drawn twice unless "make another take" is ticked.
export const PICTURE_MODEL = 'fal-ai/nano-banana-pro';
export const SPOKESPERSON_BLOCKS = [
  ['person', 'Person', 'Apparent age, gender and build', 'a friendly adult woman in her early thirties, slim build'],
  ['hair', 'Hair', 'Hair style and colour', 'shoulder-length straight brown hair'],
  ['outfit', 'Outfit', 'Clothes and shoes, head to toe', 'fitted navy blazer over a white blouse, dark slim trousers, white leather sneakers'],
  ['manner', 'Manner', 'How they come across', 'warm, trustworthy and confident'],
];
export const spokespersonDescription = (b) => `${b.person} with ${b.hair}, wearing ${b.outfit}, ${b.manner}`.replace(/\s+/g, ' ');

/** The picture prompt: a full-length, front-facing studio photo of a made-up person in the described look. */
export function picturePrompt(description) {
  return 'Full-length photorealistic photograph of a car dealership spokesperson: ' + description + '. Standing upright and facing the camera with a relaxed, natural smile, arms relaxed at the sides. The entire body is visible from the top of the head to the shoes, centered, with a little space above the head and below the feet. Plain seamless light grey studio backdrop, soft even studio lighting, sharp focus, natural skin texture, true-to-life colors, photographed at eye level with a 50mm lens on a full-frame camera. An entirely fictional person who does not resemble any real or famous person. No text, no logos, no props.';
}

const DESCRIBE_SYSTEM = `You design the on-camera spokesperson for a car dealership's video ads. From the user's plain-English idea, return a short name for the spokesperson (a first name plus a two- or three-word look, e.g. "Maya - navy blazer") and these blocks, each a short lowercase phrase of 3 to 20 words with no ending period:
- person: apparent age range, gender and build, as an adult (for example "a friendly adult man in his mid forties, average build").
- hair: hair style and colour.
- outfit: clothes and shoes from head to toe, suitable for a car dealership ad.
- manner: how they come across, in two to four adjectives.

The person is entirely fictional: never name or describe a real or famous person, never describe ethnicity unless the idea asks for it, never include brand names, logos or text on clothes, and never use double quotes, commas inside the name, or semicolons.`;
const DESCRIBE_SCHEMA = { type: 'object', properties: { name: { type: 'string' }, ...Object.fromEntries(SPOKESPERSON_BLOCKS.map(([k]) => [k, { type: 'string' }])) },
  required: ['name', ...SPOKESPERSON_BLOCKS.map(([k]) => k)], additionalProperties: false };

/** Claude turns an idea into the spokesperson's blocks and description, for the admin to review. */
export async function spokespersonDescribe(cfg, idea, ask = null) {
  idea = trim(str(idea).replace(SPACES, ' '));
  if ([...idea].length < 3 || [...idea].length > 200) throw new Error('Describe your idea for the spokesperson in a few words (up to 200 characters).');
  if (!ask && !trim(str(cfg.anthropic_key ?? ''))) throw new Error('Writing the description needs anthropic_key in private/config.json.');
  const run = ask ?? (async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { INTRO_MODEL } = await import('./intros.js');
    const ws = trim(str(cfg.anthropic_workspace_id ?? ''));
    const client = new Anthropic({ apiKey: str(cfg.anthropic_key), timeout: 60000, maxRetries: 1, defaultHeaders: ws ? { 'anthropic-workspace-id': ws } : undefined });
    const r = await client.beta.messages.create({
      model: str(cfg.intro_model ?? INTRO_MODEL), max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: DESCRIBE_SCHEMA } },
      system: DESCRIBE_SYSTEM,
      messages: [{ role: 'user', content: 'IDEA: ' + idea }],
    });
    if (r.stop_reason === 'refusal') throw new Error('Claude declined this idea. Try describing the spokesperson differently.');
    return JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  });
  const x = (await run(idea)) ?? {};
  const blocks = {};
  for (const [k, label] of SPOKESPERSON_BLOCKS) {
    const v = trim(str(x[k] ?? '').replace(SPACES, ' ')).replace(/[.;]+$/, '');
    if ([...v].length < 3 || [...v].length > 160 || v.includes('"')) throw new Error('Claude returned an unusable ' + label.toLowerCase() + ' line. Try again or fill it in yourself.');
    blocks[k] = v;
  }
  return { name: spokespersonClean(str(x.name ?? ''), 60, 'name'), blocks, description: spokespersonClean(spokespersonDescription(blocks), 300, 'description') };
}

/** One Nano Banana Pro picture on fal; returns the image bytes (replaceable in tests). */
export async function falPicture(cfg, prompt) {
  const key = trim(str(cfg.fal_key ?? ''));
  if (!key) throw new Error('Making pictures needs fal_key in private/config.json.');
  const r = await fetch('https://fal.run/' + PICTURE_MODEL, { method: 'POST', headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, aspect_ratio: '9:16', resolution: '1K', num_images: 1, output_format: 'jpeg' }), signal: AbortSignal.timeout(170000) });
  if (!r.ok) { const e = new Error('The picture service refused the request (HTTP ' + r.status + '). Nothing was saved.'); e.rejected = r.status < 500; throw e; }
  const url = str((await r.json())?.images?.[0]?.url ?? '');
  let host = ''; try { host = new URL(url).hostname; } catch { /* checked below */ }
  if (!url.startsWith('https://') || !(host === 'fal.media' || host.endsWith('.fal.media'))) throw new Error('The picture service returned no usable picture.');
  const img = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  const bytes = Buffer.from(await img.arrayBuffer());
  if (!img.ok || bytes.length > 20000000) throw new Error('The picture could not be downloaded.');
  return bytes;
}

const DRAFT_DAYS = 2;
function drafts(db, cfg) {
  const d = state(db, 'spokesperson_drafts') ?? { items: [] };
  const keep = [], cutoff = Date.now() - DRAFT_DAYS * 86400000;
  for (const x of d.items ?? []) {
    if (Date.parse(x.created_at) >= cutoff || x.status === 'drawing') keep.push(x);
    else if (x.file) { try { unlinkSync(spokespersonDir(cfg) + '/' + x.file); } catch { /* already gone */ } }
  }
  d.items = keep;
  return d;
}
const draftPublic = (x, cfg) => ({ id: x.id, description: x.description, status: x.status, url: x.file ? str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/' + x.file : null, created_at: x.created_at });

/**
 * A paid picture of the described spokesperson (admin). inp: { description, approve_spend, new_take, approved_by }.
 * The request is recorded before it is sent; a refused request releases it, an unclear outcome keeps it.
 */
export async function spokespersonPicture(db, cfg, inp, { draw = falPicture, random = randomBytes } = {}) {
  if (inp.approve_spend !== true && inp.approve_spend !== 'true' && inp.approve_spend !== '1') throw new Error('Tick the box to approve one paid picture first.');
  const description = spokespersonClean(str(inp.description ?? ''), 300, 'description');
  const fingerprint = createHash('sha256').update(PICTURE_MODEL + '\n' + description).digest('hex');
  const d = drafts(db, cfg);
  const same = d.items.find((x) => x.fingerprint === fingerprint && x.status !== 'failed');
  if (same?.status === 'drawing') throw new Error('This picture is still being made. Wait a moment, then reload.');
  if (same && !inp.new_take) throw new Error('A picture of exactly this description was already made. Tick “make another take” to draw a new one.');
  const draft = { id: random(8).toString('hex'), description, fingerprint, status: 'drawing', created_at: gmdateC(), approved_by: str(inp.approved_by ?? '') };
  if (same) same.fingerprint = null;
  d.items.push(draft); save(db, 'spokesperson_drafts', d);
  const finish = (fields) => { const cur = state(db, 'spokesperson_drafts') ?? { items: [] }; const x = cur.items.find((i) => i.id === draft.id); if (x) Object.assign(x, fields); save(db, 'spokesperson_drafts', cur); };
  let bytes;
  try { bytes = await draw(cfg, picturePrompt(description)); }
  catch (e) { finish(e.rejected ? { status: 'failed', fingerprint: null } : { status: 'uncertain' }); throw new Error(e.rejected ? e.message : e.message + ' If the picture service charged for it, it may still appear in your fal history.'); }
  const size = probeImage(bytes);
  if (!size || size.type !== 'jpeg' && size.type !== 'png' && size.type !== 'webp' || size.width < 300 || size.height < 300) { finish({ status: 'failed' }); throw new Error('The picture came back unusable. Try again.'); }
  const ext = size.type === 'jpeg' ? 'jpg' : size.type, file = 'spokesperson-draft-' + draft.id + '.' + ext;
  mkdirSync(spokespersonDir(cfg), { recursive: true, mode: 0o755 });
  writeFileSync(spokespersonDir(cfg) + '/' + file, bytes, { mode: 0o644 });
  finish({ status: 'ready', file });
  return { draft: draftPublic({ ...draft, status: 'ready', file }, cfg) };
}

/** Saves a ready draft picture to the library with its name and description (admin). */
export function spokespersonSaveDraft(db, cfg, inp, random = randomBytes) {
  const d = drafts(db, cfg);
  const x = d.items.find((i) => i.id === str(inp.draft_id ?? '') && i.status === 'ready' && i.file);
  if (!x) throw new Error('That picture is no longer available. Make a new one.');
  const name = spokespersonClean(str(inp.name ?? ''), 60, 'name'), description = spokespersonClean(str(inp.description ?? x.description), 300, 'description');
  const lib = spokespersonLibrary(db, cfg, random);
  const id = random(8).toString('hex'), stored = 'spokesperson-' + id + '.' + x.file.split('.').pop();
  const dir = spokespersonDir(cfg);
  try { copyFileSync(dir + '/' + x.file, dir + '/' + stored); unlinkSync(dir + '/' + x.file); } catch { throw new Error('Could not save the spokesperson picture.'); }
  chmodSync(dir + '/' + stored, 0o644);
  lib.items.push({ id, name, description, file: stored, created_at: gmdateC(), made_with: PICTURE_MODEL });
  lib.default ??= id; save(db, 'spokespersons', lib);
  d.items = d.items.filter((i) => i.id !== x.id); save(db, 'spokesperson_drafts', d);
  return { items: lib.items.map((i) => spokespersonPublic(i, cfg)), default: lib.default, saved: id };
}
