# Install price pronunciation and caption finishing

Keep config.php, private/data, the database and all public/assets files. No new API key is needed. No paid generation is submitted by caption finishing.

## Upload files

Into /home/customer/www/tnetg.com/golden-auto-video-private/:
- ADD captions.php and caption_worker.php first.
- REPLACE references.php and app.php.
- Keep import.php already installed.

Into /home/customer/www/tnetg.com/public_html/golden-auto-video/:
- REPLACE index.php and app.js.

## Check the server

In SSH run:

```bash
command -v php
command -v ffmpeg
ffmpeg -hide_banner -filters
```

Look for the subtitles filter. If it is absent, this server’s FFmpeg build cannot burn SRT captions; contact SiteGround about an FFmpeg build with libass, or use the local finishing script. If FFmpeg has a nonstandard path, add 'ffmpeg_path' => '/actual/path/from/command', to your existing config.php. PHP proc_open must also be available to the CLI process.

## Set up the worker

Site Tools > Devs > Cron Jobs: run every minute. Use the full PHP path returned above, followed by:

```text
/home/customer/www/tnetg.com/golden-auto-video-private/caption_worker.php
```

For a first manual run after queueing a caption job:

```bash
php /home/customer/www/tnetg.com/golden-auto-video-private/caption_worker.php
```

The worker processes one queued video per invocation with one FFmpeg thread. CLI execution avoids web-request rendering timeouts. Hosting CPU limits still apply. An interrupted render is marked failed after 15 minutes on a subsequent worker run, allowing you to queue it again.

## Use the dashboard

Hard refresh with Ctrl+Shift+R. Open Actual narration text to see written-out prices. Only speech is expanded: $14,688.25 becomes fourteen thousand six hundred eighty-eight dollars and twenty-five cents. Numeric prices remain in caption drafts and vehicle details. Expanded speech counts toward the 15- or 30-second script length limit. Existing videos do not change; correct speech requires a newly generated video.

For any completed job, click Review captions. The SRT is a script-based timing draft, NOT an audio transcript or forced alignment. Check the generated audio; correct skipped words, mispronunciation and timings. If the existing video said the price incorrectly, do not conceal that with inaccurate captions; fix the video speech before publishing. You may paste a properly timed external SRT. Check the review box and click Render captioned video. Run the worker manually or wait for cron, then Refresh status. Download captioned video opens the rendered MP4. Captions are permanently burned in; the original master remains available.

Exports: Reels 1080×1920, Facebook feed 1080×1350, square 1080×1080. The 720p generated master is scaled; scaling does not add genuine detail. Captions are white on a dark backing near the bottom, inset above common social controls. Always inspect the finished result and crop.

## Verification and limitations

Currency edge cases, speech length, SRT validation and existing reference-upload tests passed. A sample video was rendered locally with burned captions. The worker has not yet been tested on your SiteGround account. FFmpeg availability, subtitles filter support, cron setup, proc_open and video output URL downloads must be checked there. No new paid generation was submitted during development.
