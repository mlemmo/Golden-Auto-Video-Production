// Ad scripts built only from inventory facts (15- and 30-second versions).
import { adPrice, title } from './price.js';
import { speechWordCount } from './speech.js';
import { intdiv, lower, numberFormat, str, toFloat, toInt, trim, truthy, upper } from './text.js';

const hasPrice = (v) => v.price !== undefined && v.price !== null;

/** Dealer named in scripts: Golden Auto unless the selected client's details are passed (clientDetails). */
export const DEALER_DEFAULT = Object.freeze({ name: 'Golden Auto', city: 'San Ramon', website: 'mygoldenauto.net' });

/**
 * 15-second script (30 → script30). intro: { hook, highlight } fitted to the vehicle (src/lib/intros.js), used by the
 * 30-second script; the 15-second script has no room for it.
 */
export function script(v, duration = 15, dealer = DEALER_DEFAULT, intro = null) {
  if (duration === 30) return script30(v, dealer, intro);
  const name = title(v);
  const drive = v.Drivetrain ?? '';
  // Keep drive codes uppercase so speech spells them ("A-W-D") and captions keep "AWD".
  const feature = truthy(drive) ? ' with ' + (/^[A-Za-z0-9]{2,4}$/.test(str(drive)) ? upper(str(drive)) : lower(str(drive))) : '';
  return 'Explore this ' + name + feature + ' at ' + str(dealer.name) + '. ' +
    (hasPrice(v) ? 'Just ' + adPrice(toFloat(v.price)) + '. ' : '') +
    'Book your test drive at ' + str(dealer.website) + '.';
}

// Paint names that are plain colours read as "an ice grey metallic exterior"; marketing names such as "Caviar" or
// "Torred" read as "Caviar paint".
const PLAIN_COLOR = /\b(white|black|silver|gr[ae]y|blue|red|green|yellow|orange|brown|beige|gold|tan|purple|bronze|maroon|burgundy|charcoal|pearl|metallic|navy|teal)\b/i;
export function colorPhrase(raw) {
  const c = trim(str(raw));
  if (c === '' || /^(other|unknown|n\/a|none)$/i.test(c)) return '';
  if (PLAIN_COLOR.test(c)) { const l = lower(c); return (/^[aeiou]/.test(l) ? 'an ' : 'a ') + l + ' exterior'; }
  return c + ' paint';
}

const DRIVES = { AWD: 'all-wheel drive', '4WD': 'four-wheel drive', '4X4': 'four-wheel drive', FWD: 'front-wheel drive', RWD: 'rear-wheel drive' };

/**
 * 30-second script. Targets about 55–60 spoken words (roughly 22–25 s of speech), which fits the 27.5 s left after
 * the 2 s intro card; optional sentences are dropped for long vehicle names.
 */
export function script30(v, dealer = DEALER_DEFAULT, intro = null) {
  const trimRaw = trim(str(v.Trim ?? ''));
  const body = /pickup|crew cab|truck/i.test(trimRaw + ' ' + str(v.Model ?? '')) ? 'truck'
    : /sport utility|suv/i.test(trimRaw) ? 'SUV'
      : /sedan/i.test(trimRaw) ? 'sedan'
        : /coupe/i.test(trimRaw) ? 'coupe'
          : /van/i.test(trimRaw) ? 'van' : 'vehicle';
  // Trim name without the body-style suffix, e.g. "Premium Sport Utility 4D" → "Premium".
  const trimName = trim(trimRaw.replace(/\b(sport utility|sedan|coupe|pickup|crew cab|van|wagon|hatchback|convertible)\b.*$/gi, ''));
  // "Base" (or "Base Trim Level") is not worth saying.
  const shownTrim = /^base( trim level)?$/i.test(trimName) ? '' : trimName;
  const name = title(v) + (shownTrim !== '' && !lower(title(v)).includes(lower(shownTrim)) ? ' ' + shownTrim : '');
  const drive = DRIVES[upper(trim(str(v.Drivetrain ?? '')))] ?? '';
  const colorRaw = trim(str(v.ExteriorColor ?? '')), color = lower(colorRaw);
  const miles = v.Odometer !== undefined && v.Odometer !== null ? toInt(v.Odometer) : null;
  const facts = [drive, colorPhrase(colorRaw),
    miles !== null && miles >= 1000 ? 'just over ' + numberFormat(intdiv(miles, 1000) * 1000) + ' miles' : ''].filter(truthy);
  const factLine = facts.length
    ? 'It comes with ' + (facts.length > 2 ? facts.slice(0, -1).join(', ') + ', and ' + facts[facts.length - 1] : facts.join(' and ')) + '.'
    : '';
  const use = body === 'truck' ? 'It is ready for work during the week and adventures on the weekend.'
    : body === 'SUV' ? 'It is a great fit for daily commutes, family errands, and weekend road trips.'
      : 'It is a great fit for daily commutes and weekend drives.';
  const parts = {
    hook: intro ? trim(intro.hook ?? '') : 'Looking for a dependable ' + body + '?',
    name: 'Take a look at this ' + name + ', here at ' + str(dealer.name) + (str(dealer.city ?? '') !== '' ? ' in ' + str(dealer.city) : '') + '.',
    facts: factLine,
    use: intro ? trim(intro.highlight ?? '') : use,
    price: hasPrice(v) ? 'Just ' + adPrice(toFloat(v.price)) + '.' : '',
    cta: 'Book your test drive today at ' + str(dealer.website) + '.',
  };
  const join = (p) => trim(Object.values(p).filter(truthy).join(' ').replace(/[\t\n\v\f\r ]+/g, ' '));
  for (const optional of ['use', 'hook']) if (speechWordCount(join(parts)) > 62) delete parts[optional];
  return join(parts);
}
/** Spoken words left for a fitted opener and highlight in the 30-second script (its budget is 60). */
export function introBudget(v, dealer = DEALER_DEFAULT) {
  return 60 - speechWordCount(script30(v, dealer, { hook: ' ', highlight: ' ' }));
}
