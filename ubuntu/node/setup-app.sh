#!/usr/bin/env bash
# One-time app setup for node.mygoldenauto.net, run as mark after setup-root.sh: bash ubuntu/node/setup-app.sh
# Clones the nodejs branch to /srv/golden-auto-node, writes its config from production's (same API keys and password;
# own data folder, public URL and environment "node", which shows a NODE TEST banner), copies production's data and
# videos once, adds its caption and photo workers to cron, installs Node.js (LTS) with nvm in mark's home, runs the Node tests
# and starts the Node service.
# Production is only read, never changed. Safe to re-run: existing config/data are kept.
set -euo pipefail
prod=/srv/golden-auto
dir=/srv/golden-auto-node
url=https://node.mygoldenauto.net:4343

if [ ! -d "$dir/.git" ]; then
  # setup-root.sh created the folder empty and owned by mark; /srv itself is root-only, so clone straight into it.
  git clone --branch nodejs "$(git -C "$prod" remote get-url origin)" "$dir"
fi
install -d -m 700 "$dir/private/data"
install -d -m 755 "$dir/public/assets" "$dir/public/assets/narrations"

if [ ! -f "$dir/private/config.php" ]; then
  # Never printed: production's keys are copied into a file only mark can read.
  NODE_DIR="$dir" NODE_URL="$url" php -r '
    $c=require "/srv/golden-auto/private/config.php";
    $c["data_dir"]=getenv("NODE_DIR")."/private/data";$c["public_base_url"]=getenv("NODE_URL");$c["environment"]="node";
    $f=getenv("NODE_DIR")."/private/config.php";
    file_put_contents($f,"<?php\n// Node test site config, generated from production by ubuntu/node/setup-app.sh.\nreturn ".var_export($c,true).";\n");
    chmod($f,0600);'
  echo "node test site config written"
fi

if [ ! -f "$dir/private/data/agent.sqlite" ]; then
  # Consistent copy of the live database, then the video and narration files it points to.
  php -r '$d=new PDO("sqlite:/srv/golden-auto/private/data/agent.sqlite");$d->exec("VACUUM INTO \x27/srv/golden-auto-node/private/data/agent.sqlite\x27");'
  chmod 600 "$dir/private/data/agent.sqlite"
  cp -a "$prod/public/assets/." "$dir/public/assets/"
  echo "production data copied"
fi

line="* * * * * /usr/bin/php $dir/private/caption_worker.php >> $dir/private/data/finishing-worker.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qF "$dir/private/caption_worker.php"; then
  (crontab -l 2>/dev/null; echo "$line") | crontab -
  echo "node test site caption worker added to cron"
fi
# Photo worker (free: public photo downloads and the local image model): copies and sorts photos of website-imported
# client cars. Uses config photo_python when set; without the model it keeps every photo.
line="* * * * * /usr/bin/php $dir/private/photo_worker.php >> $dir/private/data/photo-worker.log 2>&1"
if [ -f "$dir/private/photo_worker.php" ] && ! crontab -l 2>/dev/null | grep -qF "$dir/private/photo_worker.php"; then
  (crontab -l 2>/dev/null; echo "$line") | crontab -
  echo "node test site photo worker added to cron"
fi

# nvm (latest release, from its GitHub repository) and the current Node LTS, for mark only. Upgrade later with
#   nvm install --lts && nvm alias default 'lts/*' && sudo systemctl restart golden-auto-node
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  git clone --quiet https://github.com/nvm-sh/nvm.git "$NVM_DIR"
  git -C "$NVM_DIR" -c advice.detachedHead=false checkout --quiet "$(git -C "$NVM_DIR" describe --abbrev=0 --tags --match 'v[0-9]*' "$(git -C "$NVM_DIR" rev-list --tags --max-count=1)")"
  echo "nvm $(git -C "$NVM_DIR" describe --tags) installed in $NVM_DIR"
fi
if ! grep -qF 'NVM_DIR/nvm.sh' "$HOME/.bashrc" 2>/dev/null; then
  printf '\n# nvm (Node version manager)\nexport NVM_DIR="$HOME/.nvm"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"\n' >> "$HOME/.bashrc"
fi
set +u; . "$NVM_DIR/nvm.sh" --no-use
if ! nvm version default >/dev/null 2>&1 || [ "$(nvm version default)" = N/A ]; then
  nvm install --lts >/dev/null
  nvm alias default 'lts/*' >/dev/null
fi
set -u
. "$dir/ubuntu/node/nvm-env.sh"
echo "Node $(node -v) from nvm"

(cd "$dir/node" && npm test >/dev/null) && echo "Node tests passed (including the PHP parity check)"
sudo systemctl restart golden-auto-node.service
sleep 1
curl -fsS http://127.0.0.1:4351/api/node/health && echo
echo "Node test site ready at $url (health check: $url/api/node/health)"
