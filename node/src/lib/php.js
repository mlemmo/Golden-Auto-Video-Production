// Small helpers that reproduce PHP behaviour the ported code depends on, so Node gives byte-for-byte the same
// captions, speech text and prices as the PHP version.

/** strlen(): length in bytes (UTF-8), not UTF-16 code units. */
export const strlen = (s) => Buffer.byteLength(s, 'utf8');

/** trim() with PHP's default character list, or a custom list of single characters. */
export function trim(s, chars = ' \t\n\r\0\x0B') {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
export function rtrim(s, chars = ' \t\n\r\0\x0B') {
  let b = s.length;
  while (b > 0 && chars.includes(s[b - 1])) b--;
  return s.slice(0, b);
}

/** preg_quote() for building a regular expression from literal text. */
// Dashes are left alone: these patterns use the "u" flag, where "\-" outside a class is a syntax error.
export const quote = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

/** strtolower() / strtoupper(): ASCII only, like PHP 8.2+. */
export const lower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
export const upper = (s) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());

export const ucfirst = (s) => (s === '' ? s : upper(s[0]) + s.slice(1));

/** is_numeric(): numbers and numeric strings (leading/trailing whitespace allowed, as in PHP 8). */
export function isNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  return /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(v);
}

/** round() half away from zero, like PHP (not JS Math.round, which rounds -0.5 up). */
export function round(n, precision = 0) {
  const f = 10 ** precision;
  const x = Math.abs(n) * f;
  // PHP pre-rounds to 15 significant digits so 1.005 * 100 = 100.49999… still rounds to 101.
  const pre = Number(x.toPrecision(15));
  return (Math.sign(n) * Math.round(pre)) / f;
}

/** number_format() with "," thousands and "." decimals. */
export function numberFormat(n, decimals = 0) {
  const r = round(n, decimals);
  const [int, frac] = Math.abs(r).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (r < 0 && Number(r) !== 0 ? '-' : '') + grouped + (decimals > 0 ? '.' + frac : '');
}

/** intdiv() */
export const intdiv = (a, b) => Math.trunc(a / b);

/** levenshtein() on ASCII strings. */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** PHP string conversion for values coming from inventory JSON ("2013", 2013, 2013.0 all become "2013"). */
export function str(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return '1';
  return String(v);
}

/** (int) cast: numbers truncate; numeric strings convert (PHP 8 honours exponents); leading-numeric prefixes count. */
export function toInt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return 0;
  const m = v.match(/^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
  return m ? Math.trunc(Number(m[0])) || 0 : 0;
}

/** (float) cast */
export function toFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return 0;
  const m = v.match(/^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
  return m ? Number(m[0]) : 0;
}

/** PHP truthiness: '', '0', 0, null, false and empty arrays are false. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '' || v === '0') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// PHP adds Unicode mode (PCRE2_UCP) to every /u pattern, which changes \s, \w, \d and \b. These are the PCRE2 10.42
// sets, for porting /u patterns. Patterns without /u use plain ASCII whitespace: '[\t\n\v\f\r ]'.
export const U_SPACE = '[\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
export const U_WORD_CHARS = '\\p{L}\\p{N}_';
export const U_DIGIT_CHARS = '\\p{Nd}';
export const U_BOUNDARY = `(?:(?<=[${U_WORD_CHARS}])(?![${U_WORD_CHARS}])|(?<![${U_WORD_CHARS}])(?=[${U_WORD_CHARS}]))`;

/** gmdate('c'): "2026-10-17T18:01:27+00:00". */
export function gmdateC(d = new Date()) { return d.toISOString().replace(/\.\d{3}Z$/, '+00:00'); }

/**
 * parse_url() for absolute addresses ("scheme://[user[:pass]@]host[:port]/…"): { scheme, user, pass, host, port }
 * with absent parts undefined, following PHP 8: the last "@" ends the user part (its first ":" starts the password),
 * the last ":" before the path starts the port (its leading digits; none → no port), and an empty host, a port
 * without digits or one above 65535 make it fail (false). Addresses without "scheme://" have no host, as in PHP.
 */
export function parseUrl(url) {
  const m = String(url).match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/);
  if (!m) return {};
  const out = { scheme: m[1] };
  let auth = m[2];
  const at = auth.lastIndexOf('@');
  if (at !== -1) {
    const info = auth.slice(0, at), c = info.indexOf(':');
    out.user = c === -1 ? info : info.slice(0, c);
    if (c !== -1) out.pass = info.slice(c + 1);
    auth = auth.slice(at + 1);
  }
  let host = auth, port;
  const close = auth.startsWith('[') ? auth.indexOf(']') : -1;
  const colon = close !== -1 ? (auth[close + 1] === ':' ? close + 1 : -1) : auth.lastIndexOf(':');
  if (colon !== -1) { host = auth.slice(0, colon); port = auth.slice(colon + 1); }
  if (host === '') return false;
  out.host = host;
  if (port !== undefined && port !== '') {
    const d = port.match(/^\d+/);
    if (!d || Number(d[0]) > 65535) return false;
    out.port = Number(d[0]);
  }
  return out;
}

