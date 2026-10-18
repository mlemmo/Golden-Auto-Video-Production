# Production and staging

| | Production | Staging |
|---|---|---|
| URL | https://video.mygoldenauto.net:4343 | https://staging.mygoldenauto.net:4343 |
| Folder | `/srv/golden-auto` | `/srv/golden-auto-staging` |
| Git branch | `main` | `staging` |
| App | Node service + React dashboard (since 2026-10-18) | Node service + React dashboard |
| Service | `golden-auto-production-node`, 127.0.0.1:4353 | `golden-auto-staging-node`, 127.0.0.1:4352 |
| Config | `private/config.json` | `private/config.json` (`environment` = `staging`, own `data_dir` and `public_base_url`) |
| Data | `private/data/agent.sqlite`, `public/assets/` | its own copies (started as a copy of production) |
| Workers | caption and photo workers (Node), cron every minute | caption and photo workers (Node), cron every minute |

Staging uses the same API keys, so paid generations cost the same; every paid call still needs approval in its
dashboard, which shows a STAGING banner. The inventory-ads timer stays disabled. Staging's photo URLs point at
staging.mygoldenauto.net (rewritten after the data copy; backup `private/data/agent.sqlite.bak-before-photo-urls`).

## Everyday flow

1. Work in `~/golden-auto-dev` on branch `staging`; `cd node && npm test`, `cd web && npm run build`; commit and push.
2. Deploy staging: `bash /srv/golden-auto-staging/ubuntu/update.sh` (fast-forwards, installs, builds, tests, restarts).
3. Check the change on staging.
4. Promote to production: in `~/golden-auto-dev`,
   `git checkout main && git merge --ff-only staging && git push origin main && git checkout staging`, then
   `bash /srv/golden-auto/ubuntu/update.sh`.

`update.sh` never touches config, data or assets. Never edit either `/srv` folder directly.

## Production on Node (done, 2026-10-18)

Production was switched like staging: `sudo bash /srv/golden-auto/ubuntu/production/setup-node-root.sh` (service,
sudoers restart rule, Nginx site `golden-auto`, previous site kept as `golden-auto.previous`), its own
`private/config.json`, and Node worker cron lines (docs/DEPLOY_UBUNTU.md). `main` is `staging` fast-forwarded.

## One-time setup (staging, done)

1. Cloudflare DNS for mygoldenauto.net: `A` record `staging` → `50.209.159.73`, **DNS only** (grey cloud), like
   `video` (Cloudflare's proxy does not carry port 4343).
2. Folder, certificate and first data copy from production.
3. `private/config.json` in the staging folder (mode 600).
4. `sudo bash /srv/golden-auto-staging/ubuntu/staging/setup-node-root.sh` (Node service, sudoers restart rule, Nginx
   site). Details and cron lines: docs/DEPLOY_UBUNTU.md.
