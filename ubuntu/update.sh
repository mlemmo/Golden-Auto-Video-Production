#!/usr/bin/env bash
# Pull the latest code from GitHub for this checkout's branch, check it, build the dashboard and restart the site's
# Node service. Never touches private/config.json, data/ or assets.
#   staging (/srv/golden-auto-staging, branch staging): Node service golden-auto-staging-node.
# Production (/srv/golden-auto, branch main) runs its own branch's update.sh until it is switched to Node.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
branch="$(git rev-parse --abbrev-ref HEAD)"
case "$branch" in staging) service=golden-auto-staging-node.service;; *) echo "Refusing to deploy branch '$branch' with this script (expected staging)." >&2; exit 1;; esac
git fetch origin "$branch"
git merge --ff-only "origin/$branch"
python3 -I -m py_compile private/*.py
. ubuntu/node/nvm-env.sh   # Node from mark's nvm
# Dependencies exactly as locked; the React dashboard is built into public/app (not committed).
(cd node && npm ci --no-audit --no-fund >/dev/null)
(cd web && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null) || { echo "Dashboard build failed; Node service not restarted." >&2; exit 1; }
(cd node && npm test >/dev/null) || { echo "Node tests failed; Node service not restarted." >&2; exit 1; }
[ -f private/config.json ] || { echo "private/config.json missing (see private/config.example.json)." >&2; exit 1; }
if [ -f "/etc/systemd/system/$service" ]; then
  sudo systemctl restart "$service" && echo "Node service restarted ($service)"
else
  echo "Node service $service not installed yet: run sudo bash ubuntu/staging/setup-node-root.sh"
fi
echo "Updated $(pwd) ($branch) to $(git rev-parse --short HEAD). Workers pick up changes on their next minute."
