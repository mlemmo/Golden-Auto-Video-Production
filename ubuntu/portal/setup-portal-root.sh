#!/usr/bin/env bash
# Put the LotSpotlight portal online for one site. The portal's API is the studio's own Node service (one backend and
# one database, 2026-11-03); its pages are static files. Run per site; safe to run again:
#   sudo bash ubuntu/portal/setup-portal-root.sh staging \
#     --api staging-api.lotspotlight.com --pages staging.lotspotlight.com --studio staging-studio.lotspotlight.com
#   sudo bash ubuntu/portal/setup-portal-root.sh production \
#     --api api.lotspotlight.com --pages lotspotlight.com --studio studio.lotspotlight.com
#
# It records the API address and the pages' addresses in private/config.json (portal_api: { url, origins }), builds the
# pages for that API, and for each address gets a Let's Encrypt certificate through Cloudflare DNS (token per domain:
# /root/.secrets/cloudflare-<domain>.ini, else the mygoldenauto.net one) and adds an Nginx site on ports 4343 and 443:
#   --api     the portal API → the studio's Node service      --pages   the portal pages (portal/public)
#   --studio  a second address for the studio (its mygoldenauto.net address keeps working)
# It also removes the separate portal API service an earlier version installed (golden-auto-<site>-portal). The
# studio's own service, Nginx site and data are not changed, apart from the restart that loads the new settings.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
site="${1:-}"; shift || true
api_host=""; pages_host=""; studio_host=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) api_host="$2"; shift 2;;
    --pages) pages_host="$2"; shift 2;;
    --studio) studio_host="$2"; shift 2;;
    *) echo "Unknown option $1" >&2; exit 1;;
  esac
done
case "$site" in
  staging) dir=/srv/golden-auto-staging; studio_port=4352;;
  production) dir=/srv/golden-auto; studio_port=4353;;
  *) echo "Usage: sudo bash $0 staging|production [--api host] [--pages host] [--studio host]" >&2; exit 1;;
esac
for h in "$api_host" "$pages_host" "$studio_host"; do
  [ -z "$h" ] || [[ "$h" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Not a host name: $h" >&2; exit 1; }
done
here="$(cd "$(dirname "$0")" && pwd)"
node_service="golden-auto-$site-node.service"
[ -d "$dir/portal/web" ] || { echo "$dir/portal/web is missing: deploy a branch with the portal first." >&2; exit 1; }

# ---- The earlier separate portal API service (MySQL) is no longer used ----
old="golden-auto-$site-portal"
if [ -f "/etc/systemd/system/$old.service" ]; then
  systemctl disable --now "$old.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$old.service" "/etc/sudoers.d/$old-restart"
  systemctl daemon-reload
  echo "Removed the old $old service (its MySQL database lotspotlight_$site is left as it was; drop it whenever you like)."
fi

# ---- Settings: the API address and the pages allowed to call it ----
if [ -n "$api_host" ] || [ -n "$pages_host" ]; then
  sudo -u mark bash -c ". '$dir/ubuntu/node/nvm-env.sh' && node '$here/set-portal-config.mjs' '$dir/private/config.json' '$api_host' '$pages_host'"
fi
sudo -u mark bash "$here/build-pages.sh" "$dir"
systemctl restart "$node_service"

# ---- Certificates and Nginx sites ----
no_cert=()
cert_for() {
  local host="$1"
  [ -f "/etc/letsencrypt/live/$host/fullchain.pem" ] && return 0
  # Each domain may have its own Cloudflare token; otherwise the mygoldenauto.net one. Renewals remember which.
  local domain creds
  domain="$(echo "$host" | awk -F. '{print $(NF-1)"."$NF}')"
  creds="/root/.secrets/cloudflare-$domain.ini"
  [ -f "$creds" ] || creds=/root/.secrets/cloudflare.ini
  certbot certonly --non-interactive --agree-tos --keep-until-expiring --dns-cloudflare \
    --dns-cloudflare-credentials "$creds" --dns-cloudflare-propagation-seconds 60 -d "$host" >/dev/null 2>&1 || { no_cert+=("$host"); return 1; }
}
ssl_lines() { printf '    listen 4343 ssl;\n    listen 443 ssl;\n    server_name %s;\n    ssl_certificate /etc/letsencrypt/live/%s/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n' "$1" "$1" "$1"; }
changed=()
install_site() {   # name, file with the server block
  local conf="/etc/nginx/sites-available/$1"
  [ -f "$conf" ] && cp "$conf" "$conf.previous"
  install -m 644 "$2" "$conf"; rm -f "$2"
  ln -sf "$conf" "/etc/nginx/sites-enabled/$1"
  changed+=("$1")
}

if [ -n "$api_host" ] && cert_for "$api_host"; then
  # The site file keeps its earlier name (golden-auto-<site>-portal) so a re-run replaces it.
  tmp="$(mktemp)"
  { echo "# $api_host → LotSpotlight portal API ($site): the studio's Node service on 127.0.0.1:$studio_port, portal paths only."
    echo "# Installed by ubuntu/portal/setup-portal-root.sh."
    echo "server {"; ssl_lines "$api_host"
    cat <<NGINX
    client_max_body_size 12m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location ~ ^/api/(auth|dealers|staff)(/|\$) {
        proxy_pass http://127.0.0.1:$studio_port;
        include /etc/nginx/proxy_params;
        proxy_read_timeout 120s;
    }
    location / {
        return 404;
    }
}
NGINX
  } > "$tmp"
  install_site "golden-auto-$site-portal" "$tmp"
fi

if [ -n "$pages_host" ] && cert_for "$pages_host"; then
  tmp="$(mktemp)"
  { echo "# $pages_host → LotSpotlight portal pages ($site): the static build in $dir/portal/public. Installed by"
    echo "# ubuntu/portal/setup-portal-root.sh; rebuilt by ubuntu/update.sh on each deploy."
    echo "server {"; ssl_lines "$pages_host"
    cat <<NGINX
    root $dir/portal/public;
    index index.html;
    $( [ "$site" = staging ] && echo 'add_header X-Robots-Tag "noindex, nofollow" always;' )
    location /static/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }
    location ~ /\. {
        deny all;
    }
    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri /index.html;
    }
}
NGINX
  } > "$tmp"
  install_site "golden-auto-$site-pages" "$tmp"
