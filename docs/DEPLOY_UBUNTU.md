# Deploy / update on the Ubuntu VM

Both sites run the same Node service and React dashboard (production since 2026-10-18):

| Site | Folder | Branch | Service |
| --- | --- | --- | --- |
| Production | `/srv/golden-auto` | `main` | `golden-auto-production-node`, 127.0.0.1:4353 |
| Staging | `/srv/golden-auto-staging` | `staging` | `golden-auto-staging-node`, 127.0.0.1:4352 |

## Update

Commit and push to `staging` from `~/golden-auto-dev`, deploy and check staging, then fast-forward `main`
(`git checkout main && git merge --ff-only staging && git push && git checkout staging`) and deploy production:

```bash
bash /srv/golden-auto-staging/ubuntu/update.sh   # staging
bash /srv/golden-auto/ubuntu/update.sh           # production
```

`update.sh` fast-forwards the checkout to `origin/<branch>`, checks the Python helpers, runs `npm ci` in `node/` and
`web/`, builds the dashboard into `public/app/`, runs `cd node && npm test`, and only then restarts that branch's
service. A failed build or test leaves the running service alone. It refuses any branch other than `main` and
`staging` and never touches `private/config.json`, `private/data/` or `public/assets/`. On `main` it also refreshes
inventory-ads, but only while `goldenauto-video.timer` is enabled (it is disabled). The workers pick up the new code
on their next minute. No database migration is needed.

## One-time setup

Packages: `sudo apt install ffmpeg python3-pil fonts-dejavu-core sqlite3 nginx`. Node 20+ comes from nvm for mark
(`/home/mark/.nvm`, alias `default`), not a system package; `ubuntu/node/nvm-env.sh` loads it for systemd, cron and
`update.sh`. whisper.cpp (`whisper-cli` plus a model) is optional but gives the best caption timing.

Config: `cp -n private/config.example.json private/config.json && chmod 600 private/config.json`, then fill in
`password_hash` (`cd node && npm run password-hash`), `higgsfield_key`, `elevenlabs_key`, `fal_key`,
`public_base_url` (e.g. `https://staging.mygoldenauto.net:4343`), `environment` (e.g. `staging`), `data_dir`,
`ffmpeg_path`, `whisper_cli`, `whisper_model`, `photo_python` (default `~/golden-auto-ml/bin/python`).
`private/data` and `public/assets` must be writable by mark.

Service and Nginx: `sudo bash /srv/golden-auto/ubuntu/production/setup-node-root.sh` (production) or
`sudo bash /srv/golden-auto-staging/ubuntu/staging/setup-node-root.sh` (staging). Each installs and starts its
site's service (runs `ubuntu/node/run-node.sh` as mark; port 4353 or 4352), adds a sudoers rule so deploys can
restart that one service, checks `/api/node/health`, then installs the Nginx site (`golden-auto` from
`ubuntu/production/nginx-golden-auto-production-node.conf`, or `golden-auto-staging` from
`ubuntu/staging/nginx-golden-auto-staging-node.conf`: https on 4343, static files from disk, everything else to Node,
uploads up to 72 MB) and reloads Nginx. The previous site is kept as `<site>.previous`. Safe to run again.

## Workers (cron, once a minute, mark's crontab)

```cron
* * * * * /bin/bash -c ". /srv/golden-auto/ubuntu/node/nvm-env.sh && node /srv/golden-auto/node/src/cli/caption-worker.js" >> /srv/golden-auto/private/data/finishing-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto/ubuntu/node/nvm-env.sh && node /srv/golden-auto/node/src/cli/photo-worker.js" >> /srv/golden-auto/private/data/photo-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/caption-worker.js" >> /srv/golden-auto-staging/private/data/finishing-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/photo-worker.js" >> /srv/golden-auto-staging/private/data/photo-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/social-worker.js" >> /srv/golden-auto-staging/private/data/social-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/ads-worker.js" >> /srv/golden-auto-staging/private/data/ads-worker.log 2>&1
```

The social worker (Facebook/Instagram posting, docs/META_SETUP.md) runs on staging only so far. When it is released,
add the same line for production (`/srv/golden-auto`, log `/srv/golden-auto/private/data/social-worker.log`). The ads
worker (paid Meta ads, docs/ADS_LAUNCH.md) is the same: staging first, production at release.

Each worker takes a lock folder in `data_dir`, so only one run of each happens at a time. The `goldenauto-video`
timer (inventory-ads) stays disabled.

## Logs

- Node service: `journalctl -u golden-auto-production-node` or `-u golden-auto-staging-node` (add `-f` to follow).
- Caption worker: `private/data/finishing-worker.log`; photo worker: `private/data/photo-worker.log`; social worker:
  `private/data/social-worker.log`; ads worker: `private/data/ads-worker.log`.
- Nginx: `/var/log/nginx/error.log`.
- Health: `curl -fsS http://127.0.0.1:4353/api/node/health` (production) or `:4352` (staging).

## Node.js upgrades

```bash
nvm install --lts && nvm alias default 'lts/*'
cd /srv/golden-auto-staging/node && npm test
sudo systemctl restart golden-auto-staging-node golden-auto-production-node
```

## Rollback

`update.sh` deploys only the tip of `origin/<branch>` (it refuses a detached checkout and fast-forwards to the
remote), so the normal rollback is a revert on `staging`, deployed to staging and then fast-forwarded to `main`:

```bash
cd ~/golden-auto-dev && git revert <bad commit> && git push origin staging
bash /srv/golden-auto-staging/ubuntu/update.sh
git checkout main && git merge --ff-only staging && git push && git checkout staging
bash /srv/golden-auto/ubuntu/update.sh
```

Quick stop-gap while the revert is prepared: check out the last good commit in the site's folder and rebuild by hand
(production shown; staging is the same with its folder and service).

```bash
cd /srv/golden-auto && git checkout <good commit>
. ubuntu/node/nvm-env.sh && (cd node && npm ci) && (cd web && npm ci && npm run build)
sudo systemctl restart golden-auto-production-node
git checkout main                     # afterwards, then update.sh once the fix is pushed
```

Deploys never change config, data or assets, so a rollback needs nothing else.
