#!/usr/bin/env bash
# Started by the site's Node service (golden-auto-staging-node.service): runs the Node service with nvm's default Node, so upgrading Node is
# "nvm install … && nvm alias default …" plus a service restart, with no change to the service file.
set -eo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/nvm-env.sh"
cd "$here/../../node"
exec node src/server.js
