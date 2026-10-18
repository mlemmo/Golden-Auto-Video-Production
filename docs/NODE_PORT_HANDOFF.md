# Node.js port — handoff (2026-10-17)

For the Claude Code session on the server that finishes the port. Read CLAUDE.md, node/README.md and
docs/NODE_TEST_SITE.md first; everything in CLAUDE.md still applies.

## Where things stand

- Branch `nodejs` = everything on `staging` (merged in, last at staging `ff91ff4`) + the Node port in `node/`.
  The user's rule: **work on `nodejs` only; do not commit to `staging` or `main`** until the user says to.
- Ported to Node with a PHP parity check (identical output on 100k+ generated inputs) and the PHP tests ported:
  speech text, caption engine, prices, 15/30 s scripts, dealer details (`node/src/lib/*.js`).
- `node/src/server.js`: a dependency-free HTTP service with only `GET /api/node/health`. `npm run dev` restarts on
  change (`node --watch`; nodemon was considered and not needed).
- Test site `node.mygoldenauto.net:4343` (`/srv/golden-auto-node`, branch `nodejs`): Nginx sends `/api/node/` to the
  Node service on 127.0.0.1:4351 and everything else to its own PHP-FPM pool, so the dashboard keeps working while
  areas move over. Node.js comes from **nvm** in /home/mark/.nvm (user's choice; `ubuntu/node/nvm-env.sh` loads it
  for systemd, update.sh and setup). Setup: `ubuntu/node/setup-root.sh` (sudo) then `setup-app.sh` (as mark).
  As of this note the user has cloned the setup scripts; DNS `node` A record and both setup scripts may still be
  pending — check `curl -fsS https://node.mygoldenauto.net:4343/api/node/health` before relying on the site.
- Deploy a change: `git -C /srv/golden-auto-node pull --ff-only origin nodejs && bash /srv/golden-auto-node/ubuntu/update.sh`
  (runs PHP checks, then `npm test` incl. parity, restarts the Node service only if they pass).

## Progress (2026-10-17, later)

Done on `nodejs` (each with ported PHP tests + parity): data layer (`src/lib/db.js`, PHP-identical JSON, shared
agent.sqlite), config, sign-in for Node routes via `public/node_auth.php` (PHP session, CSRF, selected client),
`POST /api/node/<action>` routes for `clients`, `client_add`, `client_analyze`, `client_details`, `inventory`, `sync`
(Golden Auto website reader + Dealer Car Search import, `src/lib/dom.js` HTML parser). On the node site the dashboard
sends those actions to Node (`window.NODE_ACTIONS` in index.php); `client_select` stays PHP while PHP owns the session.
Deploys restart the Node service with `sudo systemctl restart golden-auto-node.service`, which needs a passwordless
sudoers rule for that one command (`/etc/sudoers.d/golden-auto-node-restart`).

