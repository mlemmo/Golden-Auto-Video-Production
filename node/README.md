# Node.js port (branch `nodejs`)

The dashboard is moving from PHP to Node.js on the same Ubuntu server, one area at a time. Until an area is ported,
the PHP version keeps doing that job; Nginx sends only ported routes (`/api/node/…`) to this service. The Python helpers
(`private/finish_video.py`, `private/narration_bridge.py`), FFmpeg, whisper.cpp and the SQLite database stay as they are.
All the rules in the top-level CLAUDE.md still apply (no paid API calls from tests, approvals, price rule, …).

It runs on the test site https://node.mygoldenauto.net:4343 (setup and deploys: docs/NODE_TEST_SITE.md).

## Status

| Area | PHP source | Node | Checked by |
| --- | --- | --- | --- |
| Speech text (prices, years, acronyms, website, respellings) | `private/captions.php`, `private/references.php` | `src/lib/speech.js` | ported tests + PHP parity |
| Caption engine (cues, pause matching, whisper alignment, SRT) | `private/captions.php` | `src/lib/captions.js` | ported tests + PHP parity |
| Price rule, ad price, title | `private/app.php` | `src/lib/price.js` | ported tests + PHP parity |
| 15 s / 30 s scripts | `private/app.php` | `src/lib/scripts.js` | ported tests + PHP parity |
| Service scaffold (health check) | — | `src/server.js` | `test/server.test.js` |
| DealerCenter sync + photos, narrations, Seedance jobs, caption worker, dashboard pages | `private/*`, `public/*` | next | |

## Running

Node 20 or newer, no npm dependencies.

```bash
cd node
npm test          # all tests, including the PHP parity check
npm run parity    # parity only; PARITY_SEEDS=1,2,3 PARITY_COUNT=300 by default
npm start         # http://127.0.0.1:4350/api/node/health (PORT=4351 on the test site)
```

## PHP parity check

`test/parity/` runs every ported helper and its PHP original on the same seeded, generated inputs (vehicles, prices,
scripts with acronyms, odd spacing, non-breaking spaces, accented words, whisper-style heard words, audio spans) and
requires identical results. It needs the `php` CLI and is skipped without it. It calls only pure functions: no network,
database or paid API.

Porting notes that the parity check caught:
- PHP turns on Unicode mode for every `/u` pattern, so `\s`, `\w`, `\d` and `\b` there are Unicode (non-breaking
  spaces split words); plain patterns are ASCII. `src/lib/php.js` has the PCRE2 10.42 sets.
- Caption widths are bytes (`strlen`), not JS string length.
- `strtolower`/`ucfirst` are ASCII-only; `round`/`number_format` round half away from zero.
