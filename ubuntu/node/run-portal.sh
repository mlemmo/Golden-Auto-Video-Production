#!/usr/bin/env bash
# Started by the portal API's service (golden-auto-<staging|production>-portal.service): runs the LotSpotlight portal
# API (portal/src/server.js, settings in portal/.env) with nvm's default Node, like run-node.sh does for the studio.
set -eo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/nvm-env.sh"
cd "$here/../../portal"
exec node src/server.js
