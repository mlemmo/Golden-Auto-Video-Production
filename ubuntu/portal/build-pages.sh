#!/usr/bin/env bash
# Build the LotSpotlight portal's pages (portal/web) into portal/public, pointed at this site's portal API: the
# studio's own server, on the address in private/config.json → portal_api.url (e.g. https://staging-api.lotspotlight.com:4343).
# Run as mark by update.sh and setup-portal-root.sh:  bash ubuntu/portal/build-pages.sh /srv/golden-auto-staging
set -euo pipefail
dir="${1:?site folder, e.g. /srv/golden-auto-staging}"
. "$dir/ubuntu/node/nvm-env.sh"
api=""
[ -f "$dir/private/config.json" ] && api="$(node -e 'try { const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(c.portal_api?.url ?? "")); } catch {}' "$dir/private/config.json")"
cd "$dir/portal/web"
npm ci --no-audit --no-fund >/dev/null
VITE_API_BASE="$api" npx vite build >/dev/null
echo "Portal pages built (API: ${api:-same address as the pages})."
