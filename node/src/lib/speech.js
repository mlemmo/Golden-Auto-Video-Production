// Spoken text for the voice models: numbers, prices, years and codes said as words (integerWords…speechWordCount,
// nativeSpeech, seedanceRespell, speechScript, acronymSpeech).
import { AsyncLocalStorage } from 'node:async_hooks';
import { intdiv, lower, quote, ucfirst, U_BOUNDARY, U_SPACE } from './text.js';

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function integerWords(n) {
  if (n < 0 || n > 999999999) throw new Error('Price exceeds supported speech range.');
  if (n < 20) return SMALL[n];
  if (n < 100) return TENS[intdiv(n, 10)] + (n % 10 ? '-' + SMALL[n % 10] : '');
  for (const [unit, label] of [[1000000, 'million'], [1000, 'thousand'], [100, 'hundred']]) {
    if (n >= unit) return integerWords(intdiv(n, unit)) + ' ' + label + (n % unit ? ' ' + integerWords(n % unit) : '');
  }
  return '';
}

export function currencyWords(raw) {
  raw = raw.replace(/[$, ]/g, '');
  const m = raw.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error('Unsupported currency amount in script.');
  const d = parseInt(m[1], 10);
  const c = parseInt((m[2] ?? '').padEnd(2, '0'), 10);
  return integerWords(d) + (d === 1 ? ' dollar' : ' dollars') + (c ? ' and ' + integerWords(c) + (c === 1 ? ' cent' : ' cents') : '');
}

/** Years and comma-grouped numbers as words: "2013" → "twenty thirteen", "60,000" → "sixty thousand". */
export function numberSpeech(s) {
  s = s.replace(/(?<![\d,.$])(19[5-9]\d|20[0-3]\d)(?![\d,])/g, (_, ys) => {
    const y = parseInt(ys, 10);
    if (y >= 2000 && y < 2010) return integerWords(y);
    const hi = intdiv(y, 100), lo = y % 100;
    return integerWords(hi) + ' ' + (lo === 0 ? 'hundred' : lo < 10 ? 'oh ' + integerWords(lo) : integerWords(lo));
  });
  return s.replace(/(?<![\d$.])(\d{1,3}(?:,\d{3})+)(?![\d,]|\.\d)/g, (_, n) => integerWords(parseInt(n.replace(/,/g, ''), 10)));
}

export function priceSpeech(s) {
  // A sentence-ending period after the price ("Just $14,688.") must not block the conversion.
  return s.replace(/\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,]|\.\d)(?:[\t\n\v\f\r ]+dollars\b)?/gi, (_, amount) => currencyWords(amount));
}

/** Spoken words, counting years and comma numbers as written so the tuned 55–60 word budget is unchanged. */
export function speechWordCount(s) {
  return speechScript(s, false).split(new RegExp(`(?:${U_SPACE}|-)+`, 'u')).filter((w) => w !== '').length;
}

const WEBSITE = /(?<![A-Za-z0-9])(?:https?:\/\/)?(?:www\.)?mygoldenauto\.net\/?(?![A-Za-z0-9/])/gi;

/**
 * Spoken form for Seedance native voice: like speechScript, but the website is said "my golden auto dot net"
 * (the spelled "N, E, T" form suits ElevenLabs and sounds wrong from Seedance).
 */
export function nativeSpeech(s) {
  s = s.replace(WEBSITE, 'my golden auto dot net');
  s = shorthandSpeech(speechClientSites(s));
  return acronymSpeech(numberSpeech(priceSpeech(s)));
}

/**
 * Websites of the current client besides mygoldenauto.net, as {display: spoken} ("eleasereturns.com" → "e lease
 * returns dot com"); used by speechScript and nativeSpeech. The server handles many requests at once, so a request should wrap its work in withSpeechSites(sites, fn), which keeps the
 * sites to that request. speechSites(set) outside such a wrapper sets a process-wide default (scripts and tests).
 */
const siteStore = new AsyncLocalStorage();
let defaultSites = {};
export function speechSites(set = null) {
  const store = siteStore.getStore();
  if (set !== null && set !== undefined) {
    if (store) store.sites = set; else defaultSites = set;
  }
  return store ? store.sites : defaultSites;
}
export const withSpeechSites = (sites, fn) => siteStore.run({ sites: sites ?? {} }, fn);

export function speechClientSites(s) {
  for (const [display, spoken] of Object.entries(speechSites())) {
    if (display !== '' && typeof spoken === 'string' && spoken !== '') {
      s = s.replace(new RegExp('(?<![A-Za-z0-9])(?:https?:\\/\\/)?(?:www\\.)?' + quote(display) + '\\/?(?![A-Za-z0-9/])', 'gi'), () => spoken);
    }
  }
  return s;
}

