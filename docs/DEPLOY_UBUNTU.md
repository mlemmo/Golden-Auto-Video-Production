# Deploy / update on the Ubuntu VM

Staging (`/srv/golden-auto-staging`, branch `staging`) runs the Node service and React dashboard. Production
(`/srv/golden-auto`, branch `main`) still runs the old PHP app until its switch; deploy it with its own branch's docs.

## Update staging

Commit and push to `staging` from `~/golden-auto-dev`, then:

```bash
bash /srv/golden-auto-staging/ubuntu/update.sh
```

`update.sh` fast-forwards the checkout to `origin/staging`, checks the Python helpers, runs `npm ci` in `node/` and
`web/`, builds the dashboard into `public/app/`, runs `cd node && npm test`, and only then restarts
`golden-auto-staging-node` (127.0.0.1:4352). A failed build or test leaves the running service alone. It refuses any
branch other than `staging` and never touches `private/config.json`, `private/data/` or `public/assets/`. The workers
pick up the new code on their next minute. No database migration is needed.

## One-time setup

Packages: `sudo apt install ffmpeg python3-pil fonts-dejavu-core sqlite3 nginx`. Node 20+ comes from nvm for mark
(`/home/mark/.nvm`, alias `default`), not a system package; `ubuntu/node/nvm-env.sh` loads it for systemd, cron and
`update.sh`. whisper.cpp (`whisper-cli` plus a model) is optional but gives the best caption timing.

Config: `cp -n private/config.example.json private/config.json && chmod 600 private/config.json`, then fill in
`password_hash` (`cd node && npm run password-hash`), `higgsfield_key`, `elevenlabs_key`, `fal_key`,
`public_base_url` (`https://staging.mygoldenauto.net:4343`), `environment` (`staging`), `data_dir`, `ffmpeg_path`,
`whisper_cli`, `whisper_model`, `photo_python` (default `~/golden-auto-ml/bin/python`). A site with an old
`private/config.php` converts it once with `node node/src/cli/config-from-php.js` (needs the PHP CLI that one time).
`private/data` and `public/assets` must be writable by mark.

Service and Nginx: `sudo bash /srv/golden-auto-staging/ubuntu/staging/setup-node-root.sh`. It installs and starts
`golden-auto-staging-node.service` (runs `ubuntu/node/run-node.sh` as mark, port 4352), adds a sudoers rule so
deploys can restart that one service, checks `/api/node/health`, then installs the Nginx site
(`ubuntu/staging/nginx-golden-auto-staging-node.conf`: https on 4343, static files from disk, everything else to Node,
uploads up to 72 MB) and reloads Nginx. Safe to run again.

## Workers (cron, once a minute, mark's crontab)

```cron
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/caption-worker.js" >> /srv/golden-auto-staging/private/data/finishing-worker.log 2>&1
* * * * * /bin/bash -c ". /srv/golden-auto-staging/ubuntu/node/nvm-env.sh && node /srv/golden-auto-staging/node/src/cli/photo-worker.js" >> /srv/golden-auto-staging/private/data/photo-worker.log 2>&1
```

Each worker takes a lock folder in `data_dir`, so only one run of each happens at a time. The `goldenauto-video`
timer (inventory-ads) stays disabled.

## Logs

- Node service: `journalctl -u golden-auto-staging-node` (add `-f` to follow).
- Caption worker: `private/data/finishing-worker.log`; photo worker: `private/data/photo-worker.log`.
- Nginx: `/var/log/nginx/error.log`.
- Health: `curl -fsS http://127.0.0.1:4352/api/node/health`.

## Node.js upgrades

```bash
nvm install --lts && nvm alias default 'lts/*'
cd /srv/golden-auto-staging/node && npm test
sudo systemctl restart golden-auto-staging-node
```

## Rollback

`update.sh` deploys only the tip of `origin/staging` (it refuses a detached checkout and fast-forwards to the remote),
so the normal rollback is a revert:

```bash
cd ~/golden-auto-dev && git revert <bad commit> && git push origin staging
bash /srv/golden-auto-staging/ubuntu/update.sh
```

Quick stop-gap while the revert is prepared: check out the last good commit in the staging folder and rebuild by hand.

```bash
cd /srv/golden-auto-staging && git checkout <good commit>
. ubuntu/node/nvm-env.sh && (cd node && npm ci) && (cd web && npm ci && npm run build)
sudo systemctl restart golden-auto-staging-node
git checkout staging                  # afterwards, then update.sh once the fix is pushed
```

Deploys never change config, data or assets, so a rollback needs nothing else.
