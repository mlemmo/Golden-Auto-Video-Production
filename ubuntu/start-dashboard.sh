#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
php -d upload_max_filesize=64M -d post_max_size=72M -d memory_limit=512M -d max_execution_time=120 -S 127.0.0.1:4343 -t "$project_dir/public"
