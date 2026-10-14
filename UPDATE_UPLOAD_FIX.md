# Install the reference upload fix on tnetg.com

1. Download and unzip the updated package on your computer. Back up the existing four files if you want an easy rollback.
2. Upload private/references.php into /home/customer/www/tnetg.com/golden-auto-video-private/ first.
3. Replace private/app.php in that same private folder. Keep private/import.php already installed.
4. Replace public/index.php and public/app.js in /home/customer/www/tnetg.com/public_html/golden-auto-video/.

Keep config.php, private/data, the SQLite database and public/assets. Do not upload config.example.php over your real config.php. No settings, API keys or database migrations are needed. Private files normally use 600 permissions; public files use 644.

Reload Chrome with Ctrl+Shift+R. Select your imported vehicle. Keep the asset-sheet URL and spokesperson URL in your dashboard’s assets directory. Click Check reference uploads. This uploads both images without submitting a video. If it succeeds, review the script and select 15 seconds, Showroom spokesperson and Instagram Reels; approve one paid generation and current availability/price, then click Generate once. Native speech uses the East Bay, while original visible text may still say San Ramon.

If reference uploads fail, send the displayed error. If generation fails, Refresh status shows the provider reason. Do not retry an uncertain submission without checking Higgsfield history. The upload-flow change is implemented but has not yet been tested with your live API account.
