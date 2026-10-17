# Sourced (not run) by the Node test site scripts: puts nvm's default Node on PATH for non-interactive shells
# (systemd, update.sh, setup-app.sh), where ~/.bashrc is not read. Node itself is managed with nvm as mark:
#   upgrade: nvm install --lts && nvm alias default 'lts/*' && sudo systemctl restart golden-auto-node
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found in $NVM_DIR; run ubuntu/node/setup-app.sh as mark first." >&2
  return 1 2>/dev/null || exit 1
fi
# nvm is not written for "set -u"; relax it while nvm loads, then restore the caller's setting.
case $- in *u*) _nvm_had_u=1; set +u;; *) _nvm_had_u=0;; esac
. "$NVM_DIR/nvm.sh" --no-use
nvm use --silent default >/dev/null
[ "$_nvm_had_u" = 1 ] && set -u
unset _nvm_had_u
