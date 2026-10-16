#!/usr/bin/env bash
# One-time root setup for staging.mygoldenauto.net. Run: sudo bash ubuntu/staging/setup-root.sh
# Adds new files only (folder, PHP-FPM pool, nginx site, certificate); production's site and pool are not edited.
# Afterwards nginx and PHP-FPM are reloaded (no downtime for production).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
php_version=8.5

install -d -o mark -g mark -m 755 /srv/golden-auto-staging
install -m 644 "$here/php-fpm-goldenauto-staging.conf" /etc/php/$php_version/fpm/pool.d/goldenauto-staging.conf

# Certificate by DNS challenge with the same Cloudflare credentials production's certificate renews with.
if [ ! -e /etc/letsencrypt/live/staging.mygoldenauto.net/fullchain.pem ]; then
  certbot certonly --non-interactive --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 60 -d staging.mygoldenauto.net
fi

install -m 644 "$here/nginx-golden-auto-staging.conf" /etc/nginx/sites-available/golden-auto-staging
ln -sfn /etc/nginx/sites-available/golden-auto-staging /etc/nginx/sites-enabled/golden-auto-staging

php-fpm$php_version -t
nginx -t
systemctl reload php$php_version-fpm.service
systemctl reload nginx.service
echo "Staging root setup done. Next: the app copy in /srv/golden-auto-staging (Claude does this part)."
