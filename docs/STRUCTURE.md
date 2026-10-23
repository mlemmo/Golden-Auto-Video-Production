# Repository structure and where to change things

A map of the repo and a quick guide to where common edits go. For what the site is for, read
[OVERVIEW.md](OVERVIEW.md); for running and deploying, [README.md](../README.md) and [DEPLOY_UBUNTU.md](DEPLOY_UBUNTU.md).

**Workflow for every change:** edit on branch `staging` → `cd node && npm test` and `cd web && npm run build` →
commit and push → deploy staging (`bash /srv/golden-auto-staging/ubuntu/update.sh`) → the user checks staging →
only then fast-forward `main` and deploy production (`bash /srv/golden-auto/ubuntu/update.sh`).

## Folder map

```
.
├── README.md              Technical overview: layout, running locally, rules, captions
├── CLAUDE.md              Rules and detailed notes for Claude Code sessions (read automatically)
├── docs/
│   ├── OVERVIEW.md        What the site is for, who uses it, how a video is made
│   ├── STRUCTURE.md       This file
│   ├── HANDOFF.md         Current status and open items
│   ├── STAGING.md         Production vs staging, everyday flow
│   ├── DEPLOY_UBUNTU.md   Deploying, cron workers, logs, rollback
│   ├── META_SETUP.md      Connecting a dealer's Facebook Page and Instagram for posting
│   └── ADS_LAUNCH.md      Paid ads: Meta through the Marketing API (ads worker), TikTok by hand
├── node/                  The server (Node.js): sign-in, accounts, every dashboard action, background workers
│   ├── package.json       Server dependencies (bcryptjs) and scripts (npm test, npm start, npm run password-hash)
│   ├── src/server.js      HTTP server: pages, sessions, role checks, action routing, share pages, static files
│   ├── src/routes/        Groups of dashboard actions (clients, jobs, narrations, finishing)
│   ├── src/lib/           All the logic (see the table below)
│   ├── src/cli/           Command-line tools and the cron workers
│   ├── src/templates/     login.html (sign-in page), share.html (public video page)
│   └── test/              Automated tests (node --test); never call paid services
├── web/                   The dashboard (React + Vite); built into public/app/ on deploy
│   ├── index.html         Page shell (loads /style.css and the app)
│   └── src/               Components (see the table below)
├── public/
│   ├── style.css          All styling (colours, layout, pop-ups, charts) for every page
│   ├── app/               Built dashboard (made by `npm run build`; not in git)
│   └── assets/            Photos, asset sheets, voice previews, videos, thumbnails (not in git)
├── private/
│   ├── config.example.json   Example settings; the real private/config.json is never committed
│   ├── finish_video.py    Speech timing analysis and intro/closing-card render
│   ├── narration_bridge.py   ElevenLabs and fal.ai calls (voice previews, lip-sync)
│   ├── photo_classify.py  Local image model that sorts website photos
│   ├── reference_http.py  Higgsfield reference uploads
│   └── data/              agent.sqlite database, sessions, worker logs (not in git)
├── ubuntu/                Server setup and deploy scripts
│   ├── update.sh          Deploy the folder's branch (installs, builds, tests, restarts its Node service)
│   ├── production/        Production's Node service, Nginx site and one-time setup script
│   ├── staging/           Staging's Node service, Nginx site and one-time setup script
│   └── node/              Loads Node from nvm for systemd, cron and deploys
└── inventory-ads/         Separate nightly HeyGen/Shotstack pipeline (disabled; --dry-run only)
```

## The dashboard (web/src)

| File | What it is |
| --- | --- |
| `App.jsx` | Page frame: top bar, staging banner, header, step layout; shared state (client, car, script, choices), client switching, which steps start open |
| `VehicleStep.jsx` | Client panel (menu, Add client, View details / Edit details) and step 1 (car list, thumbnails, Show all, import button) |
| `ScriptStep.jsx` | Step 2: script, video length, spoken word count |
| `VoiceStep.jsx` | Step 3: voice method, voice preview studio, approved preview |
| `LookStep.jsx` | Step 4: video source, spokesperson, style, format, asset sheet photos |
| `GenerateStep.jsx` | Step 5: summary, paid-approval boxes, Generate / Build from footage |
| `Videos.jsx` | Videos list and the caption editor |
| `Library.jsx`, `SocialPost.jsx`, `AdRequest.jsx` | Video library (gallery, player, Download, Share, Post to Facebook & Instagram, Run as ad, Delete) |
| `Tools.jsx` | Tools and Admin dropdowns and their full-page windows (ZIP import, lip-sync builder, spokespersons) |
| `Accounts.jsx` | Account menu, Change password, Manage users |
| `Usage.jsx` | Usage dashboard (tiles, daily chart, tables) |
| `ui.jsx` | Pop-ups, Notifications button, delete confirmation, small helpers |
| `notices.js` | The Notifications list (failures and warnings) |
| `api.js` | How the page calls the server (`/api/node/<action>`) |

