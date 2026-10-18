#!/usr/bin/env bash
# Serve video.mygoldenauto.net (production) with the Node service. Run: sudo bash ubuntu/production/setup-node-root.sh
# Installs and starts golden-auto-production-node.service (port 4353), checks it answers, then replaces production's Nginx
# site with the Node config and reloads Nginx (no downtime). Adds a sudoers rule so deploys can restart that one
# service. Staging's site is not touched. The previous Nginx site is kept as
# /etc/nginx/sites-available/golden-auto.previous.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

install -m 644 "$here/golden-auto-production-node.service" /etc/systemd/system/golden-auto-production-node.service
systemctl daemon-reload
systemctl enable --now golden-auto-production-node.service
systemctl restart golden-auto-production-node.service

rule=/etc/sudoers.d/golden-auto-production-node-restart
echo 'mark ALL=(root) NOPASSWD: /usr/bin/systemctl restart golden-auto-production-node.service' > "$rule.tmp"
visudo -cf "$rule.tmp" >/dev/null && install -m 440 "$rule.tmp" "$rule"; rm -f "$rule.tmp"

for i in $(seq 1 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4353/api/node/health && break
  [ "$i" -eq 20 ] && { echo "Node service did not answer; Nginx left unchanged. See: journalctl -u golden-auto-production-node" >&2; exit 1; }
  sleep 1
done

cp /etc/nginx/sites-available/golden-auto /etc/nginx/sites-available/golden-auto.previous
install -m 644 "$here/nginx-golden-auto-production-node.conf" /etc/nginx/sites-available/golden-auto
if ! nginx -t; then
  install -m 644 /etc/nginx/sites-available/golden-auto.previous /etc/nginx/sites-available/golden-auto
  echo "Nginx check failed; previous site restored." >&2; exit 1
fi
systemctl reload nginx.service
echo "Production runs on Node. Sign in at https://video.mygoldenauto.net:4343 (cookie ga_sid)."
