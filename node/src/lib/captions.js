// Caption engine. Port of private/captions.php (captionDisplayText … validateSrt). Output must match PHP exactly:
// widths are counted in bytes (PHP strlen) and whitespace is ASCII-only, as in PHP's PCRE.
import { integerWords, speechScript } from './speech.js';
import { levenshtein, lower, quote, round, rtrim, strlen, trim, ucfirst, U_BOUNDARY, U_DIGIT_CHARS, U_SPACE, U_WORD_CHARS } from './php.js';

// PHP whitespace: ASCII in plain patterns, Unicode in /u patterns (see php.js).
const WS = '[\\t\\n\\v\\f\\r ]';
const US = U_SPACE;

export function srtTime(seconds) {
  const ms = round(Math.max(0, seconds) * 1000);
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.trunc(ms / 3600000), 2)}:${p(Math.trunc((ms % 3600000) / 60000), 2)}:${p(Math.trunc((ms % 60000) / 1000), 2)},${p(ms % 1000, 3)}`;
}

export const CAPTION_MAX_LINE = 24;
export const CAPTION_MAX_CUE = 40;
export const CAPTION_GLUE = ['this', 'the', 'a', 'an', 'your', 'at', 'to', 'in', 'of', 'for', 'on', 'with', 'and', 'or', 'our', 'my', 'from', 'by'];
export const CAPTION_ACRONYMS = ['SUV', 'AWD', 'FWD', 'RWD', '4WD', 'GMC', 'BMW', 'CVT', 'TDI', 'TSI', 'WRX', 'STI', 'SRT', 'AMG', 'XLT', 'LED'];
/** Marks a word she said that is not in the caption text: used for timing only, never shown. */
export const CAPTION_EXTRA = '\x03';

const plainText = (x) => x.replace(/[\x01\x02]/g, ' ');

/** Display text for captions: readable case, whole-dollar prices. */
export function captionDisplayText(script) {
  let s = trim(script.replace(new RegExp(US + '+', 'gu'), ' '));
  s = s.replace(/(\$\d[\d,]*)\.00(?!\d)/g, '$1');
  return s.replace(/(?<![A-Za-z0-9\-])[A-Z]{4,}(?![A-Za-z0-9\-])/g, (m) => (CAPTION_ACRONYMS.includes(m) ? m : ucfirst(lower(m))));
}

export function captionSyllables(text) {
  text = speechScript(text).replace(/\d+/g, (m) => (m.length <= 9 ? integerWords(parseInt(m, 10)) : ''));
  let n = 0;
  for (const w of lower(text).split(/[^A-Za-z]+/)) {
    if (w === '') continue;
    let g = (w.match(/[aeiouy]+/g) || []).length;
    if (g === 0) { n += w.length; continue; }
    if (g > 1 && w.endsWith('e') && !w.endsWith('le')) g--;
    n += Math.max(1, g);
  }
  return Math.max(1, n);
}

/** Break one sentence into short phrase units; names, price and website stay together. */
export function captionUnits(sentence, vehicle = '') {
  let s = sentence;
  const protect = [];
  // The car name plus up to three trim words that follow it ("2013 Subaru XV Crosstrek Premium").
  if (vehicle !== '') protect.push(quote(vehicle) + `(?:${US}+(?!(?:` + CAPTION_GLUE.join('|') + `|here|now|today|today${U_BOUNDARY})${U_BOUNDARY})[A-Z][${U_WORD_CHARS}-]*){0,3}`);
  protect.push('Golden Auto', 'San Ramon', 'test drive', `(?:Just|Priced at)${US}+\\$[${U_DIGIT_CHARS},]+(?:\\.[${U_DIGIT_CHARS}]+)?`);
  for (const re of protect) s = s.replace(new RegExp(re, 'giu'), (m) => m.replace(new RegExp(WS + '+', 'g'), '\x01'));
  const tokens = trim(s).split(new RegExp(US + '+', 'u')).filter((t) => t !== '');
  const units = [];
  let carry = '';
  tokens.forEach((t, i) => {
    const bare = lower(trim(t, '.,!?;:"\''));
    const last = i === tokens.length - 1;
    if (!last && CAPTION_GLUE.includes(bare)) { carry += t + '\x02'; return; }
    units.push(carry + t);
    carry = '';
  });
  if (carry !== '') units.push(rtrim(carry, '\x02'));
  return units.map((u) => { const plain = plainText(u); return { text: u, plain, weight: captionSyllables(plain) }; });
}

/** Wrap one cue to at most two short lines, avoiding breaks inside names and prices. */
export function captionWrap(text) {
  if (strlen(plainText(text)) <= CAPTION_MAX_LINE) return plainText(text);
  let best = null, bestScore = Infinity;
  // Candidate break positions are every space; protected spaces cost extra.
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== ' ' && c !== '\x01' && c !== '\x02') continue;
    const a = trim(plainText(text.slice(0, i))), b = trim(plainText(text.slice(i + 1)));
    if (a === '' || b === '') continue;
    const over = Math.max(0, strlen(a) - CAPTION_MAX_LINE) + Math.max(0, strlen(b) - CAPTION_MAX_LINE);
    const score = over * 1000 + (c === ' ' ? 0 : c === '\x02' ? 40 : 100) + Math.abs(strlen(a) - strlen(b));
    if (score < bestScore) { bestScore = score; best = a + '\n' + b; }
  }
  return best ?? plainText(text);
}

/**
 * Cue list [{text, start, end}] with times relative to the start of the speech audio. The script is split into clauses
 * (sentence ends and commas); real pauses in the audio are matched to clause boundaries (captionAnchors), and words
 * between matched pauses are spread by syllables over the speech in between. Cues never cross a clause.
 */
export function captionCues(script, vehicle, spans, audioEnd) {
  const display = captionDisplayText(script);
  vehicle = vehicle === '' ? '' : captionDisplayText(vehicle);
  const sentences = display.split(new RegExp(`(?<=[.!?])${US}+`, 'u')).filter((x) => x !== '');
  if (!sentences.length) return [];
  spans = spans.filter((sp) => sp[1] - sp[0] >= 0.05);
  if (!spans.length) spans = [[0.2, Math.max(0.5, audioEnd - 0.2)]];
  // Units with their clause boundary strength: 2 = sentence end, 1 = comma/semicolon, 0 = none.
  const units = [];
  for (const sentence of sentences) {
    const us = captionUnits(sentence, vehicle);
    us.forEach((u, k) => {
      u.end = k === us.length - 1 ? 2 : /[,;:]$/.test(rtrim(plainText(u.text))) ? 1 : 0;
      units.push(u);
    });
  }
  const W = units.reduce((t, u) => t + u.weight, 0);
  let V = 0;
  const gaps = [];
  spans.forEach((sp, i) => {
    V += sp[1] - sp[0];
    if (i < spans.length - 1) gaps.push({ v: V, len: spans[i + 1][0] - sp[1] });
  });
  const map = captionAnchors(units, gaps, W, V);
  // Cues: group units inside each clause up to CAPTION_MAX_CUE characters.
  const cues = [];
  let cur = [], len = 0, w0 = 0, w = 0;
  const flush = () => {
    if (!cur.length) return;
    const a = captionVoicedTime(spans, captionMapWeight(map, w0) + 1e-6);
    const b = captionVoicedTime(spans, captionMapWeight(map, w));
    // Words she added (CAPTION_EXTRA) count for timing but are never shown; a cue of only added words is dropped.
    const text = captionStripExtra(cur.map((u) => u.text).join(' '));
    if (trim(text.replace(/[\x01\x02]/g, '')) !== '') cues.push({ text: captionWrap(text), start: a, end: Math.max(b, a + 0.1) });
    cur = []; len = 0; w0 = w;
  };
  for (const u of units) {
    const l = strlen(u.plain) + (cur.length ? 1 : 0);
    if (cur.length && len + l > CAPTION_MAX_CUE) flush();
    cur.push(u);
    len += strlen(u.plain) + (len ? 1 : 0);
    w += u.weight;
    if (u.end > 0) flush();
  }
  flush();
  // Small lead-in, short hold, minimum on-screen time, never overlapping.
  const n = cues.length;
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? cues[i + 1].start : audioEnd + 0.08;
    const start = Math.max(0, cues[i].start - 0.04);
    const end = Math.max(cues[i].end + 0.2, start + 0.8);
    cues[i].start = start;
    cues[i].end = Math.min(end, next - 0.04);
    if (cues[i].end <= cues[i].start + 0.2) cues[i].end = cues[i].start + 0.2;
    if (i + 1 < n) cues[i + 1].start = Math.max(cues[i + 1].start, cues[i].end + 0.04);
  }
  return cues;
}

/** Word key for matching script words to recognized words: "$14,688." → "14688", "All-Wheel" → "allwheel". */
export const captionWordKey = (t) => lower(t).replace(/[^a-z0-9]/g, '');

export function captionWordsMatch(a, b) {
  if (a === '' || b === '') return false;
  if (a === b) return true;
  // Misheard spellings of the same word ("Ramon" ≈ "Ramio"): same first letter, up to 40% of letters changed.
  const l = Math.max(a.length, b.length);
  return l >= 4 && a[0] === b[0] && levenshtein(a, b) <= Math.floor(l * 0.4);
}

/**
 * Recognized words [[text,start,end],...] aligned to the caption text (edit-distance DP). Returns
 * [words, matched script word count, script word count]; words are every caption-text word in order (each with its
 * recognized times, or null when she skipped it) plus the words she added, flagged [text,start,end,true].
 */
export function captionAlignWords(display, heard) {
  const script = trim(display).split(new RegExp(US + '+', 'u')).filter((x) => x !== '');
  const sk = script.map(captionWordKey);
  const hk = heard.map((h) => captionWordKey(String(h[0])));
  const n = script.length, m = heard.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) { dp[i][0] = i; from[i][0] = 1; }
  for (let j = 1; j <= m; j++) { dp[0][j] = j; from[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let best = dp[i - 1][j] + 1, f = 1;                                     // script word not spoken
    if (dp[i][j - 1] + 1 < best) { best = dp[i][j - 1] + 1; f = 2; }        // spoken word not in the script
    if (captionWordsMatch(sk[i - 1], hk[j - 1]) && dp[i - 1][j - 1] <= best) { best = dp[i - 1][j - 1]; f = 3; }
    dp[i][j] = best; from[i][j] = f;
  }
  const out = [];
  let matched = 0, i = n, j = m;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (f === 3) { out.push([script[i - 1], Number(heard[j - 1][1]), Number(heard[j - 1][2]), false]); matched++; i--; j--; }
    else if (f === 2) { const t = trim(String(heard[j - 1][0])); if (hk[j - 1] !== '') out.push([t, Number(heard[j - 1][1]), Number(heard[j - 1][2]), true]); j--; }
    else { out.push([script[i - 1], null, null, false]); i--; }
  }
  return [out.reverse(), matched, n];
}

/**
 * Timing text for captionCues: the approved caption text with the words she added placed where she said them and
 * marked CAPTION_EXTRA. Null when too little of it was recognized; the caller then times the caption text alone.
 */
export function captionSpokenScript(script, heard) {
  const [words, matched, total] = captionAlignWords(captionDisplayText(script), heard);
  if (!words.length || total === 0 || matched < 0.6 * total) return null;
  return words.map((w) => (w[3] ? CAPTION_EXTRA + w[0] : w[0])).join(' ');
}

/** Remove CAPTION_EXTRA words from a cue's unit text (words are separated by spaces or the \x01/\x02 markers). */
export function captionStripExtra(text) {
  if (!text.includes(CAPTION_EXTRA)) return text;
  return trim(text.replace(/\x03[^ \x01\x02]*[ \x01\x02]*/g, ''), ' \x01\x02');
}

/**
 * Re-time cues from the recognized words: each cue runs from its first to its last recognized word, snapped to the
 * measured speech (whisper's own times are loose, often early). A clause boundary she said without a pause no longer
 * shifts the following captions. Cues too short to read (under CAPTION_MIN_READ s) join a neighbour in the same
 * sentence, rewrapped to up to CAPTION_MAX_LINES lines. Cues come back unchanged when too little was recognized or
 * the words cannot be matched to the cues.
 */
export const CAPTION_MIN_READ = 1.0;
export const CAPTION_MAX_LINES = 3;
export function captionRetime(cues, script, heard, spans, audioEnd) {
  const [aligned, matched, total] = captionAlignWords(captionDisplayText(script), heard);
  if (!cues.length || !aligned.length || total === 0 || matched < 0.6 * total) return cues;
  // A repeated word ("miles." said twice): use its earliest saying right after the previous caption word.
  for (let p = 0; p < aligned.length; p++) {
    if (aligned[p][3] || aligned[p][1] === null) continue;
    const key = captionWordKey(aligned[p][0]);
    for (let q = p - 1; q >= 0 && aligned[q][3]; q--) if (captionWordKey(aligned[q][0]) === key) {
      [aligned[q][1], aligned[q][2], aligned[p][1], aligned[p][2]] = [aligned[p][1], aligned[p][2], aligned[q][1], aligned[q][2]];
    }
  }
  const words = aligned.filter((w) => !w[3]);
  spans = spans.filter((s) => s[1] - s[0] >= 0.05);
  let out = [], k = 0;
  for (const c of cues) {
    const n = trim(c.text, ' \t\n\r\0\x0B').split(new RegExp(US + '+', 'u')).filter((x) => x !== '').length;
    const timed = words.slice(k, k + n).filter((w) => w[1] !== null); k += n;
    out.push(timed.length ? { text: c.text, start: captionSnap(spans, Number(timed[0][1]), true), end: captionSnap(spans, Number(timed[timed.length - 1][2]), false) } : c);
  }
  if (k !== words.length) return cues;
  // Same lead-in, hold and minimum time as captionCues.
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? out[i + 1].start : audioEnd + 0.08;
    const start = Math.max(0, out[i].start - 0.04);
    out[i].start = start; out[i].end = Math.min(Math.max(out[i].end + 0.2, start + 0.8), next - 0.04);
    if (out[i].end <= out[i].start + 0.2) out[i].end = out[i].start + 0.2;
    if (i + 1 < n) out[i + 1].start = Math.max(out[i + 1].start, out[i].end + 0.04);
  }
  // Too short to read: join the cue before it in the same sentence, else the next one.
  const flat = (t) => trim(t.replaceAll('\n', ' '), ' \t\n\r\0\x0B');
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length; i++) {
      if (out[i].end - out[i].start >= CAPTION_MIN_READ) continue;
      const j = i > 0 && !/[.!?]$/.test(flat(out[i - 1].text)) ? i - 1 : i + 1 < out.length && !/[.!?]$/.test(flat(out[i].text)) ? i + 1 : -1;
      if (j < 0) continue;
      const [a, b] = j < i ? [out[j], out[i]] : [out[i], out[j]];
      const text = captionWrapLines(flat(a.text) + ' ' + flat(b.text));
      if (text === null) continue;
      out.splice(Math.min(i, j), 2, { text, start: a.start, end: b.end });
      again = true; break;
    }
  }
  return out;
}

/** A time snapped to the measured speech: a start to its stretch's start (or the next one's), an end to its stretch's end. */
export function captionSnap(spans, t, start) {
  const inn = spans.find((s) => t >= s[0] && t <= s[1]) ?? null;
  if (start) {
    if (inn && t - inn[0] <= 0.35) return Number(inn[0]);
    if (inn && inn[1] - t > 0.3) return t;
    for (const s of spans) if (s[0] > t) return s[0] - t <= 0.8 ? Number(s[0]) : t;
    return t;
  }
  if (inn) return inn[1] - t <= 0.8 ? Number(inn[1]) : t;
  for (let i = spans.length - 1; i >= 0; i--) if (spans[i][1] < t) return t - spans[i][1] <= 0.8 ? Number(spans[i][1]) : t;
  return t;
}

/** Text on the fewest lines (up to CAPTION_MAX_LINES of CAPTION_MAX_LINE), balanced, not ending a line on a small word; null if it can't fit. */
export function captionWrapLines(text) {
  const w = text.split(/ +/).filter((x) => x !== '');
  for (let lines = 1; lines <= CAPTION_MAX_LINES; lines++) {
    let best = null, bestScore = Infinity;
    for (const o of captionLineSplits(w, 0, lines)) {
      const len = o.map(strlen);
      let glue = 0;
      for (const l of o.slice(0, -1)) if (CAPTION_GLUE.includes(lower(l.split(' ').pop()))) glue++;
      const score = Math.max(...len) - Math.min(...len) + 12 * glue;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best !== null) return best.join('\n');
  }
  return null;
}
function captionLineSplits(w, from, lines) {
  if (lines === 1) { const l = w.slice(from).join(' '); return from < w.length && strlen(l) <= CAPTION_MAX_LINE ? [[l]] : []; }
  const out = [];
  for (let e = from + 1; e < w.length; e++) {
    const l = w.slice(from, e).join(' '); if (strlen(l) > CAPTION_MAX_LINE) break;
    for (const r of captionLineSplits(w, e, lines - 1)) out.push([l, ...r]);
  }
  return out;
}

/**
 * Match audio pauses to clause boundaries. Returns control points [[weight, voiced seconds], ...] from (0,0) to (W,V).
 * Pauses shorter than 0.15 s are ignored; a long pause left unmatched, or a sentence end with no pause, costs more.
 */
export function captionAnchors(units, gaps, W, V) {
  const cands = [];
  let cw = 0;
  units.forEach((u, k) => {
    cw += u.weight;
    if (u.end > 0 && k < units.length - 1) cands.push({ w: cw, e: (V * cw) / Math.max(1, W), s: u.end });
  });
  gaps = gaps.filter((g) => g.len >= 0.15);
  const n = gaps.length, m = cands.length;
  if (!n || !m || V <= 0) return [[0, 0], [W, V]];
  const skipGap = (g) => 0.03 + 0.12 * Math.min(1.5, g.len);
  const skipCand = (c) => (c.s === 2 ? 0.05 : 0.015);
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dp[0][0] = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const c = dp[i][j];
    if (c === Infinity) continue;
    if (i < n && c + skipGap(gaps[i]) < dp[i + 1][j]) { dp[i + 1][j] = c + skipGap(gaps[i]); from[i + 1][j] = 0; }
    if (j < m && c + skipCand(cands[j]) < dp[i][j + 1]) { dp[i][j + 1] = c + skipCand(cands[j]); from[i][j + 1] = 1; }
    if (i < n && j < m) {
      const cost = c + Math.abs(gaps[i].v - cands[j].e) / V;
      if (cost < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = cost; from[i + 1][j + 1] = 2; }
    }
  }
  const pts = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (f === 2) { pts.push([cands[j - 1].w, gaps[i - 1].v]); i--; j--; }
    else if (f === 0) i--;
    else j--;
  }
  pts.reverse();
  return [[0, 0], ...pts, [W, V]];
}

/** Voiced-seconds position for a cumulative syllable weight, piecewise linear between anchors. */
export function captionMapWeight(pts, w) {
  for (let k = 1; k < pts.length; k++) {
    const [w1, v1] = pts[k - 1], [w2, v2] = pts[k];
    if (w <= w2 + 1e-9) return w2 > w1 ? v1 + ((v2 - v1) * (w - w1)) / (w2 - w1) : v2;
  }
  return pts[pts.length - 1][1];
}

/** Split voiced spans into exactly count sentence segments using pauses; null when pauses don't match. */
export function captionSegments(spans, count) {
  if (count === 1) return [spans];
  for (const gapMin of [0.45, 0.35, 0.28, 0.22, 0.17, 0.12]) {
    const segs = [[]];
    spans.forEach((sp, i) => {
      if (i > 0 && sp[0] - spans[i - 1][1] >= gapMin) segs.push([]);
      segs[segs.length - 1].push(sp);
    });
    if (segs.length === count) return segs;
  }
  return null;
}

/** Position in real time after `voiced` seconds of speech, skipping silence between spans. */
export function captionVoicedTime(spans, voiced) {
  for (const sp of spans) {
    const len = sp[1] - sp[0];
    if (voiced <= len + 1e-9) return sp[0] + Math.max(0, voiced);
    voiced -= len;
  }
  return spans[spans.length - 1][1];
}

/** Adds a "Call For Price" caption after the last spoken caption, until the end of the video (videoEnd, cue time). */
export function captionCallForPrice(cues, videoEnd) {
  cues = cues.map((c) => ({ ...c }));
  const last = cues.length ? Number(cues[cues.length - 1].end) : 0;
  let start = Math.min(last + 0.3, Math.max(last + 0.05, videoEnd - 1.5));
  const end = videoEnd - 0.2;
  if (end - start < 0.8 && cues.length) {
    const i = cues.length - 1;
    cues[i].end = Math.min(cues[i].end, Math.max(cues[i].start + 0.4, videoEnd - 1.4));
    start = cues[i].end + 0.04;
  }
  cues.push({ text: 'Call For Price', start, end: Math.max(start + 0.5, end) });
  return cues;
}

export function captionSrt(cues, offset = 0) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start + offset)} --> ${srtTime(c.end + offset)}\n${c.text}\n\n`).join('');
}

