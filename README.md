# Golden Auto Inventory Video Agent — SiteGround starter

This PHP dashboard reads Golden Auto’s public DealerCenter-powered website, extracts current vehicles, checks each selected vehicle’s own description and price metadata, drafts an editable fact-based script, and submits a 15- or 30-second reference-based Seedance 2.5 job. It includes authenticated access, server-side credentials, status polling and duplicate request protection.

## Status and boundaries

- This is an installable starter, not a deployed service. No customer accounts were accessed and no paid generation was submitted during development.
- Live inventory discovery was verified against 11 website records on October 10, 2026. The source is the public JSONP script embedded in the website, not a contracted DealerCenter custom feed. It may change; errors stop the reader rather than guess.
- A selected vehicle’s highest positive advertised price is used across its inventory price fields and its own page metadata. Related vehicle prices and payment calculator values are excluded. Sales tax and registration remain excluded according to the website. The script and offer need final dealer review.
- Script drafting in this version is deterministic and editable, not an LLM call. Description is shown to the reviewer; it is not automatically summarized into unverified claims.
- Car asset sheets are created automatically from each vehicle’s original gallery photos. The default uses up to 9 evenly spaced source photos; this is not AI angle classification. Review the sheet and select alternative photos when needed. Locked voice synthesis and a dedicated lip-sync pipeline are follow-up work. Supply a saved spokesperson as a public HTTPS image URL. One reference-conditioned video model creates the spokesperson inset, b-roll and native sound; it does not guarantee exact face, voice, speech or car fidelity.
- The 15-second shot plan is a prompt target. Verify the actual output. A production version should generate measured scenes and composite the presenter independently if consistent placement and speech are essential.
- “Hyper Motion” is implemented as the requested energetic camera direction, not an unverified preset identifier.
- Uploaded reference `Video-80558.mp4` was visually inspected: 30.16 seconds, 1280×720 landscape, presenter beside parked car, rear-to-side-to-front movement, bottom black caption strip and yellow vehicle heading. This version adds a showroom walkthrough recipe. Audio transcription and frame-accurate matching were not performed.
- Captions, price card and final cropping are finishing work. `finish_video.py` supports FFmpeg finishing on a machine that has FFmpeg installed. SiteGround account support for FFmpeg must be checked; this package does not assume it exists there.
- Videos download manually; this starter does not publish to social accounts or schedule inventory checks.

## Hosting layout

Use a separate subdomain, e.g. video.your-owned-domain.com. This does not move or modify mygoldenauto.net.

Requirements: PHP 8.2+, cURL, DOM/XML, GD, PDO SQLite, outbound HTTPS to your website and api.higgsfield.ai, and HTTPS on the dashboard.

Upload this folder to a location outside the document root. Point the subdomain document root at its `public` directory. SiteGround may fix the document root for a subdomain; if so, copy the files in `public` into that web root and keep `private` in a sibling directory above the web root. Adjust the two `../private` paths at the top of `index.php` to the actual private location. Never put `private/config.php` or the data directory inside publicly served storage.

1. Copy `private/config.example.php` to `private/config.php`.
2. Create a password hash with `php -r 'echo password_hash("YOUR-LONG-UNIQUE-PASSWORD", PASSWORD_DEFAULT), PHP_EOL;'` and paste the hash into `password_hash`. Prefer a password manager; do not reuse a dealership account password.
3. Set `public_base_url` to the exact HTTPS dashboard URL. This is used for publicly reachable asset sheet images. Give the PHP user write access to `public/assets` (create this directory if needed). Asset-sheet URLs use random filenames; they contain public inventory photos only, and directory listing is disabled. Never upload private documents there.
4. Add the complete API key copied from https://open.higgsfield.ai/api-keys to `higgsfield_key`. Enter it directly on your host, not in chat. API billing is separate from the regular Higgsfield website subscription.
5. Keep the configuration readable only by your PHP hosting user, and make the private data directory writable by that user. Use SiteGround’s password-protected URL feature for the dashboard as an additional login gate; the included per-session throttle is not a substitute for server-level rate limiting.
6. Open the HTTPS dashboard, sign in, refresh inventory and select a vehicle.
7. Review price, description and draft script. Use at most 38 spoken words for 15 seconds or 75 for 30 seconds; names and numbers can take longer, so shorten if necessary.
8. Preview the automatically created car asset sheet. Optionally choose 1–9 gallery photos and rebuild it. Paste your saved spokesperson URL. Choose a platform format.
9. Confirm the paid generation and click Generate once. Refresh the job status. If submission is uncertain, check Higgsfield request history; never blindly resubmit.
10. Inspect the generated master for vehicle identity, spoken facts, presenter appearance and timing. Download promptly and finish with exact captions/price overlays.

