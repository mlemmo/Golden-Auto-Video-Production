# Handoff — state on 2026-10-16

Read CLAUDE.md first (rules, flows, tests). This note is the current status and what to do next.

## Where things stand
- **Default flow (voice=elevenlabs):** approve an ElevenLabs preview for the car in step 3 → one Seedance 2.5
  generation (four wide shots around the whole car, spokesperson beside it, approved MP3 as `audio_urls`) →
  caption_worker keeps **Seedance's own speech** (lips match it) and burns captions timed from that audio.
  Swapping in the ElevenLabs MP3 was tried and rejected by the user (lip sync very bad); code kept behind `audio_swap`.
- **Picture:** the user is happy with the framing (whole car in frame, presenter beside it, four shots).
- **Captions:** white bold text, no box/outline, faint shadow, MarginV=28 (on the floor below the car).
  `captionCues` matches audio pauses to sentence/comma boundaries (`captionAnchors`); trim stays with the car name.
- **Dashboard:** numbered steps 1 Vehicle → 2 Script → 3 Voice (preview/approve in place) → 4 Look → 5 Generate,
  Videos, Tools. Per-section status lines above the triggering button; every delete confirms.

## Open problems (next steps)
1. **"San Ramon" is mispronounced by Seedance.** A pronunciation note and the respelling "San Ruh-mone" both failed.
   Respelling is configurable: `'respell' => ['San Ramon' => '...']` in private/config.php. Next to try:
   "San Rah-moan" / "San Ra-MOAN". Fallback: drop the city from the spoken line, keep it in captions.
2. **Verify on the server** (not possible from the cloud sessions that built this): caption_worker cron runs every
   minute; a native/elevenlabs job goes generating → captions → Ready without clicks; Shotstack/HeyGen pipeline in
   `inventory-ads/` is **not used** — keep its timer disabled (`sudo systemctl disable --now goldenauto-video.timer`).
3. Existing open items in CLAUDE.md: DealerCenter SFTP XML import, word-level caption timing.

## Working on this server with Claude Code
- Work in a separate checkout (e.g. ~/golden-auto-dev), commit, push, then deploy with `bash /srv/golden-auto/ubuntu/update.sh`.
  Don't edit /srv/golden-auto directly — update.sh fast-forwards it from GitHub.
- Never print or commit private/config.php or API keys. Never call Higgsfield/ElevenLabs/fal/HeyGen/Shotstack from
  tests; real generations cost money and need the user's approval in the dashboard.
- Logs: caption worker → private/data/finishing-worker.log; PHP errors → the PHP-FPM / Nginx error logs.
