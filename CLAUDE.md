# Golden Auto AI Car Videos — notes for Claude

Continue the existing app; do not rebuild it. PHP 8.x dashboard (`public/`), PHP/Python helpers (`private/`), SQLite state, Ubuntu + Nginx + PHP-FPM, FFmpeg. Read README.md first.

- Never commit or print `private/config.php`, API keys, `private/data/`, or `public/assets/*` (all gitignored).
- Paid APIs (Higgsfield, ElevenLabs, fal.ai): never call them from tests or while fixing finishing/captions. Keep the per-call approval checks and fingerprint duplicate protection.
- Price rule: highest positive advertised price; wording in ads is "Just $14,688".
- Spoken text vs caption text are separate fields; captions use correct spelling and whole-dollar prices.
- Verify: `php -l` on every PHP file, `python3 -I -m py_compile private/*.py`, `php tests/captions.php tests/references.php tests/run.php tests/ubuntu.php tests/spokespersons.php tests/dealercenter_sync.php`. Render check: see docs/DEPLOY_UBUNTU.md and the test recipe in tests/captions.php comments.
- DealerCenter sync today: the website (mygoldenauto.net) blocks this server via Cloudflare, so the snapshot (vehicles, descriptions, photo URLs) is read from the public website in a browser and fed to `private/dealercenter_sync.php`; the server downloads photos itself from imagescf.dealercenter.net (not blocked). DealerCenter changes reach the website within a few hours. Cars not yet posted online need DealerCenter in Chrome (ZIP fallback). Never store DealerCenter credentials and never put cost/valuation fields in the snapshot. Stored JSON turns 9000.0 into 9000: compare prices by value (`dcSamePrice`).
- Open items: DealerCenter SFTP XML import (needs host/credentials and a sample XML), word-level caption alignment (ElevenLabs `with-timestamps` on new takes would give exact timing), live end-to-end test on the VM.