## Social formats

| Option | Generation | Final target |
|---|---|---|
| Instagram Reels | 9:16 | 1080×1920 |
| Facebook Reels | 9:16 | 1080×1920 |
| Facebook feed | 3:4 | 1080×1350 (4:5 crop) |
| Instagram / Facebook square | 1:1 | 1080×1080 |

Seedance 2.5’s documented aspect ratio list does not include 4:5. The feed option uses a 3:4 master and requires finishing. Output is generated at 720p; exporting at 1080 dimensions scales the source and does not add genuine detail.

## Default creative recipe

- 0–4 s: ultra-low stabilized tracking along a sunlit street.
- 4–9 s: macro glide across the real dashboard, steering wheel and center console; leather only if present in the asset sheet.
- 9–15 s: drone dolly-out at golden hour at an illustrative showroom, with test-drive CTA.
- Trustworthy friendly adult female spokesperson, late 20s/early 30s, casual professional attire; saved reference reused.
- Native sound design mixed below the spoken script. No invented inspection, clean-title, warranty or scarcity claims.
- A fictional modern showroom must not be represented as Golden Auto’s actual premises. To depict the actual dealership, use dealership photos in a separate verified production recipe.

## Verify before enabling paid jobs

Run `php tests/run.php`. For a non-paid live inventory smoke check: `php tests/live.php`. Test hosting with your own account and a single paid generation before batching. Verify source data and references each time. This dashboard does not include automatic job retries or unrestricted batch spending.

## API references checked

- https://open.higgsfield.ai/models/bytedance/seedance-2.5/reference-to-video/api-reference
- https://open.higgsfield.ai/quick-start
- https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status

The reference model accepts `prompt`, `image_urls`, `duration`, `resolution`, `aspect_ratio`, `output_format` and `generate_audio`. API account access and successful paid execution remain unverified.

## Showroom walkthrough recipe — added from your example

Choose Showroom spokesperson for a woman standing beside a parked vehicle throughout a smooth rear-to-side-to-front camera move. Choose 15 or 30 seconds; 30 seconds is closer to the example. Bottom captions and a static top vehicle heading are finishing overlays. The dynamic tracking/interior/drone option remains available at 15 seconds. The supplied example is landscape; social formats need separately composed framing, not a blind crop that cuts off the presenter. These layout and timing requests remain model prompts, not guarantees.

## Automated asset sheets

Selecting a vehicle discovers only that vehicle’s main gallery, downloads up to 9 evenly spaced images concurrently, letterboxes them without cropping, and creates a 3-column JPEG sheet. Each panel has its source photo number. The sheet is automatically inserted as the first Seedance image reference. A selector lets you include the needed exterior and interior views; missing views are never synthesized. Changed gallery URLs invalidate the cached sheet; changes to image bytes at an unchanged URL require clicking Rebuild. The server validates image types, dimensions and size, restricts downloads to the observed DealerCenter photo host, and rejects incomplete downloads. This step does not spend Higgsfield credits. Sheet images are publicly reachable so Higgsfield can import them. The starter does not delete old sheets automatically; prune old files only after related generation jobs finish.

## tnetg.com installation layout

Planned URL: https://tnetg.com/golden-auto-video/ (not yet deployed).

Keep the existing website in place. Copy the contents of this package’s `public` directory into `tnetg.com/public_html/golden-auto-video/`. Copy `private` into `tnetg.com/golden-auto-video-private/`, outside public_html. The application automatically recognizes this private-folder layout; no code path edits are needed. Actual SiteGround folder layout may vary; verify these paths in File Manager before making changes.

Set the config’s data_dir to its private data subdirectory, keep `public_base_url` at https://tnetg.com/golden-auto-video, and set the password hash and API key. Enable PHP GD. The dashboard will build and preview asset sheets when a vehicle is selected. The package contains no real credentials and cannot become usable until these steps are completed.

Validation: the updated reader discovered 29 unique CR-V gallery photos and generated a 9-photo JPEG asset sheet. The example sheet is included in public/assets. Unit checks cover excluding similar-vehicle photos and sampling the gallery. No hosted deployment or paid video generation was performed.

## DealerCenter ZIP importer (October 12 update)

