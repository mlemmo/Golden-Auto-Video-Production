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
| Data layer: shared `agent.sqlite` (`state`, `jobs`), rows written byte-for-byte as PHP's `json_encode` | `private/app.php` (`db`, `state`, `save`) | `src/lib/db.js`, `src/lib/phpjson.js` (built-in `node:sqlite`) | `test/db.test.js` + `test/parity/db.parity.test.js` (Node writes ↔ PHP reads, both ways) |
| Configuration, read once from `private/config.php` via the PHP CLI (never copied) | `private/config.php` | `src/lib/config.js` | `test/config.test.js` |
| Service: `POST /api/node/<action>` with the PHP dashboard's JSON; sign-in, CSRF and selected client checked by PHP (`public/node_auth.php`) until login moves; plain errors shown as messages like PHP | `public/index.php` (API part) | `src/server.js`, `src/lib/auth.js` | `test/server.test.js` |
| Clients: storage, website check and analysis (platform, schema.org dealer data, sitemap, bot blocking), add/re-analyse, dealer details; actions `clients`, `client_add`, `client_analyze`, `client_details`, `inventory` (on the node site the dashboard calls these on Node; `client_select` stays PHP while PHP owns the session) | `private/clients.php`, `public/index.php` | `src/lib/clients.js`, `src/lib/html.js` (PHP's entity table), `src/routes/clients.js` | `test/clients.test.js` (port of tests/clients.php) + PHP parity incl. fake websites and an in-memory database |
| Inventory refresh (`sync`): Golden Auto's website reader (JSONP list) and the Dealer Car Search website import (sitemap → listing pages: tracking object + detail list, PHP-style HTML parsing incl. Latin-1 pages without a charset) | `private/app.php` (`inventory`, `jsonp`), `private/importers.php` (`dcsParseVdp`, `clientImportDcs`), `public/index.php` | `src/lib/website.js`, `src/lib/importers.js`, `src/lib/dom.js` | `test/importers.test.js` + PHP parity on generated messy pages and two-step imports; checked identical on all 25 live eLease pages |
| Images with FFmpeg instead of GD (size check, JPEG re-encode on white, asset sheet), ZIP reading with zlib, photo import (`importMediaZip`), asset sheet | `private/import.php`, `private/app.php` | `src/lib/images.js`, `src/lib/zip.js`, `src/lib/media.js` | `test/media.test.js` (sheet compared with PHP's: size, picks, gallery/content hash) + PHP parity of whole imports on generated ZIPs |
| DealerCenter sync (CLI `node src/cli/dealercenter-sync.js snapshot.json [zip-dir]`) | `private/dealercenter_sync.php` | `src/lib/dealercenter.js` | PHP parity on generated multi-run scenarios (change logs, inventory, sheets, files) |
| Photo worker for website-imported cars (CLI `node src/cli/photo-worker.js`, cron on the node site) | `private/importers.php` (`dcsStorePhotos`, `photoClassify`, `dcsProcessPhotos`), `private/photo_worker.php` | `src/lib/photos.js` (same Python image model) | PHP parity with fake downloads and model labels |
| Narrations, Seedance jobs, My footage, caption worker, ZIP import page action, dashboard pages | `private/*`, `public/*` | next | |

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
