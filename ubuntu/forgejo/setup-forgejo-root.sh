#!/usr/bin/env bash
# Self-hosted git for the project: Forgejo (https://forgejo.org) on this server, private by default, behind Nginx on
# ports 4343 and 443 like the other sites. Safe to run again: settings and data are kept; a newer --version upgrades
# the program after a backup.
#   sudo bash ubuntu/forgejo/setup-forgejo-root.sh --host git.lotspotlight.com --admin sawyer --email you@example.com
#
# What it does:
#   1. Downloads Forgejo (default: the long-term-support release below), checks its SHA-256 and the Forgejo release
#      signature, installs it as /usr/local/bin/forgejo.
#   2. Creates the system user "git", /var/lib/forgejo (data, repositories) and /etc/forgejo/app.ini (first run
#      only, with new random secrets): SQLite, listens on 127.0.0.1:3000 only, no sign-up page, nothing visible
#      without signing in, new repositories private, no e-mail, no CI runner yet (Actions off).
#   3. Starts the forgejo service and creates the first admin account (random password printed once, to be changed
#      at first sign-in).
#   4. Gets a Let's Encrypt certificate through Cloudflare DNS (/root/.secrets/cloudflare-<domain>.ini, as for the
#      portal) and adds the Nginx site.
#   5. Nightly backup at 03:30 (forgejo dump → /var/backups/forgejo, 14 kept). Off-site copy with rclone when
#      /etc/forgejo/backup.env sets RCLONE_REMOTE (see the end of this script's output).
# Git over SSH uses this server's own OpenSSH (port 22) as user "git"; HTTPS works with a password or access token.
# Before running: a DNS A record for --host → 50.209.159.73 (Cloudflare, DNS only / grey cloud).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

version=15.0.11        # LTS, supported until 2027-07-15 (https://forgejo.org/docs/latest/admin/release-schedule/)
host=""; admin=""; email=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="$2"; shift 2;;
    --admin) admin="$2"; shift 2;;
    --email) email="$2"; shift 2;;
    --version) version="$2"; shift 2;;
    *) echo "Unknown option $1" >&2; exit 1;;
  esac