fi

if [ -n "$studio_host" ] && cert_for "$studio_host"; then
  # The studio's own Nginx site with this address and certificate instead of its mygoldenauto.net one.
  src="$dir/ubuntu/$site/nginx-golden-auto-$site-node.conf"
  tmp="$(mktemp)"
  sed -e "s|^\(\s*\)server_name .*;|\1server_name $studio_host;|" \
      -e "s|/etc/letsencrypt/live/[^/]*/|/etc/letsencrypt/live/$studio_host/|" \
      -e "s|^\(\s*\)listen 4343 ssl;|\1listen 4343 ssl;\n\1listen 443 ssl;|" \
      -e "1s|^|# Second address for the video studio ($site), made from $src by ubuntu/portal/setup-portal-root.sh.\n|" "$src" > "$tmp"
  grep -q "proxy_pass http://127.0.0.1:$studio_port" "$tmp" || { echo "Unexpected studio Nginx file $src; studio address skipped." >&2; rm -f "$tmp"; tmp=""; }
  [ -n "$tmp" ] && install_site "golden-auto-$site-studio" "$tmp"
fi

if [ ${#changed[@]} -gt 0 ]; then
  if ! nginx -t; then
    for name in "${changed[@]}"; do
      conf="/etc/nginx/sites-available/$name"
      if [ -f "$conf.previous" ]; then install -m 644 "$conf.previous" "$conf"; else rm -f "/etc/nginx/sites-enabled/$name" "$conf"; fi
    done
    echo "Nginx check failed; the new sites were taken back out." >&2; exit 1
  fi
  systemctl reload nginx.service
fi
for name in "${changed[@]}"; do
  host="$(sed -n 's/^\s*server_name \(.*\);/\1/p' "/etc/nginx/sites-available/$name" | head -1)"
  echo "Online: https://$host:4343"
done
if [ ${#no_cert[@]} -gt 0 ]; then
  echo "Not set up (no certificate): ${no_cert[*]}" >&2
  echo "Certbot could not use Cloudflare for these names. Make an API token in the Cloudflare account that has the domain" >&2
  echo "(template \"Edit zone DNS\", that zone only), save it as /root/.secrets/cloudflare-<domain>.ini containing" >&2
  echo "  dns_cloudflare_api_token = <token>" >&2
  echo "(mode 600), then run this again. Details: /var/log/letsencrypt/letsencrypt.log" >&2
  exit 1
fi
exit 0
