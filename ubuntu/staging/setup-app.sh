#!/usr/bin/env bash
# One-time app setup for staging, run as mark after setup-root.sh: bash ubuntu/staging/setup-app.sh
# Clones the staging branch to /srv/golden-auto-staging, writes its config from production's (same API keys and
# password; own data folder and public URL), copies production's data and videos once, and adds its caption worker
# to cron. Production is only read, never changed. Safe to re-run: existing staging config/data are kept.
set -euo pipefail
prod=/srv/golden-auto
dir=/srv/golden-auto-staging
url=https://staging.mygoldenauto.net:4343

if [ ! -d "$dir/.git" ]; then
  # setup-root.sh created the folder empty and owned by mark; /srv itself is root-only, so clone straight into it.
  git clone --branch staging "$(git -C "$prod" remote get-url origin)" "$dir"
fi
install -d -m 700 "$dir/private/data"
install -d -m 755 "$dir/public/assets" "$dir/public/assets/narrations"

if [ ! -f "$dir/private/config.php" ]; then
  # Never printed: production's keys are copied into a file only mark can read.
  STAGING_DIR="$dir" STAGING_URL="$url" php -r '
    $c=require "/srv/golden-auto/private/config.php";
    $c["data_dir"]=getenv("STAGING_DIR")."/private/data";$c["public_base_url"]=getenv("STAGING_URL");$c["environment"]="staging";
    $f=getenv("STAGING_DIR")."/private/config.php";
    file_put_contents($f,"<?php\n// Staging config, generated from production by ubuntu/staging/setup-app.sh.\nreturn ".var_export($c,true).";\n");
    chmod($f,0600);'
  echo "staging config written"
fi

if [ ! -f "$dir/private/data/agent.sqlite" ]; then
  # Consistent copy of the live database, then the video and narration files it points to.
  php -r '$d=new PDO("sqlite:/srv/golden-auto/private/data/agent.sqlite");$d->exec("VACUUM INTO \x27/srv/golden-auto-staging/private/data/agent.sqlite\x27");'
  chmod 600 "$dir/private/data/agent.sqlite"
  cp -a "$prod/public/assets/." "$dir/public/assets/"
  echo "production data copied"
fi

line="* * * * * /usr/bin/php $dir/private/caption_worker.php >> $dir/private/data/finishing-worker.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qF "$dir/private/caption_worker.php"; then
  (crontab -l 2>/dev/null; echo "$line") | crontab -
  echo "staging caption worker added to cron"
fi
echo "Staging app ready at $url"