Upload a vehicle media ZIP through the new import form. Enter stock number, year, make, model, optional VIN/mileage/trim, description, and current advertised prices separated by semicolons. The highest positive price entered is selected. Blank price means call for price. ZIPs do not supply price or availability; confirm both before every paid generation. Imported vehicles never call the public inventory website for detail, asset-sheet rebuild or generation. Photo downloads therefore work despite the SiteGround-to-website 403.

Requirements now include PHP ZipArchive (Zip) and GD. Set upload_max_filesize to at least 20M and post_max_size to at least 24M for the supplied 14.4 MB archive; the application accepts at most 50 MB. The package reads each image entry, validates it, and re-encodes to a randomized JPEG file without extracting arbitrary paths. Unsupported non-image entries are ignored. ZIPs are limited to 100 images and 200 MB of expanded image data. Photos are stored under public/assets for Higgsfield reference access, using unguessable filenames.

### Update an existing installation

Keep your existing config.php, private data directory, database and public/assets. Replace public/index.php, public/app.js, public/style.css, and private/app.php. Add private/import.php. Do not replace your configured password or API key. PHP Zip and GD must be available. Reload the dashboard; if the import form is missing, hard refresh. Upload the ZIP directly; do not click Refresh inventory while website access is blocked.

### Chrome collector login design

The local Chrome collector is not implemented in this update. Planned approach: a dedicated Windows Chrome profile with an interactive DealerCenter login, reused sessions, and pauses for expired sessions/MFA. Keep any saved password in Chrome’s password manager or Windows Credential Manager. Never copy DealerCenter passwords or session cookies into the SiteGround application, source code or ZIP package. A browser profile is sensitive and must remain private on the local computer. The manual ZIP importer is the foundation for that collector.

## Reference-upload fix — October 12

The dashboard now reads the car asset sheet and spokesperson directly from its own assets folder, requests Higgsfield signed storage uploads, PUTs each image with all returned storage headers, and submits the returned public URLs to Seedance. The API key is used only for Higgsfield API calls, never the storage PUT. No video is submitted if either upload fails. Reference overrides must now point to images in this dashboard’s assets directory.

Check reference uploads is a preflight action: it uploads both images but never calls the generation endpoint. A subsequent Generate action uploads fresh references again. There is no cache or assumed retention lifetime. Provider storage policies still apply. A successful upload preflight does not guarantee video generation or prove that the old failure’s root cause was fetching external URLs.

The dashboard stores and shows provider failure reasons, including existing failed jobs when Refresh status is clicked. Known failed/canceled jobs can be resubmitted only by a new explicit Generate click. Completed, in-progress and ambiguous submissions remain protected from duplicates. Speech replaces San Ramon with the East Bay; visible vehicle data and original script text are not overwritten. Empty server responses now display the HTTP status instead of a JSON-parser error.

Install the four files listed in UPDATE_UPLOAD_FIX.md. Local tests used mocked upload responses to verify MIME handling, POST/PUT order, credential isolation and failed-PUT handling. Existing regression and syntax checks passed. Live upload with your API account remains to be tested through Check reference uploads; no paid API request was submitted during this update.

## Latest: price pronunciation and captions

See UPDATE_PRICE_CAPTIONS.md. Speech now expands dollar-prefixed amounts to words and counts the expanded length. Captions can be drafted, reviewed/edited and burned into existing completed jobs by the CLI FFmpeg cron worker. No additional transcription service or API key is used. Draft timing is approximate and must be reviewed against actual audio. Earlier notes about captions being external finishing apply to older versions; the current version includes the server worker. Original masters and imported assets remain untouched.

## Current rendering backend: Windows agent

SiteGround support confirmed its FFmpeg lacks libx264/libass and does not support a customer-installed binary. Follow UPDATE_WINDOWS_AGENT.md. The Windows renderer downloads reviewed caption jobs and uploads completed MP4 files, preserving transparent caption backgrounds. Disable the old SiteGround rendering cron. Website speech now says my golden auto dot N, E, T. Manual DealerCenter ZIP import remains the inventory path until the Chrome collector is implemented and tested.

## Ubuntu VM on port 4343

Follow UPDATE_UBUNTU_4343.md. Use private/config.ubuntu.example.php for the Ubuntu instance. The launcher binds to 127.0.0.1:4343; access it in Ubuntu or through an SSH tunnel from Windows. Local image references are uploaded to Higgsfield before generation. Linux caption rendering uses the VM’s full FFmpeg build. SiteGround config files remain untouched.
