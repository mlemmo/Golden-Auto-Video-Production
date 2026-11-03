#!/usr/bin/env bash
# Set up the LotSpotlight portal on this server, next to the video studio. Run per site; safe to run again:
#   sudo bash ubuntu/portal/setup-portal-root.sh staging \
#     --api staging-api.lotspotlight.com --pages staging.lotspotlight.com --studio staging-studio.lotspotlight.com
#   sudo bash ubuntu/portal/setup-portal-root.sh production \
#     --api api.lotspotlight.com --pages lotspotlight.com --studio studio.lotspotlight.com
#
# It installs MySQL if it is missing and makes the site's own database and user; writes portal/.env the first time
# (new random secrets; prints the "portal" settings the studio's config needs) and keeps the API and pages addresses in
# it up to date; installs and starts the portal API service golden-auto-<site>-portal on 127.0.0.1 (staging 4362,
# production 4363) and lets mark restart it. For each address given it gets a Let's Encrypt certificate through
# Cloudflare DNS (like the mygoldenauto.net sites) and adds an Nginx site on ports 4343 and 443:
#   --api     the portal API          --pages   the customer pages (portal/public, built for that API)
#   --studio  a second address for the video studio (its mygoldenauto.net address keeps working)
# The studio's own service, its Nginx site and its data are not changed.
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
  staging) dir=/srv/golden-auto-staging; port=4362; studio_port=4352;;
  production) dir=/srv/golden-auto; port=4363; studio_port=4353;;
  *) echo "Usage: sudo bash $0 staging|production [--api host] [--pages host] [--studio host]" >&2; exit 1;;
esac
for h in "$api_host" "$pages_host" "$studio_host"; do
  [ -z "$h" ] || [[ "$h" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Not a host name: $h" >&2; exit 1; }
done
service="golden-auto-$site-portal"
db="lotspotlight_$site"; dbuser="ls_$site"
here="$(cd "$(dirname "$0")" && pwd)"
[ -d "$dir/portal" ] || { echo "$dir/portal is missing: deploy a branch with the portal first." >&2; exit 1; }

# ---- MySQL, the site's database and portal/.env ----
if ! command -v mysqld >/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mysql-server
fi
systemctl enable --now mysql.service

env_file="$dir/portal/.env"
if [ ! -f "$env_file" ]; then
  dbpass="$(openssl rand -hex 24)"
  worker_secret="$(openssl rand -hex 32)"
  mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$dbuser'@'localhost' IDENTIFIED BY '$dbpass';
ALTER USER '$dbuser'@'localhost' IDENTIFIED BY '$dbpass';
GRANT ALL PRIVILEGES ON \`$db\`.* TO '$dbuser'@'localhost';
FLUSH PRIVILEGES;
SQL
  install -d -o mark -g mark -m 750 "$dir/private/portal-uploads"
  umask 077
  cat > "$env_file" <<ENV
NODE_ENV=production
APP_URL=https://localhost
CORS_ORIGINS=
HOST=127.0.0.1
PORT=$port
DATABASE_URL=mysql://$dbuser:$dbpass@localhost:3306/$db
WORKER_SHARED_SECRETS=golden-$site:$worker_secret
UPLOAD_DIR=$dir/private/portal-uploads
ENV
  chown mark:mark "$env_file"; chmod 600 "$env_file"
  echo "Wrote $env_file. For the studio's Orders window, add to $dir/private/config.json:"
  echo "  \"portal\": { \"api\": \"http://127.0.0.1:$port/api/worker\", \"worker_id\": \"golden-$site\", \"worker_secret\": \"$worker_secret\" }"
fi
# The API's own address and the pages allowed to call it (both ports: 4343 now, 443 once the router forwards it).
set_env() { if grep -q "^$1=" "$env_file"; then sed -i "s|^$1=.*|$1=$2|" "$env_file"; else echo "$1=$2" >> "$env_file"; fi; }
[ -n "$api_host" ] && set_env APP_URL "https://$api_host:4343"
[ -n "$pages_host" ] && set_env CORS_ORIGINS "https://$pages_host:4343,https://$pages_host"

# ---- The portal API service ----
cat > "/etc/systemd/system/$service.service" <<UNIT
# LotSpotlight portal API ($site), installed by ubuntu/portal/setup-portal-root.sh. Localhost only; Nginx forwards to it.
[Unit]
Description=LotSpotlight portal API ($site)
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=mark
Group=mark
WorkingDirectory=$dir/portal
Environment=NVM_DIR=/home/mark/.nvm
ExecStart=$dir/ubuntu/node/run-portal.sh
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$service.service" >/dev/null
rule="/etc/sudoers.d/$service-restart"
echo "mark ALL=(root) NOPASSWD: /usr/bin/systemctl restart $service.service" > "$rule.tmp"
visudo -cf "$rule.tmp" >/dev/null && install -m 440 "$rule.tmp" "$rule"; rm -f "$rule.tmp"

# Dependencies, the customer pages built for this API (portal/public), and a (re)start; the portal makes its tables.
sudo -u mark bash "$here/build-pages.sh" "$dir"
systemctl restart "$service.service"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/auth/me" || true)"
  [ "$code" = 401 ] && break
  [ "$i" -eq 20 ] && { echo "The portal API did not answer. See: journalctl -u $service" >&2; exit 1; }
  sleep 1
done
echo "Portal API running: $service on 127.0.0.1:$port."

# ---- Certificates and Nginx sites ----
cert_for() {
  local host="$1"
  [ -f "/etc/letsencrypt/live/$host/fullchain.pem" ] && return 0
  certbot certonly --non-interactive --agree-tos --keep-until-expiring --dns-cloudflare \
    --dns-cloudflare-credentials /root/.secrets/cloudflare.ini --dns-cloudflare-propagation-seconds 60 -d "$host" >/dev/null || {
    echo "No certificate for $host. The Cloudflare token in /root/.secrets/cloudflare.ini may only cover mygoldenauto.net:" >&2
    echo "give it DNS edit rights on lotspotlight.com too, then run this again." >&2
    return 1
  }
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
  tmp="$(mktemp)"
  { echo "# $api_host → LotSpotlight portal API ($site) on 127.0.0.1:$port. Installed by ubuntu/portal/setup-portal-root.sh."
    echo "server {"; ssl_lines "$api_host"
    cat <<NGINX
    client_max_body_size 12m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location / {
        proxy_pass http://127.0.0.1:$port;
        include /etc/nginx/proxy_params;
        proxy_read_timeout 120s;
    }
}
NGINX
  } > "$tmp"
  install_site "$service" "$tmp"
fi

if [ -n "$pages_host" ] && cert_for "$pages_host"; then
  tmp="$(mktemp)"
  { echo "# $pages_host → LotSpotlight customer pages ($site): the static build in $dir/portal/public. Installed by"
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
systemctl restart "$service.service"
[ -n "$api_host" ] && echo "API:    https://$api_host:4343"
[ -n "$pages_host" ] && echo "Pages:  https://$pages_host:4343"
[ -n "$studio_host" ] && echo "Studio: https://$studio_host:4343"
exit 0
