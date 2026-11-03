#!/usr/bin/env bash
# Install the portal's locked dependencies and build its customer pages into portal/public, pointed at this site's
# portal API (APP_URL in portal/.env). Run as mark by setup-portal-root.sh and by update.sh:
#   bash ubuntu/portal/build-pages.sh /srv/golden-auto-staging
set -euo pipefail
dir="${1:?site folder, e.g. /srv/golden-auto-staging}"
. "$dir/ubuntu/node/nvm-env.sh"
cd "$dir/portal"
npm ci --no-audit --no-fund >/dev/null
api=""
[ -f .env ] && api="$(sed -n 's/^APP_URL=//p' .env | tail -1)"
# Pages on their own address call the API on its address; without one (https://localhost) they share the API's.
if [[ -z "$api" || "$api" == https://localhost* ]]; then api=""; fi
(cd web && npm ci --no-audit --no-fund >/dev/null && VITE_API_BASE="$api" npx vite build >/dev/null)
echo "Customer pages built (API: ${api:-same address as the pages})."
