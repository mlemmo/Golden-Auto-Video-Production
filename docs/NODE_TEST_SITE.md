# Node test site: node.mygoldenauto.net

The Node.js port (branch `nodejs`, code in `node/`) runs on its own test site next to production and staging, so it
can be checked without touching either.

| | Node test site |
|---|---|
| URL | https://node.mygoldenauto.net:4343 (dashboard, shows a NODE TEST banner) |
| Health check | https://node.mygoldenauto.net:4343/api/node/health |
| Folder | `/srv/golden-auto-node` |
| Git branch | `nodejs` |
| Config | its own `private/config.php` (`environment` = `node`, own `data_dir` and `public_base_url`) |
| Data | its own copies (started as a copy of production on setup day) |
| Caption worker | its own cron line, every minute (PHP, until it is ported) |
| PHP-FPM pool / socket | `goldenauto-node` / `golden-auto-node.sock` |
| Node service | `golden-auto-node.service`, 127.0.0.1:4351; Nginx sends `/api/node/` to it |

Same API keys as production, so paid generations cost the same; every paid call still needs approval in its
dashboard. The inventory-ads timer stays production-only.

## One-time setup

1. Cloudflare DNS for mygoldenauto.net: add `A` record `node` → `50.209.159.73`, **DNS only** (grey cloud), like
   `video` and `staging` (Cloudflare's proxy does not carry port 4343).
2. Get the setup scripts (production and staging are on other branches):
   `git clone --depth 1 --branch nodejs https://github.com/mlemmo/golden-auto-video-production ~/node-setup`
3. `sudo bash ~/node-setup/ubuntu/node/setup-root.sh` (Node.js if needed, folder, PHP-FPM pool, certificate, nginx
   site, Node service).
4. `bash ~/node-setup/ubuntu/node/setup-app.sh` (clone, config, data copy, cron, tests, start the Node service).
5. `rm -rf ~/node-setup`

## Deploying a change

`git -C /srv/golden-auto-node pull --ff-only origin nodejs && bash /srv/golden-auto-node/ubuntu/update.sh`

`update.sh` runs the PHP checks, then the Node tests (including the PHP parity check) and restarts the Node service
only if they pass. Logs: `journalctl -u golden-auto-node`, caption worker in `private/data/finishing-worker.log`.
