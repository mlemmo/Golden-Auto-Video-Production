#!/usr/bin/env bash
# Build the customer site as static files for SiteGround, pointed at the portal API on our server:
#   bash ubuntu/portal/build-static.sh https://api-staging.lotspotlight.com:4343
# Produces portal/static-site.zip: upload its contents to the site's public_html (SiteGround File Manager → Upload, then
# Extract). React handles its own pages, so the zip includes an .htaccess that sends unknown paths to index.html.
set -euo pipefail
api="${1:-}"
[[ "$api" =~ ^https://[a-z0-9.-]+(:[0-9]+)?$ ]] || { echo "Usage: bash $0 https://<api-host>[:port]" >&2; exit 1; }
cd "$(cd "$(dirname "$0")/../.." && pwd)/portal/web"
. ../../ubuntu/node/nvm-env.sh
npm ci --no-audit --no-fund >/dev/null
VITE_API_BASE="$api" npx vite build >/dev/null
cat > ../public/.htaccess <<'HT'
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [L]
HT
rm -f ../static-site.zip
(cd ../public && zip -qr ../static-site.zip . -x '*.map')
echo "Built portal/static-site.zip for $api"