done
[[ "$host" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Usage: sudo bash $0 --host git.example.com --admin <username> --email <address> [--version X.Y.Z]" >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a version: $version" >&2; exit 1; }
[ -z "$admin" ] || [[ "$admin" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{1,38}$ ]] || { echo "Not a user name: $admin" >&2; exit 1; }
[ -z "$admin" ] || [[ "$email" == *@*.* ]] || { echo "Give --email for the admin account." >&2; exit 1; }

bin=/usr/local/bin/forgejo
conf=/etc/forgejo/app.ini
work=/var/lib/forgejo
port=3000
backups=/var/backups/forgejo
signing_key=EB114F5E6C0DC2BCDD183550A4B61A2DC5923710   # Forgejo releases (https://forgejo.org/download/)
as_git() { sudo -u git -H env FORGEJO_WORK_DIR="$work" "$@"; }

if ss -ltn "sport = :$port" | grep -q LISTEN && ! systemctl is-active --quiet forgejo.service; then
  echo "Port $port is already used by something else." >&2; exit 1
fi
for cmd in git gpg curl; do command -v "$cmd" >/dev/null || apt-get install -y -q "$cmd" >/dev/null; done

# ---- 1. The program, checked ----
installed="$([ -x "$bin" ] && "$bin" --version 2>/dev/null | sed -n 's/.*version \([0-9.]*\).*/\1/p' | head -1 || true)"
if [ "$installed" != "$version" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  base="https://codeberg.org/forgejo/forgejo/releases/download/v$version/forgejo-$version-linux-amd64"
  echo "Downloading Forgejo $version…"
  curl -fsSL --retry 3 -o "$tmp/forgejo" "$base"
  curl -fsSL --retry 3 -o "$tmp/forgejo.sha256" "$base.sha256"
  curl -fsSL --retry 3 -o "$tmp/forgejo.asc" "$base.asc"
  [ "$(awk '{print $1}' "$tmp/forgejo.sha256")" = "$(sha256sum "$tmp/forgejo" | awk '{print $1}')" ] || { echo "SHA-256 does not match; nothing installed." >&2; exit 1; }
  export GNUPGHOME="$tmp/gnupg"; mkdir -m 700 "$GNUPGHOME"
  gpg --batch --quiet --keyserver hkps://keys.openpgp.org --recv-keys "$signing_key" 2>/dev/null \
    || { echo "Could not fetch the Forgejo signing key from keys.openpgp.org; nothing installed." >&2; exit 1; }
  gpg --batch --status-fd 1 --verify "$tmp/forgejo.asc" "$tmp/forgejo" 2>/dev/null | grep -q "^\[GNUPG:\] VALIDSIG .* $signing_key\$" \
    || { echo "The release signature did not check out; nothing installed." >&2; exit 1; }
  unset GNUPGHOME
  if [ -n "$installed" ]; then
    # Upgrade: a backup first, then the new program (Forgejo migrates its database when it starts).
    [ -x /usr/local/sbin/forgejo-backup ] && /usr/local/sbin/forgejo-backup
    systemctl stop forgejo.service
    cp "$bin" "$bin.$installed"
    echo "Upgrading Forgejo $installed → $version (old program kept as $bin.$installed)."
  fi
  install -m 755 "$tmp/forgejo" "$bin"
fi

# ---- 2. User, folders, settings ----
id git >/dev/null 2>&1 || adduser --system --shell /bin/bash --gecos 'Git Version Control' --group --disabled-password --home /home/git git >/dev/null
install -d -o git -g git -m 750 "$work" "$work/custom" "$work/data" "$work/log"
install -d -o git -g git -m 700 /home/git/.ssh
install -d -o root -g git -m 750 /etc/forgejo
if [ ! -f "$conf" ]; then
  secret() { as_git "$bin" generate secret "$1"; }
  cat > "$conf.new" <<EOF
APP_NAME = Git
RUN_USER = git
RUN_MODE = prod
WORK_PATH = $work

[server]
PROTOCOL = http
HTTP_ADDR = 127.0.0.1
HTTP_PORT = $port
DOMAIN = $host
ROOT_URL = https://$host:4343/
DISABLE_SSH = false
START_SSH_SERVER = false
SSH_DOMAIN = $host
SSH_PORT = 22
LFS_START_SERVER = true
LFS_JWT_SECRET = $(secret LFS_JWT_SECRET)
OFFLINE_MODE = true

[database]
DB_TYPE = sqlite3
PATH = $work/data/forgejo.db
SQLITE_JOURNAL_MODE = WAL

[repository]
ROOT = $work/data/forgejo-repositories
DEFAULT_PRIVATE = private
DEFAULT_BRANCH = main

[security]
INSTALL_LOCK = true
SECRET_KEY = $(secret SECRET_KEY)
INTERNAL_TOKEN = $(secret INTERNAL_TOKEN)
MIN_PASSWORD_LENGTH = 12
LOGIN_REMEMBER_DAYS = 14

[oauth2]
JWT_SECRET = $(secret JWT_SECRET)

[service]
DISABLE_REGISTRATION = true
REQUIRE_SIGNIN_VIEW = true
DEFAULT_KEEP_EMAIL_PRIVATE = true
DEFAULT_ALLOW_CREATE_ORGANIZATION = false
ENABLE_NOTIFY_MAIL = false

[openid]
ENABLE_OPENID_SIGNIN = false
ENABLE_OPENID_SIGNUP = false

[session]
PROVIDER = db
COOKIE_SECURE = true

[mailer]
ENABLED = false

[migrations]
ALLOWED_DOMAINS = github.com,*.github.com,codeberg.org
ALLOW_LOCALNETWORKS = false

[actions]
ENABLED = false

[log]
MODE = console
LEVEL = Info
ROOT_PATH = $work/log
EOF
  chown root:git "$conf.new"; chmod 640 "$conf.new"; mv "$conf.new" "$conf"
  echo "Wrote $conf (new secrets; kept on later runs)."
fi

cat > /etc/systemd/system/forgejo.service <<EOF
[Unit]
Description=Forgejo (self-hosted git)
After=network.target

[Service]
Type=notify
User=git
Group=git
WorkingDirectory=$work/
RuntimeDirectory=forgejo
ExecStart=$bin web --config $conf
Restart=always
RestartSec=2s
Environment=USER=git HOME=/home/git FORGEJO_WORK_DIR=$work
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet forgejo.service
systemctl restart forgejo.service
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$port/api/healthz" && break; sleep 1; done
curl -fs -o /dev/null "http://127.0.0.1:$port/api/healthz" || { echo "Forgejo did not start: journalctl -u forgejo -n 50" >&2; exit 1; }

# ---- 3. First admin account ----
if [ -n "$admin" ] && ! as_git "$bin" --config "$conf" admin user list --admin 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$admin"; then
  echo "Creating admin account $admin:"
  as_git "$bin" --config "$conf" admin user create --admin --username "$admin" --email "$email" --random-password --must-change-password \
    | grep -i "password" || true
  echo "(Shown once. Sign in, choose a new password, then turn on two-factor sign-in under Settings → Security.)"
fi

# ---- 4. Certificate and Nginx ----
if [ ! -f "/etc/letsencrypt/live/$host/fullchain.pem" ]; then
  domain="$(echo "$host" | awk -F. '{print $(NF-1)"."$NF}')"
  creds="/root/.secrets/cloudflare-$domain.ini"
  [ -f "$creds" ] || { echo "No Cloudflare token for $domain at $creds (see ubuntu/portal/setup-portal-root.sh)." >&2; exit 1; }
  certbot certonly --non-interactive --agree-tos --keep-until-expiring --dns-cloudflare \
    --dns-cloudflare-credentials "$creds" --dns-cloudflare-propagation-seconds 60 -d "$host" >/dev/null 2>&1 \
    || { echo "No certificate for $host. Details: /var/log/letsencrypt/letsencrypt.log" >&2; exit 1; }
fi
site=/etc/nginx/sites-available/forgejo
[ -f "$site" ] && cp "$site" "$site.previous"
cat > "$site" <<EOF
# Forgejo (ubuntu/forgejo/setup-forgejo-root.sh)
server {
    listen 4343 ssl;
    listen 443 ssl;
    server_name $host;
    ssl_certificate /etc/letsencrypt/live/$host/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$host/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:$port;
        include /etc/nginx/proxy_params;
        proxy_set_header Connection \$http_connection;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_read_timeout 600s;
        proxy_request_buffering off;
    }
}
EOF
ln -sf "$site" /etc/nginx/sites-enabled/forgejo
if ! nginx -t 2>/dev/null; then
  if [ -f "$site.previous" ]; then cp "$site.previous" "$site"; else rm -f "$site" /etc/nginx/sites-enabled/forgejo; fi
  nginx -t; echo "Nginx check failed; the Forgejo site was taken back out." >&2; exit 1
fi
systemctl reload nginx.service

# ---- 5. Nightly backup ----
install -d -o git -g git -m 700 "$backups"
[ -f /etc/forgejo/backup.env ] || install -m 600 /dev/stdin /etc/forgejo/backup.env <<'EOF'
# Off-site copy of each nightly backup (strongly recommended: the backups otherwise live on the same disk).
# Set up an rclone remote as root first (`rclone config`; an encrypted "crypt" remote on Cloudflare R2, Backblaze B2 or
# Google Drive), then name it here, e.g. RCLONE_REMOTE=offsite-crypt:forgejo
RCLONE_REMOTE=
KEEP_DAYS=14
EOF
cat > /usr/local/sbin/forgejo-backup <<EOF
#!/usr/bin/env bash
# Nightly Forgejo backup (setup-forgejo-root.sh): repositories, database and settings in one file. The file holds the
# server's secrets (app.ini), so it stays root/git-only and any off-site copy should be encrypted.
set -euo pipefail
. /etc/forgejo/backup.env
file="$backups/forgejo-\$(date +%Y%m%d-%H%M%S).tar.gz"
cd "$backups"
sudo -u git -H env FORGEJO_WORK_DIR=$work $bin --config $conf dump --type tar.gz --file "\$file" --tempdir "$backups" --quiet
chmod 600 "\$file"
find "$backups" -name 'forgejo-*.tar.gz' -mtime +"\${KEEP_DAYS:-14}" -delete
if [ -n "\${RCLONE_REMOTE:-}" ]; then
  rclone copy "\$file" "\$RCLONE_REMOTE" && rclone delete --min-age "\${KEEP_DAYS:-14}d" "\$RCLONE_REMOTE" || { echo "Off-site copy failed" >&2; exit 1; }
else
  echo "Backup \$file made; no off-site copy (RCLONE_REMOTE not set in /etc/forgejo/backup.env)." >&2
fi
EOF
chmod 750 /usr/local/sbin/forgejo-backup
cat > /etc/systemd/system/forgejo-backup.service <<'EOF'
[Unit]
Description=Forgejo nightly backup
After=forgejo.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/forgejo-backup
EOF
cat > /etc/systemd/system/forgejo-backup.timer <<'EOF'
[Unit]
Description=Forgejo nightly backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --quiet --now forgejo-backup.timer

echo
echo "Online: https://$host:4343  (Forgejo $("$bin" --version | sed -n 's/.*version \([0-9.]*\).*/\1/p'))"
echo "SSH clone addresses: git@$host:<owner>/<repo>.git (port 22 must reach this server from outside; otherwise use HTTPS)."
echo "Backups: nightly to $backups; run one now with: sudo /usr/local/sbin/forgejo-backup"
grep -q '^RCLONE_REMOTE=.\+' /etc/forgejo/backup.env || echo "No off-site backup yet: set RCLONE_REMOTE in /etc/forgejo/backup.env." >&2
echo "Next: sudo bash ubuntu/forgejo/move-repo-root.sh … (copies the GitHub repository here)."
