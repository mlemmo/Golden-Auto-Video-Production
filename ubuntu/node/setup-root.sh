#!/usr/bin/env bash
# One-time root setup for node.mygoldenauto.net (Node.js port test site). Run: sudo bash ubuntu/node/setup-root.sh
# Adds new files only (folder, PHP-FPM pool, certificate, nginx site, Node service); production's and staging's sites
# and pools are not edited. Node.js itself is installed by setup-app.sh with nvm, as mark (no system package).
# Nginx and PHP-FPM are reloaded (no downtime).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
php_version="$(php -r 'echo PHP_MAJOR_VERSION,".",PHP_MINOR_VERSION;')"
[ -d "/etc/php/$php_version/fpm/pool.d" ] || { echo "PHP-FPM $php_version pool folder not found." >&2; exit 1; }

install -d -o mark -g mark -m 755 /srv/golden-auto-node
install -m 644 "$here/php-fpm-goldenauto-node.conf" "/etc/php/$php_version/fpm/pool.d/goldenauto-node.conf"

# Certificate by DNS challenge with the same Cloudflare credentials production's certificate renews with.
if [ ! -e /etc/letsencrypt/live/node.mygoldenauto.net/fullchain.pem ]; then
  certbot certonly --non-interactive --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 60 -d node.mygoldenauto.net
fi

install -m 644 "$here/nginx-golden-auto-node.conf" /etc/nginx/sites-available/golden-auto-node
ln -sfn /etc/nginx/sites-available/golden-auto-node /etc/nginx/sites-enabled/golden-auto-node

# The service is enabled here and started by setup-app.sh once the code is in place.
install -m 644 "$here/golden-auto-node.service" /etc/systemd/system/golden-auto-node.service
systemctl daemon-reload
systemctl enable golden-auto-node.service

"php-fpm$php_version" -t
nginx -t
systemctl reload "php$php_version-fpm.service"
systemctl reload nginx.service
echo "Node test site root setup done. Next: bash $here/setup-app.sh (as mark, without sudo)."
