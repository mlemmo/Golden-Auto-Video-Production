# Handoff — state on 2026-10-18

Read CLAUDE.md first (rules, flows, tests). This note is the current status and what to do next. Sawyer now directs
the work (Mark started it).

## Where things stand
- **Staging runs on Node + React, no PHP.** Node service `golden-auto-staging-node` (127.0.0.1:4352), React dashboard
  built into `public/app/` on deploy, Node caption and photo workers from cron, config in `private/config.json`.
  Deploy: `bash /srv/golden-auto-staging/ubuntu/update.sh` (docs/DEPLOY_UBUNTU.md).
- **Production (`main`) is still the old PHP app** until the user approves its switch.
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
- PHP removed from `staging`.
- Staging's photo URLs pointed at production (copied data, so asset-sheet rebuilds failed); rewritten to
  staging.mygoldenauto.net in staging's database only (backup `private/data/agent.sqlite.bak-before-photo-urls`).

## Open items (next steps)
1. **Switch production to Node** — next, after Sawyer tests staging and the user approves. Same way as staging: a
   setup script plus one sudo command, `config-from-php.js` once for its config, Node worker cron lines in place of
   the PHP one; then merge `staging` into `main` and remove PHP from `main`.
2. **"Refresh inventory" for Golden Auto returns 403**: mygoldenauto.net blocks the server via Cloudflare. Workaround:
   read the DealerCenter snapshot from the public website in a browser and run
   `node node/src/cli/dealercenter-sync.js snapshot.json [zip-dir]` (photos download fine from imagescf.dealercenter.net).
3. **DealerCenter SFTP XML import** (needs host/credentials and a sample XML).
4. **Word-level caption alignment** (ElevenLabs `with-timestamps` on new takes would give exact timing).
5. "San Ramon" pronunciation by Seedance: default respelling "San Rah-moan" (config `respell`); next fallback
   "San Ra-MOAN", then drop the city from the spoken line.

## Working on this server with Claude Code
- Work in `~/golden-auto-dev` on `staging`, commit, push, then run `update.sh`. Don't edit `/srv/...` folders directly.
- Node comes from nvm in `/home/mark/.nvm` (alias `default`); non-interactive shells (systemd, cron, update.sh) load
  it with `ubuntu/node/nvm-env.sh`.
- Never print or commit `private/config.json` or API keys. Never call Higgsfield/ElevenLabs/fal/HeyGen/Shotstack from
  tests; real generations cost money and need the user's approval in the dashboard.
- Logs: `journalctl -u golden-auto-staging-node`; workers → `private/data/finishing-worker.log`,
  `private/data/photo-worker.log`.
- inventory-ads/ is not used: keep `goldenauto-video.timer` disabled.
