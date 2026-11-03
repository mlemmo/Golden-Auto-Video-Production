#!/usr/bin/env bash
# Set up the LotSpotlight portal API on this server, next to the video studio (approved 2026-11-03: the customer site is
# static on SiteGround and calls this API). Run once per site:
#   sudo bash ubuntu/portal/setup-portal-root.sh staging    [api-host] [customer-site-origin,…]
#   sudo bash ubuntu/portal/setup-portal-root.sh production [api-host] [customer-site-origin,…]
# e.g. sudo bash ubuntu/portal/setup-portal-root.sh staging api-staging.lotspotlight.com https://staging.lotspotlight.com
#
# It installs MySQL if it is missing, makes the site's own database and user, writes portal/.env (only if there is none:
# new random secrets, never printed except the worker pair the studio needs), installs and starts the service
# golden-auto-<site>-portal on 127.0.0.1 (staging 4362, production 4363), lets mark restart it, and, when an api-host
# with a Let's Encrypt certificate is given, adds its Nginx site on port 4343 like the studio's. The studio's own
# services, Nginx sites and data are not touched. Safe to run again.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
site="${1:-}"; api_host="${2:-}"; origins="${3:-}"
case "$site" in
  staging) dir=/srv/golden-auto-staging; port=4362;;
  production) dir=/srv/golden-auto; port=4363;;
  *) echo "Usage: sudo bash $0 staging|production [api-host] [customer-site-origin,…]" >&2; exit 1;;
esac
service="golden-auto-$site-portal"
db="lotspotlight_$site"; dbuser="ls_$site"
[ -d "$dir/portal" ] || { echo "$dir/portal is missing: deploy a branch with the portal first." >&2; exit 1; }

# MySQL: the server's own, listening on localhost only.
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
APP_URL=https://${api_host:-localhost}
CORS_ORIGINS=$origins
HOST=127.0.0.1
PORT=$port
DATABASE_URL=mysql://$dbuser:$dbpass@localhost:3306/$db
WORKER_SHARED_SECRETS=golden-$site:$worker_secret
UPLOAD_DIR=$dir/private/portal-uploads
ENV
  chown mark:mark "$env_file"; chmod 600 "$env_file"
  echo "Wrote $env_file. For the studio's Orders window, add to $dir/private/config.json:"
  echo "  \"portal\": { \"api\": \"http://127.0.0.1:$port/api/worker\", \"worker_id\": \"golden-$site\", \"worker_secret\": \"$worker_secret\" }"
else
  echo "$env_file exists; kept as it is."
fi

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

# Dependencies and the first start (the portal creates its tables itself when it starts).
sudo -u mark bash -c ". '$dir/ubuntu/node/nvm-env.sh' && cd '$dir/portal' && npm ci --no-audit --no-fund >/dev/null"
systemctl restart "$service.service"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/auth/me" || true)"
  [ "$code" = 401 ] && break
  [ "$i" -eq 20 ] && { echo "The portal API did not answer. See: journalctl -u $service" >&2; exit 1; }
  sleep 1
done
echo "Portal API running: $service on 127.0.0.1:$port."

if [ -n "$api_host" ]; then
  cert="/etc/letsencrypt/live/$api_host"
  if [ ! -f "$cert/fullchain.pem" ]; then
    echo "No certificate for $api_host yet. Point its DNS at this server, get one (certbot certonly --nginx -d $api_host), then run this again."
    exit 0
  fi
  conf="/etc/nginx/sites-available/$service"
  cat > "$conf.tmp" <<NGINX
# $api_host:4343 → LotSpotlight portal API ($site) on 127.0.0.1:$port. Installed by ubuntu/portal/setup-portal-root.sh.
server {
    listen 4343 ssl;
    server_name $api_host;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 12m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location / {
        proxy_pass http://127.0.0.1:$port;
        include /etc/nginx/proxy_params;
        proxy_read_timeout 120s;
    }
}
NGINX
  [ -f "$conf" ] && cp "$conf" "$conf.previous"
  install -m 644 "$conf.tmp" "$conf"; rm -f "$conf.tmp"
  ln -sf "$conf" "/etc/nginx/sites-enabled/$service"
  if ! nginx -t; then
    rm -f "/etc/nginx/sites-enabled/$service"; [ -f "$conf.previous" ] && install -m 644 "$conf.previous" "$conf"
    echo "Nginx check failed; the API site was not enabled." >&2; exit 1
  fi
  systemctl reload nginx.service
  echo "API online at https://$api_host:4343 (allowed customer sites: ${origins:-none yet; set CORS_ORIGINS in $env_file})."
fi
