// Opening lines for 30-second scripts, fitted to the vehicle: Claude writes a short hook and one highlight sentence
// from the car's listing facts (config anthropic_key); without a key, or if the answer fails the checks, the
// free rule-based lines below are used. One request per car and listing (cached in state "intro:<client>:<stock>";
// a changed listing writes a new one). Claude only sees the listing facts and must not add equipment, condition,
// history, warranty or financing; no numbers (price and miles are said elsewhere in the script).
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { state, save } from './db.js';
import { str, trim, gmdateC } from './text.js';

const PROMPT_VERSION = 2;
export const INTRO_MODEL = 'claude-opus-5-5';

const SYSTEM = `You write the first two lines of a 30-second spoken video ad for one used vehicle at a car dealership.
The spokesperson says them out loud, so write plain, warm, natural American English for listening.

The script has a strict spoken-word budget: WORD_BUDGET is the most words your two lines may use together.

Write:
- hook: the opening line, 4 to 12 words. A question or short statement that speaks to the kind of buyer this specific vehicle is for. It must fit the vehicle: a luxury flagship, a sports or performance car, an electric car, an off-roader, a work truck, a family vehicle and an economical commuter each call for a different tone. Never a generic line like "Looking for a dependable vehicle?" for an upscale or performance car.
- highlight: one sentence, 5 to 14 words, about what owning or driving this kind of vehicle is like. If WORD_BUDGET is under 12, leave highlight as an empty string and spend the budget on the hook.

Rules:
- Use only the facts given. You may describe the type of vehicle and the experience in general terms, but never name equipment, options, engine, features, condition, accident history, ownership, warranty, financing or discounts unless they appear in the facts.
- No numbers or digits of any kind: no price, mileage, model year, horsepower or speeds (the rest of the script says the year, price and miles).
- Do not repeat the year, make or model name; the next sentence names the vehicle.
- No exclamation marks, no quotation marks, no emojis, no hype words like insane, unbelievable or steal.
- End each line with a period or a question mark.`;

const SCHEMA = {
  type: 'object',
  properties: { hook: { type: 'string' }, highlight: { type: 'string' } },
  required: ['hook', 'highlight'],
  additionalProperties: false,
};

/** The listing facts Claude sees (no cost or valuation fields; the description is trimmed). */
export function introFacts(v) {
  const f = { year: v.Year ?? null, make: str(v.Make ?? ''), model: str(v.Model ?? ''), trim: str(v.Trim ?? ''),
    drivetrain: str(v.Drivetrain ?? ''), exterior_color: str(v.ExteriorColor ?? ''), mileage: v.Odometer ?? null, price: v.price ?? null };
  const d = trim(str(v.description ?? '').replace(/\s+/g, ' '));
  if (d) f.description = d.slice(0, 1500);
  return f;
}

