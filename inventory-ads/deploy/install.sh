#!/usr/bin/env bash
# Install or update the Golden Auto video pipeline on Ubuntu.
#   sudo bash /srv/golden-auto/inventory-ads/deploy/install.sh
# ubuntu/update.sh re-runs this automatically once it has been installed.
# Safe to re-run after copying up new code: keeps .env, state.json, out/ and inbox/.
set -euo pipefail

APP=/opt/goldenauto-video
# Run as the user that owns the dashboard's data, so the pipeline can read its inventory database
APP_DATA=/srv/golden-auto/private/data
if [[ -d $APP_DATA ]]; then RUN_USER=$(stat -c %U "$APP_DATA"); else RUN_USER="${SUDO_USER:-mark}"; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }

echo "== packages"
if ! dpkg -s python3-venv rsync >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq python3-venv python3-pip rsync >/dev/null
fi

echo "== code -> $APP"
mkdir -p "$APP"/{out,inbox,logs}
rsync -a --delete \
  --exclude '.env' --exclude 'state.json' --exclude 'ads.csv' --exclude 'inventory.json' \
  --exclude 'out/' --exclude 'inbox/' --exclude 'logs/' --exclude 'venv/' --exclude 'browsers/' \
  "$SRC"/ "$APP"/
find "$APP" -name '*.sh' -exec sed -i 's/\r$//' {} +   # in case files passed through Windows
chmod +x "$APP"/deploy/*.sh

echo "== python env"
[[ -d "$APP/venv" ]] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q anthropic requests playwright

echo "== headless chromium (for scraping the website)"
export PLAYWRIGHT_BROWSERS_PATH="$APP/browsers"
"$APP/venv/bin/playwright" install --with-deps chromium >/dev/null

if [[ ! -f "$APP/.env" ]]; then
  cp "$APP/deploy/env.example" "$APP/.env"
  echo "!! Created $APP/.env — fill in your API keys before the first run"
fi
chmod 600 "$APP/.env"
chown -R "$RUN_USER":"$RUN_USER" "$APP"

echo "== systemd"
sed "s/__USER__/$RUN_USER/" "$APP/deploy/goldenauto-video.service" > /etc/systemd/system/goldenauto-video.service
cp "$APP/deploy/goldenauto-video.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now goldenauto-video.timer

echo
echo "Installed. Next:"
echo "  nano $APP/.env                                  # add API keys"
echo "  $APP/deploy/run.sh --dry-run                    # test: scripts only, no render cost"
echo "  $APP/deploy/run.sh --only A13806                # one real video"
echo "  systemctl list-timers goldenauto-video.timer    # nightly schedule"
echo "  journalctl -u goldenauto-video -f               # logs"
