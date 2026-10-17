# Production, staging and the Node test site

The Node.js port has its own test site, set up the same way: see docs/NODE_TEST_SITE.md.

| | Production | Staging |
|---|---|---|
| URL | https://video.mygoldenauto.net:4343 | https://staging.mygoldenauto.net:4343 |
| Folder | `/srv/golden-auto` | `/srv/golden-auto-staging` |
| Git branch | `main` | `staging` |
| Config | `private/config.php` | its own `private/config.php` (`environment` = `staging`, own `data_dir` and `public_base_url`) |
| Data | `private/data/agent.sqlite`, `public/assets/` | its own copies (started as a copy of production on setup day) |
| Caption worker | cron, every minute | its own cron line, every minute |
| PHP-FPM pool / socket | `goldenauto` / `golden-auto.sock` | `goldenauto-staging` / `golden-auto-staging.sock` |

Staging uses the same API keys, so paid generations cost the same; every paid call still needs approval in its
dashboard, which shows a STAGING banner. The inventory-ads timer is production-only and stays disabled.

## Everyday flow

1. Work in `~/golden-auto-dev` on branch `staging`; commit and push.
2. Deploy staging: `git -C /srv/golden-auto-staging pull --ff-only origin staging && bash /srv/golden-auto-staging/ubuntu/update.sh`
3. Check the change on staging.
4. Promote: in `~/golden-auto-dev`, `git checkout main && git merge --ff-only staging && git push origin main && git checkout staging`.
5. Deploy production: `git -C /srv/golden-auto pull --ff-only origin main && bash /srv/golden-auto/ubuntu/update.sh`

`update.sh` deploys whatever branch its folder is on (main or staging only) and never touches config, data or assets.
A fix needed urgently on production can go to `main` first; then merge `main` back into `staging`.

## One-time setup

1. Cloudflare DNS for mygoldenauto.net: add `A` record `staging` → `50.209.159.73`, **DNS only** (grey cloud),
   like `video` (Cloudflare's proxy does not carry port 4343).
2. `sudo bash /srv/golden-auto/ubuntu/staging/setup-root.sh` (folder, PHP-FPM pool, certificate, nginx site).
3. `bash /srv/golden-auto/ubuntu/staging/setup-app.sh` (clone, config, data copy, cron).