const words = (s) => s.split(/\s+/).filter(Boolean).length;
/** The checks every Claude answer must pass; the reason it fails, or null. */
export function introProblem(x, budget = 26) {
  if (!x || typeof x.hook !== 'string' || typeof x.highlight !== 'string') return 'missing lines';
  if (words(x.hook) + words(x.highlight) > budget) return 'over the word budget';
  for (const [k, s, lo, hi] of [['hook', x.hook, 3, 12], ['highlight', x.highlight, 5, 16]]) {
    if (k === 'highlight' && trim(s) === '') continue;
    if (words(s) < lo || words(s) > hi) return k + ' length';
    if (/[0-9$!"“”]/.test(s)) return k + ' has numbers or marks';
    if (!/[.?]$/.test(trim(s))) return k + ' ending';
  }
  if (/dependable vehicle/i.test(x.hook)) return 'generic hook';
  return null;
}

// ---- Free fallback: lines by vehicle type (no API key, or an answer that failed the checks) ----
export function vehicleClass(v) {
  const mk = str(v.Make ?? '').toLowerCase(), md = str(v.Model ?? '').toLowerCase(), tr = str(v.Trim ?? '').toLowerCase();
  const all = `${mk} ${md} ${tr}`, price = Number(v.price ?? 0);
  if (/\b(taycan|e-tron|model [3sxy]|r1[ts]|ioniq|mach-e|bolt|leaf|lyriq)\b/.test(all) || ['tesla', 'rivian', 'polestar', 'lucid'].includes(mk))
    return /performance|turbo|quad|\bgt\b|plaid/.test(all) || price >= 55000 ? 'ev_performance' : 'ev';
  if (/\b(g-class|g 550|g 63|range rover|land cruiser|escalade|ls 500|s-class|bentley|rolls)\b/.test(all) || price >= 90000) return 'flagship';
  if (/\b(m[2-8]|rs ?\d|amg|zl1|gt350|gt500|srt|hellcat|type r|sti|wrx|supra|corvette|shelby|gr corolla|z06|trackhawk|911|cayman|boxster)\b/.test(all)
    || (/\b(camaro|challenger|mustang)\b/.test(md))) return 'performance';
  if (/\b(wrangler|bronco|4runner|rubicon|raptor|trailhawk)\b/.test(all)) return 'offroad';
  if (/\b(1500|2500|3500|f-150|f-250|silverado|sierra|tacoma|tundra|ridgeline|frontier|colorado|ranger)\b/.test(all) || mk === 'ram') return 'truck';
  const lux = ['audi', 'bmw', 'mercedes-benz', 'lexus', 'porsche', 'land rover', 'genesis', 'acura', 'infiniti', 'volvo', 'cadillac', 'lincoln', 'jaguar', 'maserati'];
  if (lux.includes(mk)) return /\b(q[3-8]|x[1-7]|rx|nx|gx|gl[a-s]|macan|cayenne|xc\d0|mdx|rdx)\b/.test(md) ? 'luxury_suv' : 'luxury';
  if (/\b(odyssey|sienna|pacifica|carnival|cr-v|rav4|highlander|pilot|explorer|forester|outback|rogue|tucson|santa fe|equinox|cx-5)\b/.test(md)) return 'family';
  if (/\b(civic|corolla|camry|accord|sentra|elantra|mazda3|jetta|impreza|crosstrek|xv)\b/.test(all)) return 'commuter';
  return 'general';
}
const HOOKS = {
  flagship: ['Some vehicles simply set the standard.', 'When only the best will do, this is it.'],
  luxury: ['Ready to upgrade your daily drive?', 'Refined, comfortable, and beautifully finished.'],
  luxury_suv: ['Luxury and room for everything that matters.', 'Ready for a more refined way to get there?'],
  performance: ['Built for drivers who love the drive.', 'Ready to make every drive the best part of your day?'],
  ev_performance: ['Electric power, serious performance.', 'Instant torque, zero gas stops.'],
  ev: ['Ready to skip the gas station?', 'Quiet, smooth, and all electric.'],
  offroad: ['Ready to leave the pavement behind?', 'Built for the trail and ready for adventure.'],
  truck: ['Need a truck that can really work?', 'Serious capability for work and play.'],
  family: ['Room for the whole family and then some.', 'Looking for space, comfort, and peace of mind?'],
  commuter: ['Looking for a smart, efficient daily driver?', 'Reliable, efficient, and easy to own.'],
  general: ['Looking for your next vehicle?', 'Here is one worth a closer look.'],
};
const HIGHLIGHTS = {
  flagship: 'It delivers presence, comfort, and craftsmanship in every detail.',
  luxury: 'It pairs a premium cabin with a smooth, confident ride.',
  luxury_suv: 'It brings premium comfort to every commute and road trip.',
  performance: 'It turns every drive into an event.',
  ev_performance: 'It delivers thrilling acceleration with no fuel stops.',
  ev: 'It makes daily driving quiet, smooth, and efficient.',
  offroad: 'It is ready for the trail on Saturday and the commute on Monday.',
  truck: 'It is ready for work during the week and adventures on the weekend.',
  family: 'It is a great fit for school runs, errands, and weekend road trips.',
  commuter: 'It is a great fit for daily commutes and weekend drives.',
  general: 'It is a great fit for daily commutes and weekend drives.',
};
/** Rule-based lines; the VIN picks one of two hooks so similar cars don't all start the same way. */
export function ruleIntro(v) {
  const cls = vehicleClass(v), pick = [...str(v.Vin ?? v.StockNumber ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;
  return { hook: HOOKS[cls][pick], highlight: HIGHLIGHTS[cls], source: 'rules', class: cls };
}

/** One Claude request for a car's lines (replaceable in tests). */
export async function claudeIntro(cfg, facts, budget = 26) {
  const ws = trim(str(cfg.anthropic_workspace_id ?? ''));
  const client = new Anthropic({ apiKey: str(cfg.anthropic_key), timeout: 60000, maxRetries: 1, defaultHeaders: ws ? { 'anthropic-workspace-id': ws } : undefined });
  const r = await client.beta.messages.create({
    model: str(cfg.intro_model ?? INTRO_MODEL),
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: 'WORD_BUDGET: ' + budget + '\n\nVEHICLE_FACTS:\n' + JSON.stringify(facts, null, 2) }],
  });
  if (r.stop_reason === 'refusal') throw new Error('declined');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ...JSON.parse(text), model: r.model };
}

/**
 * The opening lines for a car: the saved Claude lines for this listing, a new Claude request when the listing is new
 * or changed (and a key is configured), else the rule-based lines. budget: the spoken words the two lines may use
 * so the 30-second script stays in its 55–60 word range (below 4: no opener at all). Never throws.
 */
export async function vehicleIntro(db, cfg, client, v, budget = 26, ask = claudeIntro) {
  if (budget < 4) return { hook: '', highlight: '', source: 'none' };
  const facts = introFacts(v);
  const key = createHash('sha256').update(PROMPT_VERSION + '\n' + budget + '\n' + JSON.stringify(facts)).digest('hex');
  const row = 'intro:' + client + ':' + str(v.StockNumber ?? '');
  const saved = state(db, row);
  if (saved?.key === key && !introProblem(saved, budget)) return { hook: saved.hook, highlight: saved.highlight, source: 'claude' };
  if (!trim(str(cfg.anthropic_key ?? ''))) return ruleIntro(v);
  try {
    const x = await ask(cfg, facts, budget);
    const lines = { hook: trim(str(x.hook)), highlight: trim(str(x.highlight ?? '')) };
    // Over the budget with both lines: the opener alone is kept when it fits.
    if (introProblem(lines, budget) === 'over the word budget' && !introProblem({ hook: lines.hook, highlight: '' }, budget)) lines.highlight = '';
    const problem = introProblem(lines, budget);
    if (problem) throw new Error(problem);
    save(db, row, { key, ...lines, model: str(x.model ?? ''), at: gmdateC() });
    return { ...lines, source: 'claude' };
  } catch (e) {
    console.error('intro for ' + row + ' fell back to rules: ' + (e?.message ?? e));
    return ruleIntro(v);
  }
}