/** Listing shorthand said as words (4WD → "four wheel drive", 4D / 4dr → "four door", ...). Captions keep the shorthand. */
export const SPEECH_SHORTHAND = { '4WD': 'four wheel drive', AWD: 'all wheel drive', FWD: 'front wheel drive', RWD: 'rear wheel drive', '4X4': 'four by four' };
export function shorthandSpeech(s) {
  for (const [code, words] of Object.entries(SPEECH_SHORTHAND)) {
    s = s.replace(new RegExp('(?<![A-Za-z0-9])' + quote(code) + '(?![A-Za-z0-9])', 'gi'), () => words);
  }
  return s.replace(/(?<![A-Za-z0-9])4[ -]?(?:d|dr|door)\.?(?![A-Za-z0-9])/gi, 'four door');
}

/** Respellings written into the line Seedance speaks (it ignored the pronunciation note). Captions keep the real spelling. */
export const SEEDANCE_RESPELL = { 'San Ramon': 'San Rah-moan' };

/** extra: config 'respell' entries (word => how to write it for the voice), added to or overriding the defaults. */
export function seedanceRespell(s, extra = {}) {
  const all = { ...SEEDANCE_RESPELL, ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}) };
  for (const [word, say] of Object.entries(all)) {
    // Only text keys count: numeric-looking keys are skipped.
    if (typeof say === 'string' && word !== '' && !/^(?:0|-?[1-9]\d*)$/.test(word)) {
      s = s.replace(new RegExp(U_BOUNDARY + quote(word) + U_BOUNDARY, 'giu'), () => say);
    }
  }
  return s;
}

/** Pronunciations given to the native-voice model when the word appears in the script. */
export const SPEECH_PRONUNCIATION = {
  'San Ramon': 'san rah-MOAN, written "San Rah-moan" above (stress on MOAN, said like the word "moan")',
  'my golden auto dot net': 'my GOLD-en AW-toh dot net, said as words, never spelled out letter by letter',
  'Golden Auto': 'GOLD-en AW-toh',
};

export function speechScript(s, numbers = true) {
  s = s.replace(WEBSITE, 'my golden auto dot N, E, T');
  s = shorthandSpeech(speechClientSites(s));
  s = priceSpeech(s);
  return acronymSpeech(numbers ? numberSpeech(s) : s);
}

/** Acronyms that contain vowels but are still said letter by letter. */
export const SPEECH_SPELLED = ['SUV', 'HSE', 'AWD', 'FWD', 'RWD', '2WD', '4WD', '4X4', 'EX', 'EXL', 'LX', 'LE', 'SE', 'SEL', 'XLE', 'GT',
  'GTI', 'AMG', 'STI', 'TDI', 'TSI', 'SRT', 'LED', 'USB', 'ABS', 'EV', 'ES', 'RS', 'SS', 'SV', 'SL', 'SR', 'SR5', 'LT', 'LS',
  'LTZ', 'XLT', 'ST'];
/** Between spelled letters. Commas made Bella pause too long; hyphens keep the letters quick. */
export const SPEECH_LETTER_SEPARATOR = '-';

const isDigits = (s) => /^\d+$/.test(s);
const spell = (s) => s.split('').join(SPEECH_LETTER_SEPARATOR);

/**
 * Voice models try to read SUV or XV as words, so spoken text spells them out: "S-U-V", "X-V", "C-R-V".
 * Known acronyms and short letter groups without vowels are spelled; other all-caps inventory words become
 * normal case (SUBARU → Subaru, RAM → Ram) so they are spoken as words.
 */
export function acronymSpeech(s) {
  return s.replace(/(?<![A-Za-z0-9])[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9])/g, (token) => {
    const joined = token.replace(/-/g, '');
    if (isDigits(joined)) return token;
    if (SPEECH_SPELLED.includes(joined)) return spell(joined);
    const parts = [];
    for (const part of token.split('-')) {
      const runs = part.split(/(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])/);
      const out = [];
      let spelledOnly = true;
      for (const run of runs) {
        if (isDigits(run)) { out.push(run); spelledOnly = false; }
        else if (SPEECH_SPELLED.includes(run) || (run.length <= 3 && !/[AEIOU]/.test(run))) out.push(spell(run));
        else if (run.length > 1) { out.push(ucfirst(lower(run))); spelledOnly = false; }
        else { out.push(run); spelledOnly = false; }
      }
      parts.push({ text: out.join(' '), spelled: spelledOnly });
    }
    // CR-V → "C-R-V"; CX-30 → "C-X 30".
    let text = parts[0].text;
    for (let i = 1; i < parts.length; i++) {
      text += (parts[i - 1].spelled && parts[i].spelled ? SPEECH_LETTER_SEPARATOR : ' ') + parts[i].text;
    }
    return text;
  });
}
