# Handoff — state on 2026-10-18

Read CLAUDE.md first (rules, flows, tests). This note is the current status and what to do next. Sawyer now directs
the work (Mark started it).

## Where things stand
- **Production and staging both run the Node + React app.** Production: `golden-auto-production-node`
  (127.0.0.1:4353), `/srv/golden-auto`, branch `main`; staging: `golden-auto-staging-node` (127.0.0.1:4352),
  `/srv/golden-auto-staging`, branch `staging`. React dashboard built into `public/app/` on deploy, Node caption and
  photo workers from cron, config in `private/config.json`. Deploy with each folder's `ubuntu/update.sh`; promote by
  fast-forwarding `main` to `staging` (docs/STAGING.md, docs/DEPLOY_UBUNTU.md).
- The Node test site (node.mygoldenauto.net, branch `nodejs`) was retired on 2026-10-18 after merging into staging;
  its data backup is `/home/mark/backups/golden-auto-node-test-site-2026-10-18.tar.gz`.
- **Default flow (voice=elevenlabs):** approve an ElevenLabs preview → one Seedance 2.5 generation (four wide shots,
  spokesperson beside the car, approved MP3 as `audio_urls`) → the caption worker keeps Seedance's own speech (lips
  match it) and burns captions timed from that audio.

## Done on 2026-10-18
- Sign-in redirects after posting (no "resend form" prompt); client switch and add without a page reload.
- Car list re-read every 20 s while photos import; Dealer Car Search import errors name the sitemap car.
- Steady spoken word count while typing.
- Whisper-guided caption timing (`captionRetime`), short cues joined, smaller native caption text (FontSize 11).
- React dashboard (`web/`) replaced the old pages; status messages are pop-ups, important failures stay until
  dismissed and are listed under Notifications.
- Old app code removed; config is `private/config.json` on both sites.
- **Production switched to Node + React** (`sudo bash ubuntu/production/setup-node-root.sh`, Node worker cron lines,
  `main` fast-forwarded to `staging`).
- The paid Subaru video (2013 SUBARU XV CROSSTREK, job `aeff52baf6630e4c0bebda0d`, whisper-guided caption timing)
  copied from the retired Node test site into production; production database backup before that:
  `/srv/golden-auto/private/data/agent.sqlite.bak-before-subaru-import`.
- Pop-up notifications moved to the bottom right (bottom centre on phones), clear of Sign out and Notifications.
- Staging's photo URLs pointed at production (copied data, so asset-sheet rebuilds failed); rewritten to
  staging.mygoldenauto.net in staging's database only (backup `private/data/agent.sqlite.bak-before-photo-urls`).

## Accounts (2026-10-18)
Email sign-in with admin / user / viewer roles and per-client access; no registration page (Admin → Manage users).
Each site has its own accounts: the first sign-in on a site (email + the old shared dashboard password) creates its
first admin. Paid records say who approved them (`approved_by`).

## Open items (next steps)
1. **Golden Auto's website blocks the server** (Cloudflare, HTTP 403), so the dashboard has no "Refresh inventory" button
   for Golden Auto (removed 2026-10-18). Its cars come from the DealerCenter sync:
   read the DealerCenter snapshot from the public website in a browser and run
   `node node/src/cli/dealercenter-sync.js snapshot.json [zip-dir]` (photos download fine from imagescf.dealercenter.net).
2. **DealerCenter SFTP XML import** (needs host/credentials and a sample XML).
3. **Word-level caption alignment** (ElevenLabs `with-timestamps` on new takes would give exact timing).
4. "San Ramon" pronunciation by Seedance: default respelling "San Rah-moan" (config `respell`); next fallback
   "San Ra-MOAN", then drop the city from the spoken line.

## Working on this server with Claude Code
- Work in `~/golden-auto-dev` on `staging`, commit, push, run staging's `update.sh` and check; then fast-forward
  `main` and run production's `update.sh`. Don't edit `/srv/...` folders directly.
- Node comes from nvm in `/home/mark/.nvm` (alias `default`); non-interactive shells (systemd, cron, update.sh) load
  it with `ubuntu/node/nvm-env.sh`.
- Never print or commit `private/config.json` or API keys. Never call Higgsfield/ElevenLabs/fal/HeyGen/Shotstack from
  tests; real generations cost money and need the user's approval in the dashboard.
- Logs: `journalctl -u golden-auto-production-node` / `golden-auto-staging-node`; workers → `private/data/finishing-worker.log`,
  `private/data/photo-worker.log`.
- inventory-ads/ is not used: keep `goldenauto-video.timer` disabled.
