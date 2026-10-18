#!/usr/bin/env bash
# Serve staging.mygoldenauto.net with the Node service. Run: sudo bash ubuntu/staging/setup-node-root.sh
# Installs and starts golden-auto-staging-node.service (port 4352), checks it answers, then replaces staging's Nginx
# site with the Node config and reloads Nginx (no downtime). Adds a sudoers rule so deploys can restart that one
# service. Production's site is not touched. The previous Nginx site is kept as
# /etc/nginx/sites-available/golden-auto-staging.previous.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

install -m 644 "$here/golden-auto-staging-node.service" /etc/systemd/system/golden-auto-staging-node.service
systemctl daemon-reload
systemctl enable --now golden-auto-staging-node.service
systemctl restart golden-auto-staging-node.service

rule=/etc/sudoers.d/golden-auto-staging-node-restart
echo 'mark ALL=(root) NOPASSWD: /usr/bin/systemctl restart golden-auto-staging-node.service' > "$rule.tmp"
visudo -cf "$rule.tmp" >/dev/null && install -m 440 "$rule.tmp" "$rule"; rm -f "$rule.tmp"

for i in $(seq 1 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4352/api/node/health && break
  [ "$i" -eq 20 ] && { echo "Node service did not answer; Nginx left unchanged. See: journalctl -u golden-auto-staging-node" >&2; exit 1; }
  sleep 1
done

cp /etc/nginx/sites-available/golden-auto-staging /etc/nginx/sites-available/golden-auto-staging.previous
install -m 644 "$here/nginx-golden-auto-staging-node.conf" /etc/nginx/sites-available/golden-auto-staging
if ! nginx -t; then
  install -m 644 /etc/nginx/sites-available/golden-auto-staging.previous /etc/nginx/sites-available/golden-auto-staging
  echo "Nginx check failed; previous site restored." >&2; exit 1
fi
systemctl reload nginx.service
echo "Staging now runs on Node. Sign in at https://staging.mygoldenauto.net:4343 (cookie ga_sid)."
