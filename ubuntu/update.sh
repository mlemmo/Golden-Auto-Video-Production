#!/usr/bin/env bash
# Pull the latest code from GitHub for this checkout's branch, check it, and reload PHP. Never touches config.php,
# data/ or assets. Production (/srv/golden-auto) is on main; staging (/srv/golden-auto-staging) is on staging;
# the Node.js port test site (/srv/golden-auto-node) is on nodejs. Sites served by Node also restart their Node service.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
branch="$(git rev-parse --abbrev-ref HEAD)"
case "$branch" in main|staging|nodejs) ;; *) echo "Refusing to deploy branch '$branch' (expected main, staging or nodejs)." >&2; exit 1;; esac
git fetch origin "$branch"
git merge --ff-only "origin/$branch"
for f in private/*.php public/*.php; do php -l "$f" >/dev/null; done
python3 -I -m py_compile private/*.py
php tests/captions.php >/dev/null && php tests/references.php >/dev/null
# Sites served by Node: the test site (nodejs) and, once ubuntu/staging/setup-node-root.sh has run, staging.
case "$branch" in nodejs) service=golden-auto-node.service;; staging) service=golden-auto-staging-node.service;; *) service=;; esac
if [ -n "$service" ] && [ -f node/package.json ] && [ -f "/etc/systemd/system/$service" ]; then
  . ubuntu/node/nvm-env.sh   # Node from mark's nvm
  (cd node && npm test >/dev/null) || { echo "Node tests failed; Node service not restarted." >&2; exit 1; }
  sudo systemctl restart "$service" && echo "Node service restarted ($service)"
fi
sudo systemctl reload "$(systemctl list-units --type=service --no-legend 'php*-fpm*' | awk 'NR==1{print $1}')" 2>/dev/null || true
# Automated inventory video ads (inventory-ads/): production only. install.sh enables the paid nightly timer, so only
# run it when the timer is already enabled (a disabled timer stays off).
if [ "$branch" = main ] && [ -d /opt/goldenauto-video ]; then
  if systemctl is-enabled --quiet goldenauto-video.timer 2>/dev/null; then sudo bash inventory-ads/deploy/install.sh >/dev/null && echo "inventory-ads refreshed"
  else echo "inventory-ads skipped (goldenauto-video.timer disabled)"; fi
fi
echo "Updated $(pwd) ($branch) to $(git rev-parse --short HEAD). Worker picks up changes on its next minute."
