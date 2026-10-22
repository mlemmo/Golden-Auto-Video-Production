// Speech check: what Seedance actually said in a finished video, compared with the approved script. Seedance's own
// voice treats the approved recording as a guide and sometimes drops a phrase, repeats one or garbles a word (2015 Ram,
// 2026-10-21: "a green exterior, and just over" left out, the price said twice with "San Ramalers" between). The
// caption worker already runs local whisper for caption timing; this lines its words up with the script (numbers,
// prices and the website compared as spoken words) and lists each difference with its time, so a bad take is noticed
// before it is posted. Free; nothing is sent anywhere.
import { narrationWords } from './narrations.js';
import { captionWordsMatch } from './captions.js';
import { gmdateC } from './text.js';

// A lone short word that whisper missed or added is usually recognition noise, not a mistake in the video.
const FILLER = new Set(['a', 'an', 'the', 'and', 'at', 'in', 'on', 'of', 'to', 'with', 'it', 'its', 'this', 'is', 'for', 'your', 'you', 'uh', 'um', 'oh']);

/**
 * heard: [[text, start, end], ...] from whisper. Returns { ok, issues: [{ kind, at, said, expected, message }], checked_at }
 * or null when there is nothing to compare. kind: missing (left out), extra (added words), repeat (words of the script
 * said again), changed (said differently).
 */
export function speechCheck(script, heard, now = gmdateC) {
  const want = narrationWords(String(script ?? ''));
  const got = [];
  heard.forEach(([text, start, end], i) => {
    for (const w of narrationWords(String(text ?? ''))) {
      // Whisper writes "$15,688 dollars": the spelled-out price already ends in "dollars".
      if (/^dollars?$/.test(w) && got.at(-1)?.w === w && got.at(-1).i !== i) continue;
      got.push({ w, start, end, i });
    }
  });
  if (!want.length || !got.length) return null;
  const n = want.length, m = got.length;
  // Edit-distance alignment: matching words cost nothing, every left-out or added word costs one.
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, captionWordsMatch(want[i - 1], got[j - 1].w) ? dp[i - 1][j - 1] : Infinity);
  }
  const ops = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && captionWordsMatch(want[i - 1], got[j - 1].w) && dp[i][j] === dp[i - 1][j - 1]) { ops.push({ t: 'm', i: i - 1, j: j - 1 }); i--; j--; }
    else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) { ops.push({ t: 'x', j: j - 1 }); j--; }
    else { ops.push({ t: 'o', i: i - 1 }); i--; }
  }
  ops.reverse();
  // Runs of differences between matched words. Differences fewer than three matching words apart are one run: a
  // number whisper wrote as "$15,688" becomes several words, and a repeated price must not split into two reports.
  const runs = [];
  let run = null, lastTime = 0, between = [];
  for (const op of ops) {
    if (op.t === 'm') {
      if (run) between.push(got[op.j]);
      if (run && between.length >= 3) { run.next = between[0].start; runs.push(run); run = null; between = []; }
      lastTime = got[op.j].end; continue;
    }
    if (run && between.length) { run.heard.push(...between); between = []; }
    run ??= { missing: [], extra: [], heard: [], after: lastTime, next: null };
    if (op.t === 'o') run.missing.push(want[op.i]); else { run.extra.push(got[op.j]); run.heard.push(got[op.j]); }
  }
  if (run) { run.next = between[0]?.start ?? null; runs.push(run); }
  const script1 = ' ' + want.join(' ') + ' ';
  const issues = [];
  for (const r of runs) {
    const missing = r.missing.join(' '), words = r.extra.map((x) => x.w);
    if (r.extra.length + r.missing.length === 1 && FILLER.has(words[0] ?? r.missing[0])) continue;
    // What she said, as whisper wrote it (each recognized word once).
    const said = [...new Set(r.heard.map((x) => x.i))].sort((a, b) => a - b).map((i) => String(heard[i][0]).trim()).join(' ');
    const at = Math.round((r.extra.length ? r.extra[0].start : r.next ?? r.after) * 10) / 10;
    // Three or more added words that also appear in the script, in order: a line said again.
    let repeat = false;
    for (let k = 0; k + 3 <= words.length && !repeat; k++) repeat = script1.includes(' ' + words.slice(k, k + 3).join(' ') + ' ');
    let kind, message;
    if (repeat) { kind = 'repeat'; message = `Said again: “${said}”`; }
    else if (r.extra.length && r.missing.length) { kind = 'changed'; message = `Said “${said}” instead of “${missing}”`; }
    else if (r.missing.length) { kind = 'missing'; message = `Left out “${missing}”`; }
    else { kind = 'extra'; message = `Added words: “${said}”`; }
    issues.push({ kind, at, said, expected: missing, message: message + ' at ' + at.toFixed(1) + ' s' });
  }
  return { ok: issues.length === 0, issues, checked_at: now() };
}
