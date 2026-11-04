#!/usr/bin/env bash
# Copy the GitHub repository into Forgejo (after setup-forgejo-root.sh) and, with --switch, point this server's
# staging and production checkouts at it. GitHub is not changed; the checkouts keep it as the remote "github" so a
# switch can be undone (git remote set-url origin "$(git remote get-url github)").
#   sudo bash ubuntu/forgejo/move-repo-root.sh --host git.lotspotlight.com --admin sawyer --org lotspotlight \
#     --repo golden-auto-video [--user mark:mark@example.com] [--switch]
#
#   1. Creates the organisation (private) and copies every branch and tag from GitHub (GITHUB_TOKEN in the
#      environment if the GitHub repository is private by then; it is used for this copy only, never stored).
#   2. Checks each branch arrived at the same commit as on GitHub.
#   3. --user name:email (repeatable): creates the account (random password, shown once, changed at first sign-in)
#      and adds it to the organisation's Owners.
#   4. Adds the server's deploy key (~mark/.ssh/golden_deploy.pub, the one GitHub has) read-only, so update.sh can
#      pull over SSH.
#   5. --switch: for /srv/golden-auto-staging and /srv/golden-auto, only when clean and not ahead of the copy:
#      origin → git@<host>:<org>/<repo>.git, the old address kept as "github", then a test fetch.
# The short-lived admin token this script uses is deleted at the end.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

host=""; admin=""; org=""; repo=""; github="mlemmo/Golden-Auto-Video-Production"; switch=0; users=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="$2"; shift 2;;
    --admin) admin="$2"; shift 2;;
    --org) org="$2"; shift 2;;
    --repo) repo="$2"; shift 2;;
    --github) github="$2"; shift 2;;
    --user) users+=("$2"); shift 2;;
    --switch) switch=1; shift;;
    *) echo "Unknown option $1" >&2; exit 1;;
  esac
