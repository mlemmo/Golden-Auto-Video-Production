# Golden Auto AI Car Videos — notes for Claude

Continue the existing app; do not rebuild it. PHP 8.x dashboard (`public/`), PHP/Python helpers (`private/`), SQLite state, Ubuntu + Nginx + PHP-FPM, FFmpeg. Read README.md first.

- Never commit or print `private/config.php`, API keys, `private/data/`, or `public/assets/*` (all gitignored).
- Paid APIs (Higgsfield, ElevenLabs, fal.ai): never call them from tests or while fixing finishing/captions. Keep the per-call approval checks and fingerprint duplicate protection.
- Price rule: highest positive advertised price; wording in ads is "Just $14,688".
- Spoken text vs caption text are separate fields; captions use correct spelling and whole-dollar prices.
- Verify: `php -l` on every PHP file, `python3 -I -m py_compile private/*.py`, `php tests/captions.php tests/references.php tests/run.php tests/ubuntu.php tests/spokespersons.php`. Render check: see docs/DEPLOY_UBUNTU.md and the test recipe in tests/captions.php comments.
- Open items: DealerCenter SFTP XML import (needs host/credentials and a sample XML), word-level caption alignment (ElevenLabs `with-timestamps` on new takes would give exact timing), live end-to-end test on the VM.