Images use FFmpeg (user's choice): `src/lib/images.js` (ffprobe size check, JPEG re-encode on white, asset sheet
with drawtext/overlay, EXIF rotation ignored like GD), `src/lib/zip.js` (zlib). Ported with parity: photo import
(`src/lib/media.js`), asset sheet (same size/picks/hashes as PHP's), DealerCenter sync (`src/lib/dealercenter.js`, CLI
`node src/cli/dealercenter-sync.js snapshot.json [zip-dir]`) and the photo worker (`src/lib/photos.js`, CLI
`node src/cli/photo-worker.js`; the node site's cron runs it instead of private/photo_worker.php). Checked live in a
throw-away database: eLease analysis, import of 25 cars and the Range Rover's photo sort (10 of 69 kept, as PHP).

Narrations (4) done: `src/lib/narrations.js` + `src/routes/narrations.js` (all narration_* actions on Node on the node
site), same Python helper (async), parity on generated action runs with fake ElevenLabs/fal. PHP's narrationBridge
has an optional test hook (`narrationBridgeHook`). Checked on the node site: real helper probe, narration_list, and a
preview request without approval refused before any API call.

Jobs (5) done: `src/lib/prompts.js`, `src/lib/jobs.js`, `src/lib/spokespersons.js`, `src/lib/multipart.js`,
`src/routes/jobs.js` — generate/poll/jobs/job_delete/references/footage_build/detail/sheet/import/speech/sync_log and
spokesperson_* run on Node on the node site (the upload forms use `actionUrl()` in app.js). Same paid-call rules:
approval, fingerprint (PHP's is now `jobFingerprint()` in app.php, compared by parity), reference upload failure
releases it, unclear submissions stay `submission_uncertain`. Higgsfield POST/PUT go through private/reference_http.py
as in PHP; tests use a fake transport. PHP's `enrich()` takes an optional page fetcher for parity. The Node server now
sets the selected client's spoken website per request (PHP's `speechSites`), which narration routes also lacked.

Caption worker (6) done: `src/lib/worker.js` (one run: auto build, stuck-render check, one queued render),
`src/lib/autobuild.js`, `src/lib/finishing.js`, CLI `node src/cli/caption-worker.js` (lock folder
`caption-worker.lock.d`), and the `caption_draft`/`finish` actions on Node. The node site's cron runs the Node caption
worker instead of private/caption_worker.php (ubuntu/node/setup-app.sh installs both Node workers). Same free tools as
PHP (FFmpeg, finish_video.py, whisper.cpp); captions were identical to PHP's on a real finished video with whisper.
PHP's `goldenNativeCaptions` now calls a pure `goldenNativeCues` (compared by parity).

Next: dashboard pages and login (7) — after that every API action of the node site is on Node.

## How to port each area (the method so far)

1. Port the pure logic first, into `node/src/lib/`, keeping PHP's names and behaviour.
2. Add its functions to `node/test/parity/harness.php` (ALLOWED) and generate cases in `cases.js`; port the PHP
   tests for it into `node/test/*.test.js`. `npm test` must pass, including parity.
3. Then the I/O around it (database, files, HTTP, workers) behind a `/api/node/…` route; switch the dashboard's
   calls for that area to the Node route; check on the test site.
4. Keep up with staging: `git merge origin/staging` into `nodejs`, `npm test`; mismatches show what to port.

Porting traps already hit (see node/README.md): PHP `/u` patterns are Unicode (`\s` includes NBSP; use the sets in
`php.js`), plain patterns are ASCII; caption widths are bytes (`strlen`); `strtolower`/`ucfirst` are ASCII-only;
PHP `round`/`number_format` round half away from zero. `speechSites` is a per-request static in PHP — in Node wrap
each request in `withSpeechSites(sites, fn)` (AsyncLocalStorage) so concurrent dealers never share websites.

## Suggested order for the rest

1. **Data layer.** SQLite file `private/data/agent.sqlite`, tables `state(id, payload JSON)` and
   `jobs(id, fingerprint UNIQUE, payload JSON)` (`db/state/save` in private/app.php). Node and PHP share the same
   file during the transition, so keep the schema and JSON shapes identical (note: PHP stores 9000.0 as 9000).
   Options: `better-sqlite3` (npm dependency) or built-in `node:sqlite` (Node 22.13+, still marked experimental).
   Read config from `private/config.php` once (e.g. `php -r 'echo json_encode(require "private/config.php");'` at
   start-up) rather than duplicating secrets; never print or commit it.
2. **Auth for Node routes while PHP still owns login.** Suggestion: Nginx `auth_request` on `/api/node/` to a tiny
   PHP endpoint that returns 204 when the PHP session has `auth`, 401 otherwise; keep CSRF checks. Port login
   (bcrypt `$2y$` hash from `password_hash`) last, with the pages.
3. **Clients + inventory**: clients.php (storage, `clientAnalyze`), app.php website refresh, dealercenter_sync.php,
   importers.php (Dealer Car Search) — tests: clients.php, dealercenter_sync.php, importers.php, run.php.
4. **Narrations** (ElevenLabs previews/approvals via narration_bridge.py, narrations.php) — keep per-call approval and
   fingerprint duplicate protection; never call ElevenLabs from tests.
5. **Jobs**: Seedance/Higgsfield generation, references.php, spokespersons.php, jobs.php, footage.php — same rules.
6. **Workers**: caption_worker.php (+ auto_build.php, finishing.php) and photo_worker.php → Node workers (systemd
   timers or one long-running worker with the same locks); remove the matching cron lines only on the node site.
   finish_video.py, photo_classify.py, FFmpeg and whisper.cpp stay as they are.
7. **Dashboard pages**: public/index.php HTML + login → Node; public/app.js and narration.js already run in the
   browser. Then point all of node.mygoldenauto.net at Node and stop its PHP-FPM pool.
8. **Rollout** (only when the user says so): merge into `staging`, check, then `main` — the same flow as today.
   Retire the parity check once no PHP is left to compare against.

## Rules to keep (from CLAUDE.md)

Never commit/print config.php, keys, private/data, public/assets. No paid API calls (Higgsfield, ElevenLabs, fal,
HeyGen, Shotstack, Anthropic) from tests or while porting; real generations only with the user's approval in the
dashboard. Price rule and "Just $14,688" wording, "Call For Price", spoken vs caption text, shorthand and acronym
speech — all covered by the ported tests; keep them passing.
