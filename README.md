# Golden Auto AI Car Videos

Golden Auto Video Studio: a private dashboard that turns a car dealer's inventory (Golden Auto, San Ramon, CA, and other client dealers) into 9:16 walk-around ads for Instagram and Facebook. A Node service with a React dashboard, a few Python helpers, SQLite, FFmpeg and whisper.cpp.

**Pipeline:** inventory (website refresh, DealerCenter sync or ZIP import; SFTP XML later) → asset sheet of real car photos → approve the script and an ElevenLabs voice preview → Higgsfield Seedance 2.5 renders a spokesperson walkaround (one paid approval) → the caption worker burns in captions timed from the video's own speech (local whisper.cpp + FFmpeg) → Ready.

Runs on Ubuntu behind Nginx (https, port 4343): Node 20+ (from nvm), SQLite (Node's built-in `node:sqlite`), FFmpeg (libx264, libass), Python 3 with Pillow and fonts-dejavu-core, whisper.cpp. See `docs/DEPLOY_UBUNTU.md` and `docs/STAGING.md`.

Staging (`staging` branch) runs this Node + React app. Production (`main`) still runs the old PHP app until the user approves its switch.

## Layout

| Path | Role |
| --- | --- |
| `node/` | Node service (`src/server.js`): sign-in page, sessions, the dashboard page, every action as JSON at `POST /api/node/<action>`, static files. Logic in `src/lib/`, actions in `src/routes/`, workers and tools in `src/cli/`. Tests in `test/`. See `node/README.md` |
| `node/src/cli/caption-worker.js` | Cron, every minute: one-approval auto build (free status checks), then one queued final render with captions |
| `node/src/cli/photo-worker.js` | Cron, every minute: copies and sorts photos of website-imported client cars |
| `node/src/cli/dealercenter-sync.js` | Golden Auto's DealerCenter sync: `node node/src/cli/dealercenter-sync.js snapshot.json [zip-dir]`. The snapshot (active list without costs: stock, VIN, year, make, model, trim, colour, mileage, prices, description, photo_urls) is read from the public website in a browser, since Cloudflare blocks this server; photos are downloaded server-to-server from imagescf.dealercenter.net (fallback: `photo_count` plus ZIPs named `<stock>.zip`). Adds new cars, re-imports photos when the photo set changes, logs price changes, marks missing cars inactive (hidden, paid actions blocked, videos kept). Log in state row `sync_log`, shown in the dashboard |
| `node/src/cli/password-hash.js` | New dashboard password hash: `cd node && npm run password-hash` |
| `web/` | React 18 dashboard (Vite). `npm run build` writes `public/app/` (not committed). Status messages are pop-ups (react-hot-toast); important failures stay until dismissed and are listed under the Notifications button |
| `private/finish_video.py` | Speech timing analysis (speech end + voiced spans) and the intro/closing-card render |
| `private/narration_bridge.py` | ElevenLabs and fal.ai calls for voice previews and lip-sync (no redirects, allowed hosts only, errors stripped of keys) |
| `private/photo_classify.py` | Local CLIP model that sorts website photos (venv `~/golden-auto-ml`, config `photo_python`) |
| `private/reference_http.py` | Higgsfield reference uploads (https only, no redirects) |
| `private/config.json` | Configuration (gitignored, mode 600). Copy `private/config.example.json` |
| `private/data/agent.sqlite` | Data: tables `state`, `jobs`, `narrations`, `narration_lipsync`. Sessions in `node-sessions.sqlite`, worker logs next to them |
| `public/` | `style.css`, the dashboard build (`app/`), photos, sheets, voice previews and videos (`assets/`) |
| `ubuntu/` | `update.sh` (deploy), `staging/` (Node service, Nginx site, one-time setup), `node/` (nvm loader for systemd, cron and deploys) |
| `inventory-ads/` | Separate Python pipeline (HeyGen + Shotstack); disabled, `--dry-run` only |

`private/config.json`, `private/data/` and `public/assets/*` are never committed.

## Running locally

```bash
cp -n private/config.example.json private/config.json && chmod 600 private/config.json   # fill in; data_dir must exist
(cd node && npm run password-hash)         # paste the hash into "password_hash"
(cd node && npm ci && npm test)
(cd web && npm ci && npm run build)        # dashboard → public/app
(cd node && npm start)                     # http://127.0.0.1:4350 (HOST/PORT to change)
```

For dashboard work, run `cd node && npm run dev` (restarts on changes in `src/`) and `cd web && npm run dev`; the Vite dev page forwards `/api`, `/style.css` and `/assets` to the Node service on 127.0.0.1:4350. Sign in on the Node service first, then open the dev page.

Checks before a deploy: `python3 -I -m py_compile private/*.py`, `cd node && npm test`, `cd web && npm run build`.

## Rules the code enforces

- Highest positive advertised price is used; ads say "Just $14,688". No advertised price: scripts and narration never mention a price and captions add "Call For Price" after the speech. Imported vehicles need an explicit "still current" confirmation before paid work.
- Every paid call (Higgsfield, ElevenLabs, fal.ai) needs its own approval checkbox; identical requests are fingerprinted and never silently resubmitted; a submission with an unclear outcome is kept as `submission_uncertain`, never retried automatically.
- Narration must be previewed, listened to and approved; audio longer than the target length cannot be approved.
- Spoken text (`text`) and display captions (`caption_script`) are separate fields so pronunciation respellings never reach the screen.
- Tests never call paid APIs.

## Captions

`captionCues()` (`node/src/lib/captions.js`) turns `caption_script` into readable cues: inventory ALL-CAPS becomes normal case (acronyms like XV, SUV kept), `$14,688.00` shows as `$14,688`, the vehicle name, "Golden Auto", "test drive", price and website stay together, cues never cross a sentence, and each cue is at most two lines of 24 characters. Timing uses the voiced spans measured from the video's speech (`finish_video.py analyze`), matching audio pauses to sentence and comma boundaries. When whisper.cpp is configured (`whisper_cli`, `whisper_model`), the recognized words are aligned to the script and `captionRetime()` snaps each cue's first and last word to the measured speech; captions always show exactly the approved caption text. Without whisper the written script is spread by syllables, which is close but not word-level alignment: always review the draft in the dashboard (Review captions).
