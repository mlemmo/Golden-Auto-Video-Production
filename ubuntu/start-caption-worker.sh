#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
while true; do
    php "$project_dir/private/caption_worker.php" || true
    sleep 15
done