done
name_ok() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$ ]]; }
[[ "$host" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] && name_ok "$admin" && name_ok "$org" && name_ok "$repo" && [[ "$github" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || { echo "Usage: sudo bash $0 --host git.example.com --admin <forgejo admin> --org <organisation> --repo <name> [--user name:email]… [--switch]" >&2; exit 1; }

bin=/usr/local/bin/forgejo
conf=/etc/forgejo/app.ini
work=/var/lib/forgejo
api="http://127.0.0.1:3000/api/v1"
key=/home/mark/.ssh/golden_deploy
remote="git@$host:$org/$repo.git"
as_git() { sudo -u git -H env FORGEJO_WORK_DIR="$work" "$@"; }
command -v jq >/dev/null || apt-get install -y -q jq >/dev/null
command -v sqlite3 >/dev/null || apt-get install -y -q sqlite3 >/dev/null
curl -fs -o /dev/null "http://127.0.0.1:3000/api/healthz" || { echo "Forgejo is not running; run setup-forgejo-root.sh first." >&2; exit 1; }

# ---- A short-lived token for the admin, removed on exit ----
token_name="move-repo-$(date +%s)"
token="$(as_git "$bin" --config "$conf" admin user generate-access-token --username "$admin" --token-name "$token_name" \
  --scopes write:organization,write:repository --raw)"
cleanup() {
  as_git sqlite3 "$work/data/forgejo.db" "DELETE FROM access_token WHERE name = '$token_name';" || echo "Delete the token $token_name under $admin's Settings → Applications." >&2
}
trap cleanup EXIT
call() {   # method, path, [json] → body; fails on an HTTP error with Forgejo's message
  local out code
  out="$(curl -sS -X "$1" "$api$2" -H "Authorization: token $token" -H 'Content-Type: application/json' ${3:+--data "$3"} -w '\n%{http_code}')"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  [[ "$code" =~ ^2 ]] || { echo "Forgejo $1 $2: HTTP $code $(echo "$out" | jq -r '.message? // empty' 2>/dev/null)" >&2; return 1; }
  printf '%s' "$out"
}

# ---- 1. Organisation and copy ----
if ! call GET "/orgs/$org" >/dev/null 2>&1; then
  call POST /orgs "$(jq -nc --arg o "$org" '{username: $o, visibility: "private", repo_admin_change_team_access: true}')" >/dev/null
  echo "Created the private organisation $org."
fi
if call GET "/repos/$org/$repo" >/dev/null 2>&1; then
  echo "$org/$repo already exists in Forgejo; not copied again."
else
  echo "Copying github.com/$github (every branch and tag)…"
  body="$(jq -nc --arg a "https://github.com/$github.git" --arg o "$org" --arg r "$repo" --arg t "${GITHUB_TOKEN:-}" \
    '{clone_addr: $a, repo_owner: $o, repo_name: $r, private: true, mirror: false, service: "git"} + (if $t != "" then {auth_token: $t} else {} end)')"
  call POST /repos/migrate "$body" >/dev/null
fi

# ---- 2. Same commits as on GitHub ----
gh_auth=""; [ -n "${GITHUB_TOKEN:-}" ] && gh_auth="x-access-token:$GITHUB_TOKEN@"
theirs="$(git ls-remote --heads --tags "https://${gh_auth}github.com/$github.git" | sort)"
ours="$(as_git git -C "$work/data/forgejo-repositories/${org,,}/${repo,,}.git" for-each-ref --format='%(objectname)%09%(refname)' refs/heads refs/tags | sort)"
# Annotated tags are listed twice by ls-remote (the tag and ^{}); compare branches and plain tag names only.
if [ "$(echo "$theirs" | grep -v '\^{}$')" != "$ours" ]; then
  echo "The copy differs from GitHub:" >&2; diff <(echo "$theirs" | grep -v '\^{}$') <(echo "$ours") >&2 || true; exit 1
fi
echo "Checked: $(echo "$ours" | grep -c refs/heads) branches and $(echo "$ours" | grep -c refs/tags) tags match GitHub."

# ---- 3. People ----
owners="$(call GET "/orgs/$org/teams" | jq -r '.[] | select(.name == "Owners") | .id')"
for u in "${users[@]}"; do
  uname="${u%%:*}"; uemail="${u#*:}"
  name_ok "$uname" && [[ "$uemail" == *@*.* ]] || { echo "Not name:email: $u" >&2; exit 1; }
  if ! call GET "/users/$uname" >/dev/null 2>&1; then
    echo "Creating account $uname:"
    out="$(as_git "$bin" --config "$conf" admin user create --username "$uname" --email "$uemail" --random-password --must-change-password 2>&1)" \
      || { echo "Forgejo could not create $uname: $out" >&2; exit 1; }
    echo "$out" | grep -i password || echo "$out"
  fi
  call PUT "/teams/$owners/members/$uname" >/dev/null
  echo "$uname is an owner of $org."
done

# ---- 4. The server's deploy key, read-only ----
pub="$(cat "$key.pub")"
if ! call GET "/repos/$org/$repo/keys" | jq -e --arg k "$(echo "$pub" | awk '{print $2}')" 'any(.[]; (.key | split(" ")[1]) == $k)' >/dev/null; then
  call POST "/repos/$org/$repo/keys" "$(jq -nc --arg k "$pub" '{title: "golden server (update.sh)", key: $k, read_only: true}')" >/dev/null
  echo "Added the server's deploy key (read-only)."
fi

# ---- 5. Point the server's checkouts at Forgejo ----
# mark's SSH: this host uses the deploy key, and its host key is this server's own (no first-use prompt).
cfg=/home/mark/.ssh/config
grep -q "^Host $host\$" "$cfg" 2>/dev/null || printf '\nHost %s\n  User git\n  IdentityFile ~/.ssh/golden_deploy\n  IdentitiesOnly yes\n' "$host" >> "$cfg"
kh=/home/mark/.ssh/known_hosts
for f in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub; do
  [ -f "$f" ] && ! grep -q "^$host $(awk '{print $1" "$2}' "$f")" "$kh" 2>/dev/null && echo "$host $(awk '{print $1" "$2}' "$f")" >> "$kh"
done
chown mark:mark "$cfg" "$kh"; chmod 600 "$cfg"
sudo -u mark git ls-remote "$remote" HEAD >/dev/null || { echo "The server cannot read $remote over SSH (sshd for user git, port 22?)." >&2; exit 1; }
echo "The server can read $remote over SSH."

if [ "$switch" -eq 1 ]; then
  for dir in /srv/golden-auto-staging /srv/golden-auto; do
    [ -d "$dir/.git" ] || continue
    g() { sudo -u mark git -C "$dir" "$@"; }
    branch="$(g rev-parse --abbrev-ref HEAD)"
    [ -z "$(g status --porcelain --untracked-files=no)" ] || { echo "$dir has uncommitted changes; not switched." >&2; continue; }
    if [ "$(g remote get-url origin)" = "$remote" ]; then echo "$dir already uses Forgejo."; continue; fi
    g remote get-url github >/dev/null 2>&1 || g remote add github "$(g remote get-url origin)"
    g remote set-url origin "$remote"
    g fetch -q origin "$branch"
    # Behind is fine (update.sh fast-forwards on the next deploy); ahead or apart would lose commits.
    if ! g merge-base --is-ancestor HEAD "origin/$branch"; then
      g remote set-url origin "$(g remote get-url github)"
      echo "$dir ($branch) has commits the copy does not; left on GitHub." >&2; continue
    fi
    behind="$(g rev-list --count "HEAD..origin/$branch")"
    echo "$dir ($branch) now pulls from Forgejo; GitHub kept as remote \"github\"$([ "$behind" -gt 0 ] && echo "; $behind commit(s) to deploy with update.sh")."
  done
fi

echo
echo "Repository: https://$host:4343/$org/$repo"
echo "On your PC, in your clone:"
echo "  git remote rename origin github"
echo "  git remote add origin https://$host:4343/$org/$repo.git      (or $remote with your SSH key added in Forgejo)"
echo "  git fetch origin && git branch -u origin/<your branch>"
[ "$switch" -eq 1 ] || echo "Server checkouts still pull from GitHub; run again with --switch to move them."
