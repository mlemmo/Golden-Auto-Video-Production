# Golden Auto AI Car Videos

PHP dashboard + Python helpers that turn Golden Auto (San Ramon, CA) inventory into 9:16 walk-around ads for Instagram and Facebook.

**Pipeline:** inventory (manual DealerCenter ZIP import today, SFTP XML later) → asset sheet of real car photos → Higgsfield Seedance 2.5 base video with the saved spokesperson → ElevenLabs narration (preview, listen, approve) → fal.ai sync-lipsync v2 → FFmpeg finishing (2 s intro card, dissolve, phrase captions, car-only closing card).

Runs on Ubuntu with Nginx + PHP-FPM (or `php -S` for testing), SQLite, FFmpeg (libx264, libass), Python 3 with Pillow and fonts-dejavu-core. See `docs/DEPLOY_UBUNTU.md`.

## Layout

| Path | Role |
| --- | --- |
| `public/index.php`, `app.js`, `narration.js`, `style.css` | Dashboard and JSON API (login, CSRF, import, generate, narration, finishing) |
| `private/app.php` | Inventory helpers, highest-price rule, prompts, asset sheets, DB helpers |
| `private/import.php` | DealerCenter media-ZIP importer |
| `private/references.php` | Higgsfield reference upload, `speechScript()` (prices and website spoken form), `jobError()` |
| `private/narrations.php`, `narration_bridge.py` | ElevenLabs preview/approve, fal.ai lip-sync, duplicate-submission fingerprints |
| `private/captions.php` | Caption engine: display text, phrase cues, timing from audio pauses, SRT validation |
| `private/finishing.php`, `finish_video.py` | Finishing plan, audio analysis (speech end + voiced spans), FFmpeg render |
| `private/caption_worker.php` | CLI worker (cron, every minute) that renders queued finishing jobs |
| `tests/*.php` | `php tests/captions.php`, `references.php`, `run.php`, `ubuntu.php` (no paid calls). `live.php` needs website access. |

`private/config.php` and `private/data/` (SQLite) are never committed. Copy `private/config.example.php`.

## Rules the code enforces

- Highest positive advertised price is used; imported vehicles need an explicit "still current" confirmation before paid work.
- Every paid call (Higgsfield, ElevenLabs, fal.ai) needs its own approval checkbox; identical requests are fingerprinted and never silently resubmitted.
- Narration must be previewed, listened to and approved; audio longer than the target length cannot be approved.
- Spoken text (`text`) and display captions (`caption_script`) are separate fields so pronunciation respellings never reach the screen.

## Captions

`captionCues()` turns `caption_script` into readable cues: inventory ALL-CAPS becomes normal case (acronyms like XV, SUV kept), `$14,688.00` shows as `$14,688`, the vehicle name, "Golden Auto", "test drive", price and website stay together, cues never cross a sentence, and each cue is at most two lines of 24 characters. Timing uses the voiced spans measured from the approved MP3 (`finish_video.py analyze`): when the audio pauses match the sentences each sentence is placed on its own span, otherwise sentences share the speech by syllable weight. Inside a sentence cues are spread by syllables, so this is close but not word-level alignment: always review the draft in the dashboard.
