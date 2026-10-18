#!/usr/bin/env bash
# Switch production (video.mygoldenauto.net, /srv/golden-auto, branch main) from PHP to Node + React, in one go:
#   1. as mark: fast-forward /srv/golden-auto to origin/main and run ubuntu/update.sh (installs locked packages,
#      builds the dashboard, runs the Node tests);
#   2. install and start golden-auto-production-node.service (127.0.0.1:4353) and check that it answers;
#   3. add a sudoers rule so deploys can restart that one service;
#   4. point the Nginx site at the Node service (previous site kept as golden-auto.previous) and reload Nginx;
#   5. as mark: replace the PHP caption worker in cron with the Node caption and photo workers.
# If step 1, 2 or 4 fails, everything is put back (code, service, Nginx) and production stays on PHP.
# Needs /srv/golden-auto/private/config.json (converted from config.php beforehand). Staging is not touched.
# Run: sudo bash /home/mark/golden-auto-dev/ubuntu/production/switch-to-node.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
dir=/srv/golden-auto
service=golden-auto-production-node.service
site=/etc/nginx/sites-available/golden-auto
as_mark() { sudo -u mark -H bash -c "$1"; }

[ -f "$dir/private/config.json" ] || { echo "$dir/private/config.json missing; nothing changed." >&2; exit 1; }
old="$(as_mark "git -C $dir rev-parse HEAD")"
restore_code() { echo "Restoring the previous code ($old)…" >&2; as_mark "git -C $dir reset -q --hard $old"; }
stop_service() { systemctl disable --now "$service" 2>/dev/null || true; rm -f "/etc/systemd/system/$service"; systemctl daemon-reload; }

echo "1/5 Updating the code and building the dashboard…"
as_mark "git -C $dir fetch -q origin main && git -C $dir merge -q --ff-only origin/main"
if ! as_mark "bash $dir/ubuntu/update.sh"; then
  restore_code; echo "Build or tests failed; production left on PHP." >&2; exit 1
fi

echo "2/5 Starting the Node service…"
install -m 644 "$here/golden-auto-production-node.service" "/etc/systemd/system/$service"
systemctl daemon-reload
systemctl enable --now "$service"
systemctl restart "$service"
for i in $(seq 1 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4353/api/node/health && break
  if [ "$i" -eq 20 ]; then
    stop_service; restore_code
    echo "Node service did not answer; production left on PHP. See: journalctl -u $service" >&2; exit 1
  fi
  sleep 1
done

echo "3/5 Restart rule for deploys…"
rule=/etc/sudoers.d/golden-auto-production-node-restart
echo "mark ALL=(root) NOPASSWD: /usr/bin/systemctl restart $service" > "$rule.tmp"
visudo -cf "$rule.tmp" >/dev/null && install -m 440 "$rule.tmp" "$rule"; rm -f "$rule.tmp"

echo "4/5 Pointing Nginx at the Node service…"
cp "$site" "$site.previous"
install -m 644 "$here/nginx-golden-auto-production-node.conf" "$site"
if ! nginx -t; then
  install -m 644 "$site.previous" "$site"; stop_service; restore_code
  echo "Nginx check failed; previous site restored, production left on PHP." >&2; exit 1
fi
systemctl reload nginx.service

echo "5/5 Workers in cron…"
as_mark '
  current="$(crontab -l 2>/dev/null || true)"
  run=". /srv/golden-auto/ubuntu/node/nvm-env.sh && node /srv/golden-auto/node/src/cli"
  { grep -vF "/srv/golden-auto/private/caption_worker.php" <<< "$current" | grep -vF "/srv/golden-auto/node/src/cli/" || true
    echo "* * * * * /bin/bash -c \"$run/caption-worker.js\" >> /srv/golden-auto/private/data/finishing-worker.log 2>&1"
    echo "* * * * * /bin/bash -c \"$run/photo-worker.js\" >> /srv/golden-auto/private/data/photo-worker.log 2>&1"
  } | crontab -'

sleep 1
if curl -fsS https://video.mygoldenauto.net:4343/ | grep -q "Golden Auto • Sign in"; then
  echo "Production now runs on Node + React: https://video.mygoldenauto.net:4343 (sign in again; cookie ga_sid)."
else
  echo "Switched, but the live page check did not see the sign-in page; check https://video.mygoldenauto.net:4343" >&2
fi
