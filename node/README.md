# Node service

The whole dashboard back end: the sign-in page, sessions, the dashboard page (the React build from `../web`), every
action as JSON, static files, and the cron workers. One npm dependency (`bcryptjs`); SQLite through Node's built-in
`node:sqlite`; images with FFmpeg; the Python helpers in `../private/*.py` for speech timing, cards, ElevenLabs/fal
and Higgsfield uploads, and photo sorting. All the rules in the top-level CLAUDE.md apply (no paid API calls from
tests, per-call approvals, fingerprints, price rule, …).

## Structure

| Path | Role |
| --- | --- |
| `src/server.js` | HTTP service (HOST/PORT, default 127.0.0.1:4350). `GET /` = sign-in page (`src/templates/login.html`) or the dashboard (`public/app/index.html` with the session's values filled in); `POST /` signs in (5 tries per 5 minutes, new session id, then a 303 redirect to a plain GET); `POST /api/node/<action>` runs an action (also `POST /?api=<action>`, the older address); `GET /api/node/health`; static `style.css`, `/app/static/*`, `/assets/*`. Actions need a signed-in session and the `X-CSRF-Token` header |
| `src/routes/` | Actions by area: `clients.js` (clients, inventory, refresh), `jobs.js` (vehicle detail, asset sheets, ZIP import, spokespersons, video jobs, My footage), `narrations.js` (`narration_*` voice previews and lip-sync), `finishing.js` (`caption_draft`, `finish`). `client_select` and `logout` are in server.js |
| `src/lib/` | Logic: `speech.js`, `captions.js`, `price.js`, `scripts.js`, `prompts.js` (text); `db.js`, `storedjson.js`, `config.js`, `session.js`, `auth.js`, `pages.js`, `multipart.js` (service); `clients.js`, `website.js`, `importers.js`, `dom.js`, `html.js`, `dealercenter.js` (inventory); `media.js`, `images.js`, `zip.js`, `photos.js` (photos and sheets); `jobs.js`, `spokespersons.js`, `narrations.js` (paid work); `worker.js`, `autobuild.js`, `finishing.js` (caption worker); `text.js` (string/number helpers, below) |
| `src/cli/` | `caption-worker.js`, `photo-worker.js` (cron, every minute, one run at a time via a lock folder in `data_dir`), `dealercenter-sync.js snapshot.json [zip-dir]`, `password-hash.js` |
| `test/` | `node --test` suites per area, with fixtures; fake Higgsfield/ElevenLabs/fal transports, no network |

Config is read once from `../private/config.json` (`GOLDEN_ROOT` overrides the checkout root); a value is never
printed. Sessions: cookie `ga_sid` (HttpOnly, SameSite=Strict, Secure behind Nginx's `X-Forwarded-Proto: https`),
data in `data_dir/node-sessions.sqlite`, 24 minutes idle. Without that header only local connections are accepted
(development, tests).

## Conventions worth knowing

- **Widths are UTF-8 bytes.** Caption line widths (24 per line) and similar limits use `strlen()` from `text.js`
  (`Buffer.byteLength`), not JS string length, so accented words count as more than one.
- **Whitespace and case are mostly ASCII.** Most patterns match ASCII whitespace only (`[\t\n\v\f\r ]`), so a
  non-breaking space is not a word break there. Patterns that do need Unicode use the sets in `text.js` (`U_SPACE`,
  `U_WORD_CHARS`, `U_BOUNDARY`). `lower`/`upper`/`ucfirst` change ASCII letters only.
- **Rounding** (`round`, `numberFormat`) is half away from zero, unlike `Math.round`.
- **Stored JSON** (`storedjson.js`, used for every row in `state`, `jobs`, `narrations`, `narration_lipsync`) escapes
  `/` as `\/`, writes non-ASCII as `\uXXXX`, writes whole floats without `.0` (9000.0 → 9000: compare prices by
  value) and an empty object as `[]`, so existing data and the hashes made from it (fingerprints, gallery hashes) stay
  the same. Ported code treats an
  empty array like an empty object.
- **Fingerprints** of paid requests include the exact prompt text, so changing `prompts.js` wording changes them.
- **Per-request dealer website**: each action runs inside `withSpeechSites(sites, fn)` (AsyncLocalStorage in
  `speech.js`), so concurrent requests for different clients never share spoken websites.
- **HTML parsing** (`dom.js`, `html.js`) follows libxml2: a page without a UTF-8 charset is read as ISO-8859-1, and
  only HTML 4.01 named entities are decoded.
- Python helpers get secrets on stdin only and run without blocking the service.

## Gotchas

- mygoldenauto.net blocks the server via Cloudflare (403), so the dashboard has no refresh button for Golden Auto (the
  `sync` action still exists and would report that error). Use the manual
  DealerCenter sync (`node src/cli/dealercenter-sync.js snapshot.json [zip-dir]`) instead.
- Photo URLs in a copied database point at the site they were copied from; staging's were rewritten to
  staging.mygoldenauto.net (backup `private/data/agent.sqlite.bak-before-photo-urls`), or asset sheets fail.
- On the server Node comes from nvm in `/home/mark/.nvm` (alias `default`). systemd, cron and `update.sh` load it
  with `ubuntu/node/nvm-env.sh`; the service starts through `ubuntu/node/run-node.sh`.

## Running and testing

Node 20 or newer.

```bash
npm ci
npm test               # all suites; no network, no paid API
npm start              # http://127.0.0.1:4350 (needs ../private/config.json and the dashboard build in ../public/app)
npm run dev            # same, restarts on changes in src/
npm run password-hash  # bcrypt hash for "password_hash"
```

For dashboard work run `npm run dev` here and `npm run dev` in `../web` (Vite forwards `/api`, `/style.css` and
`/assets` to this service on 4350).
