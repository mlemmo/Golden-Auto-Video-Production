# Windows caption automation agent

This replaces the SiteGround caption renderer, whose FFmpeg lacks H.264 and subtitle support. It processes only reviewed caption jobs; it does not generate a video or spend Higgsfield credits. Captions retain transparent backgrounds with white outlined text.

## SiteGround update

Disable/delete the cron entry for caption_worker.php in Site Tools. Do not delete your imported vehicles, assets or database.

Upload these files:

- Private folder /home/customer/www/tnetg.com/golden-auto-video-private/: ADD agent_jobs.php; REPLACE references.php and caption_worker.php. Keep all other private files, especially config.php.
- Public folder /home/customer/www/tnetg.com/public_html/golden-auto-video/: ADD worker.php; REPLACE index.php and app.js.

If you have not installed the previous captions update, first add private/captions.php and use the current private/app.php as well. No database migration is needed. Set PHP upload_max_filesize above the final rendered-video size and post_max_size higher still (e.g. 64M and 72M for ordinary short clips). The agent caps uploads at 100 MB; hosting limits may be lower.

## Windows setup

1. Copy the windows-agent folder from this package to your Windows computer, for example C:\GoldenAutoAgent.
2. In PowerShell run `py -3 --version`. Python 3.10 or newer is required. If Python is absent, install a current Python 3 release from python.org with the Windows launcher enabled. No pip packages are needed.
3. FFmpeg is already installed on your computer. The agent checks for libx264 and subtitles.
4. Hard refresh the dashboard (Ctrl+Shift+R). Under Video jobs, expand Connect Windows rendering agent and click Create / replace agent token. Copy the token; keep it private and do not paste it into chat. This invalidates any old rendering token.
5. Double-click setup-agent.cmd. Accept the default dashboard URL, then paste the token into the hidden prompt. Token entry will not display characters.
6. Double-click start-agent.cmd. Leave that window open. It checks the queue every 15 seconds. Ctrl+C stops it.
7. Review captions in the dashboard, check the review box, and click Render captioned video. The agent downloads the video, burns the reviewed SRT, and uploads the captioned MP4. Refresh status in the dashboard for the finished download.

The token is scoped to caption-job claiming and completion, not video generation or dealership login. SiteGround stores its SHA-256 hash. The Windows agent stores the token using Windows DPAPI, associated with the current Windows user. It does not store a DealerCenter password or a Higgsfield key. To revoke it, click Disconnect agent.

## Optional automatic start

After a successful manual test, open Task Scheduler, create a task triggered At log on for your Windows user, and choose Start a program. Program: the full Python executable path (find it with `py -3 -c "import sys; print(sys.executable)"`). Arguments: `"C:\GoldenAutoAgent\render_agent.py"`. Start in: `C:\GoldenAutoAgent`. Choose Run only when user is logged on initially. The same Windows user is needed to decrypt the token. Your computer must remain awake and connected. The .cmd launchers are simplest for the first test.

## Recovery and limitations

A claimed job is leased for 15 minutes and renewed during processing. If the computer disconnects, expired leases can be reclaimed. An upload retry is idempotent for its job lease and cannot create a duplicate caption result. Failed-render files remain under %LOCALAPPDATA%\GoldenAutoVideoAgent\work for investigation; successful temporary files are removed. The original generated master on SiteGround is not changed. Do not delete a failed local result before investigating a lost upload.

Price words, website speech spelling, caption queue behavior and upload idempotency were tested locally. An authenticated local PHP endpoint accepted an FFmpeg-rendered MP4 and returned the same result on a retry. Windows DPAPI and actual SiteGround/Windows operation remain to be validated by your setup test. Native video speech may still mispronounce the phonetic URL; review it before publishing.

The DealerCenter Chrome collector is NOT included in this version. Vehicle ZIP import remains manual. Its live page field bindings and ZIP download controls must be verified before automating that portion; no DealerCenter credentials are collected by this agent.
