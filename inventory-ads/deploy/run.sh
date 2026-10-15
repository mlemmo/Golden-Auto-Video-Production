#!/usr/bin/env bash
# One pipeline run. Used by the nightly timer; also fine to run by hand.
# Extra args go to pipeline.py (e.g. --dry-run, --only A13806).
#
# Inventory source, in order:
#   1. newest *.xml in inbox/ (DealerCenter export, once SFTP is set up)
#   2. the dashboard app's inventory (/srv/golden-auto/private/data/agent.sqlite), kept current by its DealerCenter sync
#   3. scrape mygoldenauto.net with headless Chromium (Cloudflare blocks this server today, so usually fails)
set -euo pipefail
APP=/opt/goldenauto-video
APP_DB=${APP_DB:-/srv/golden-auto/private/data/agent.sqlite}
cd "$APP"
set -a; source .env; set +a
export PLAYWRIGHT_BROWSERS_PATH="$APP/browsers"
PY="$APP/venv/bin/python"

exec 9>"$APP/.run.lock"
flock -n 9 || { echo "Another run is in progress"; exit 0; }

XML=$(ls -t inbox/*.xml 2>/dev/null | head -1 || true)
if [[ -n "$XML" ]]; then
  echo "Inventory: DealerCenter export $XML"; FEED="$XML"
elif [[ -r "$APP_DB" ]]; then
  echo "Inventory: dashboard app database"; FEED="$APP_DB"
else
  echo "Inventory: scraping website"
  "$PY" fetch_inventory.py inventory.json
  FEED=inventory.json
fi

"$PY" pipeline.py "$FEED" "$@"

# keep 60 days of finished videos for sold cars, then drop them
find out -name '*.mp4' -mtime +60 -delete 2>/dev/null || true