/** Generic draft (no audio analysis): spread phrase cues over the video. */
export function captionDraft(script, duration, vehicle = '') {
  return captionSrt(captionCues(script, vehicle, [[0.2, Math.max(1.0, duration - 0.6)]], duration));
}

export function validateSrt(s, duration) {
  s = trim(s.replace(/\r\n|\r/g, '\n'));
  if (strlen(s) > 12000 || s === '' || s === '0') throw new Error('Captions must be a non-empty SRT under 12 KB.');
  let previous = 0;
  const blocks = s.split(/\n[\t\n\v\f\r ]*\n/);
  if (blocks.length > 150) throw new Error('Too many caption cues.');
  for (const block of blocks) {
    const m = block.match(/^\d+\n(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})\n(.+)$/s);
    if (!m) throw new Error('Invalid SRT cue. Keep the numbered timestamps and text.');
    for (const i of [2, 3, 6, 7]) if (parseInt(m[i], 10) > 59) throw new Error('Invalid caption timestamp.');
    const a = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const b = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    if (a < previous || b <= a || b > duration + 0.5) throw new Error('Caption times overlap or exceed the requested video duration.');
    if (strlen(m[9]) > 500 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(m[9])) throw new Error('Invalid caption text.');
    previous = b;
  }
  return s + '\n';
}