/** filter_var($v, FILTER_VALIDATE_INT): the integer, or false. Strings may have surrounding whitespace and a sign,
 *  but no leading zeros (except "0"), decimals or exponents; floats count only when whole; true is 1. */
export function filterValidateInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && Number.isSafeInteger(v) ? v : false;
  if (v === true) return 1;
  if (typeof v !== 'string') return false;
  const m = v.match(/^[ \t\n\r\v\f]*([+-]?)(0|[1-9][0-9]*)[ \t\n\r\v\f]*$/);
  if (!m) return false;
  const n = Number(m[1] + m[2]);
  return Number.isSafeInteger(n) && Math.abs(n) <= 9223372036854775807 ? (n === 0 ? 0 : n) : false;
}

/** strnatcasecmp(): natural-order, case-insensitive (ASCII) comparison; <0, 0, >0 like PHP 8 (returns -1/0/1). */
export function strnatcasecmp(a, b) {
  a = lower(a); b = lower(b);
  let ai = 0, bi = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isSpace = (c) => c === ' ' || (c >= '\t' && c <= '\r');
  // PHP skips leading whitespace and leading zeros of the whole string first.
  while (isSpace(a[ai] ?? '')) ai++;
  while (isSpace(b[bi] ?? '')) bi++;
  while (a[ai] === '0' && isDigit(a[ai + 1] ?? '')) ai++;
  while (b[bi] === '0' && isDigit(b[bi + 1] ?? '')) bi++;
  for (;;) {
    let ca = a[ai] ?? '', cb = b[bi] ?? '';
    while (isSpace(ca)) ca = a[++ai] ?? '';
    while (isSpace(cb)) cb = b[++bi] ?? '';
    if (isDigit(ca) && isDigit(cb)) {
      const fractional = ca === '0' || cb === '0';
      if (fractional) {
        // compare_left: digits compared one by one, the first difference wins.
        for (;; ai++, bi++) {
          const x = a[ai] ?? '', y = b[bi] ?? '';
          if (!isDigit(x) && !isDigit(y)) break;
          if (!isDigit(x)) return -1;
          if (!isDigit(y)) return 1;
          if (x < y) return -1;
          if (x > y) return 1;
        }
      } else {
        // compare_right: the longer run of digits is bigger; else the first difference.
        let bias = 0;
        for (;; ai++, bi++) {
          const x = a[ai] ?? '', y = b[bi] ?? '';
          if (!isDigit(x) && !isDigit(y)) { if (bias) return bias; break; }
          if (!isDigit(x)) return -1;
          if (!isDigit(y)) return 1;
          if (x < y) { if (!bias) bias = -1; } else if (x > y) { if (!bias) bias = 1; }
        }
      }
      if (ai >= a.length && bi >= b.length) return 0;
      continue;
    }
    if (ca === '' && cb === '') return 0;
    if (ca === '') return -1;
    if (cb === '') return 1;
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    ai++; bi++;
  }
}

/** strip_tags($s) with no allowed tags: PHP's state machine for tags, quotes inside tags, comments and <? ?>.
 *  Checked against PHP on text, tags, comments (also inside an unclosed tag), quotes and stray < >. */
export function stripTags(s) {
  let out = '', state = 0, depth = 0, quote = '', i = 0;
  const n = s.length;
  for (; i < n; i++) {
    const c = s[i];
    if (state === 0) {
      if (c === '<') {
        const next = s[i + 1] ?? '';
        if (/[\t\n\v\f\r ]/.test(next)) { out += c; continue; }
        if (s.startsWith('<!--', i)) { state = 4; i += 3; continue; }
        if (next === '?') { state = 3; i++; continue; }
        if (next === '!') { state = 5; continue; }
        state = 1; depth = 0; continue;
      }
      out += c;
    } else if (state === 1) {
      // PHP: a ">" first closes a nested "<" even inside quotes; quotes only hide the final ">".
      if (c === '>' && depth) { depth--; continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '<' && s.startsWith('<!--', i)) { state = 4; depth = 0; i += 3; continue; }  // its "-->" ends the tag too
      if (c === '<') { depth++; continue; }
      if (c === '>') state = 0;
    } else if (state === 3) {
      if (c === '>' && s[i - 1] === '?') state = 0;
    } else if (state === 4) {
      if (s.startsWith('-->', i)) { state = 0; i += 2; }
    } else if (state === 5) {
      if (c === '>') state = 0;
    }
  }
  return out;
}
