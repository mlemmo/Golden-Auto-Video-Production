# Node.js port (branch `nodejs`)

The dashboard is moving from PHP to Node.js on the same Ubuntu server, one area at a time. Until an area is ported,
the PHP version keeps doing that job; Nginx sends only ported routes (`/api/node/…`) to this service. The Python helpers
(`private/finish_video.py`, `private/narration_bridge.py`), FFmpeg, whisper.cpp and the SQLite database stay as they are.
All the rules in the top-level CLAUDE.md still apply (no paid API calls from tests, approvals, price rule, …).

It runs on the test site https://node.mygoldenauto.net:4343 (setup and deploys: docs/NODE_TEST_SITE.md).

## Status

| Area | PHP source | Node | Checked by |
| --- | --- | --- | --- |
| Speech text (prices, years, acronyms, shorthand like 4WD/4dr, websites incl. each client's, respellings) | `private/captions.php`, `private/references.php` | `src/lib/speech.js` | ported tests + PHP parity |
| Caption engine (cues, pause matching, whisper alignment, Call For Price, SRT) | `private/captions.php` | `src/lib/captions.js` | ported tests + PHP parity |
| Price rule, ad price, price match, title | `private/app.php` | `src/lib/price.js` | ported tests + PHP parity |
| 15 s / 30 s scripts (per-client dealer name, city, website) | `private/app.php` | `src/lib/scripts.js` | ported tests + PHP parity |
| Dealer details for scripts and speech | `private/clients.php` (`clientDetails`, `clientWebsiteSpoken`) | `src/lib/clients.js` | ported tests + PHP parity |
| Service scaffold (health check) | — | `src/server.js` | `test/server.test.js` |
| DealerCenter sync + photos, clients (storage, website analysis), Dealer Car Search import + photo worker, narrations, Seedance jobs, My footage, caption worker, dashboard pages | `private/*`, `public/*` | next | |

## Running

Node 20 or newer, no npm dependencies. On the server Node comes from nvm (docs/NODE_TEST_SITE.md).

```bash
cd node
npm test          # all tests, including the PHP parity check
npm run parity    # parity only; PARITY_SEEDS=1,2,3 PARITY_COUNT=300 by default
npm run dev       # same, restarts on every change in src/ (Node's built-in watch; no nodemon needed)
npm start         # http://127.0.0.1:4350/api/node/health (PORT=4351 on the test site)
```

## PHP parity check

`test/parity/` runs every ported helper and its PHP original on the same seeded, generated inputs (vehicles, prices,
scripts with acronyms, odd spacing, non-breaking spaces, accented words, whisper-style heard words, audio spans) and
requires identical results. It needs the `php` CLI and is skipped without it. It calls only pure functions: no network,
database or paid API.

Client websites: PHP keeps the current client's spoken websites in a per-request static (`speechSites`). A Node
server runs many requests at once, so each request wraps its work in `withSpeechSites(sites, fn)`; the parity test
does the same for every case.

Keeping up with staging: merge `origin/staging` into `nodejs`, then `npm test`. A changed PHP helper shows up as
parity mismatches or failing ported tests; port the change and add its new tests.

Porting notes that the parity check caught:
- PHP turns on Unicode mode for every `/u` pattern, so `\s`, `\w`, `\d` and `\b` there are Unicode (non-breaking
  spaces split words); plain patterns are ASCII. `src/lib/php.js` has the PCRE2 10.42 sets.
- Caption widths are bytes (`strlen`), not JS string length.
- `strtolower`/`ucfirst` are ASCII-only; `round`/`number_format` round half away from zero.
