# Deploy / update on the Ubuntu VM

Paths below assume the project lives in `/srv/golden-auto` (as in the server backup). Adjust if different.

## Update an existing install (this change set)

```bash
cd /srv/golden-auto
cp -a private private.bak-$(date +%Y%m%d)        # config.php, data/ and narrations stay in place
# copy the new files over (from the repo checkout or the ZIP):
#   private/captions.php private/finishing.php private/finish_video.py private/caption_worker.php
#   private/app.php private/config.example.php public/index.php public/app.js tests/captions.php README.md docs/ CLAUDE.md
rm -f private/agent_jobs.php public/worker.php tests/agent.php UPDATE_WINDOWS_AGENT.md
for f in private/*.php public/*.php; do php -l "$f"; done
php tests/captions.php && php tests/references.php
sudo systemctl reload php*-fpm 2>/dev/null || true   # clears opcache
```

Do not touch `private/config.php`, `private/data/agent.sqlite` or `public/assets/`. No database migration is needed; saved jobs, narrations and finishing plans keep working.

## One-time setup (fresh machine)

```bash
sudo apt install ffmpeg python3-pil fonts-dejavu-core php-fpm php-cli php-sqlite3 php-gd php-zip php-curl php-xml sqlite3
cp -n private/config.example.php private/config.php && nano private/config.php
```

Config keys: `password_hash`, `higgsfield_key`, `elevenlabs_key`, `fal_key`, `public_base_url` (`https://video.mygoldenauto.net:4343`), `render_backend` (`linux`), `ffmpeg_path`, `data_dir`. Writable by the PHP user: `private/data`, `public/assets`, `public/assets/narrations`.

Raise PHP limits for ZIP import: `upload_max_filesize=64M`, `post_max_size=72M`. Nginx must not serve `private/` or `*.sqlite`.

## Finishing worker (cron, once a minute)

```cron
* * * * * www-data /usr/bin/php /srv/golden-auto/private/caption_worker.php >> /srv/golden-auto/private/data/finishing-worker.log 2>&1
```

(Use the user that owns `private/data` and `public/assets`. `ubuntu/start-caption-worker.sh` is the foreground alternative for testing.)

## Re-render the existing Subaru video with the new captions

Dashboard → Video jobs → the lip-synced job → **Review captions**. The draft is rebuilt from the approved narration audio and the saved `caption_script`. Edit the caption text first in the narration panel if it still says "Priced at" while the audio says "Just". Tick the review box, **Render captioned video**. No new paid generation happens at this step.

## Rollback

`rm -rf private && mv private.bak-YYYYMMDD private`, then copy the old `public/index.php` and `public/app.js` back.
