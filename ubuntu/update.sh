#!/usr/bin/env bash
# Pull the latest code from GitHub, check it, and reload PHP. Never touches config.php, data/ or assets.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
git fetch origin main
git merge --ff-only origin/main
for f in private/*.php public/*.php; do php -l "$f" >/dev/null; done
python3 -I -m py_compile private/*.py
php tests/captions.php >/dev/null && php tests/references.php >/dev/null
sudo systemctl reload "$(systemctl list-units --type=service --no-legend 'php*-fpm*' | awk 'NR==1{print $1}')" 2>/dev/null || true
# Automated inventory video ads (inventory-ads/): refresh the installed copy in /opt/goldenauto-video.
# install.sh enables the paid nightly timer, so only run it when the timer is already enabled (a disabled timer stays off).
if [ -d /opt/goldenauto-video ]; then
  if systemctl is-enabled --quiet goldenauto-video.timer 2>/dev/null; then sudo bash inventory-ads/deploy/install.sh >/dev/null && echo "inventory-ads refreshed"
  else echo "inventory-ads skipped (goldenauto-video.timer disabled)"; fi
fi
echo "Updated to $(git rev-parse --short HEAD). Worker picks up changes on its next minute."