## The server (node/src/lib)

| File | What it does |
| --- | --- |
| `scripts.js` | Ad script wording (15, 30 and 60 seconds) and Golden Auto's default dealer details |
| `speech.js` | How text is spoken: numbers, prices, acronyms, shorthand (4WD…), respellings for Seedance |
| `prompts.js` | The Seedance video prompts |
| `captions.js` | Caption engine: splitting, line length, timing, Call For Price |
| `finishing.js`, `worker.js`, `autobuild.js` | Building the final captioned video (caption style, FFmpeg render, auto build) |
| `jobs.js` | Paid generation, status checks, jobs list, My footage, library list |
| `slideshow.js` | Photo slideshow videos: timeline, FFmpeg zoom/cross-fade graph, one job per shape (9:16, 4:5, 16:9, 1:1) |
| `music.js` | Background music library for slideshows (upload, list, delete) and the music-under-voice mix |
| `narrations.js` | Voice previews and lip-sync |
| `ads.js` | Paid ad requests and dealer ad settings (docs/ADS_LAUNCH.md) |
| `meta-ads.js` | Meta ads through the Marketing API: create paused, switch on/pause, end, results (ads worker) |
| `social.js`, `facebook.js` | Posting to Facebook and Instagram (posts, schedule, the social worker's steps); Connect Facebook & Instagram (login, stored tokens) |
| `clients.js` | Clients, website analysis, dealer details |
| `importers.js`, `website.js`, `dealercenter.js`, `photos.js`, `media.js`, `thumbs.js`, `images.js` | Inventory import, photos, asset sheets, thumbnails |
| `users.js` | Accounts and roles |
| `activity.js` | Usage tracking and the Usage dashboard data, cost estimates |
| `pages.js`, `session.js` | Sign-in, dashboard and share pages; sessions |
| `price.js` | Highest advertised price and money formats |
| `config.js`, `db.js`, `storedjson.js`, `text.js`, `html.js`, `dom.js`, `zip.js`, `multipart.js`, `auth.js` | Plumbing |

## Where to change common things

| To change… | Edit |
| --- | --- |
| Button labels, headings, hints, help text in the dashboard | The step's file in `web/src/` (search for the text you see) |
| Pop-up message wording | The file that shows it (`say('…')` calls in `web/src/`); server error messages are in `node/src/lib/` (search for the text) |
| Colours, spacing, fonts, sizes | `public/style.css` (bump `?v=` in `web/index.html` and the templates so browsers reload it) |
| Sign-in page text | `node/src/templates/login.html` |
| Public share page | `node/src/templates/share.html`, `sharePage()` in `node/src/lib/pages.js` |
| Staging banner text | `dashboardPage()` in `node/src/lib/pages.js` |
| Script wording ("Take a look at…", "Book your test drive…") | `node/src/lib/scripts.js` |
| Golden Auto's default name / city / website | `DEALER_DEFAULT` in `node/src/lib/scripts.js` (other clients: Edit details in the dashboard) |
| How a word is pronounced by Seedance | `SEEDANCE_RESPELL` in `node/src/lib/speech.js`, or config `respell` |
| How 4WD, AWD etc. are spoken | `SPEECH_SHORTHAND` in `node/src/lib/speech.js` |
| Video prompt (shots, presenter behaviour) | `node/src/lib/prompts.js` (changes the duplicate-request fingerprint) |
| Caption line length / number of lines | `CAPTION_MAX_LINE`, `CAPTION_MAX_LINES` in `node/src/lib/captions.js` |
| Caption font, size, shadow | `CAPTION_STYLE_NATIVE` in `node/src/lib/worker.js` |
| Spoken word-count targets (55–60 / 38) | `ScriptStep.jsx` |
| Which steps start open | `START_COLLAPSED` in `web/src/App.jsx` |
| Pop-up display times | `useStatus()` in `web/src/ui.jsx` |
| What each role may do | `VIEWER_ACTIONS`, `ADMIN_ACTIONS` in `node/src/server.js` |
| Cost estimates in the Usage dashboard | config `cost_estimates` (defaults: `DEFAULT_COSTS` in `node/src/lib/activity.js`) |
| API keys, password hash, paths, whisper | `private/config.json` on the server (never commit it; example in `private/config.example.json`) |
| Tools / Admin menu items | `TOOLS`, `ADMIN_TOOLS` in `web/src/Tools.jsx` |
| Deploy steps | `ubuntu/update.sh` |

After any change: run the tests (`cd node && npm test`), build the dashboard (`cd web && npm run build`), deploy to
staging and check it there before production.
