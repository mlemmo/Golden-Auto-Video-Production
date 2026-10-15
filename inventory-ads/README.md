# Golden Auto — inventory to Instagram/Facebook video ads

```
dashboard inventory (sqlite) ─┐
DealerCenter XML / scrape  ───┴─ feed.py ─ script_gen.py (Claude) ─ render.py: HeyGen presenter on green
                                                                  └─ Shotstack: key out green, photos,
                                                                     captions, price, end card
                                                                     → out/STOCK_9x16.mp4, STOCK_4x5.mp4
                                                                     → ads.csv (live cars only)
```

## On the server (lives in this repo as `inventory-ads/`)
First time, after `bash /srv/golden-auto/ubuntu/update.sh` has pulled it:
```bash
sudo bash /srv/golden-auto/inventory-ads/deploy/install.sh
nano /opt/goldenauto-video/.env                       # HeyGen, Shotstack, Anthropic keys
/opt/goldenauto-video/deploy/run.sh --dry-run          # scripts only, no render cost
/opt/goldenauto-video/deploy/run.sh --only 870288      # one real video
```
After that, `ubuntu/update.sh` refreshes the installed copy automatically on every update.

- Runs nightly at about 5:47 am Pacific as the user that owns `/srv/golden-auto/private/data`.
- Inventory: newest `*.xml` in `/opt/goldenauto-video/inbox/`, otherwise the dashboard's own inventory
  (`agent.sqlite`, kept current by its DealerCenter sync; sheet photo picks go first), otherwise a website scrape
  (Cloudflare blocks the server today).
- Photos must be reachable by Shotstack: the dashboard serves them from `public_base_url` (`:4343/assets/...`).
- Videos: `/opt/goldenauto-video/out/`. Logs: `journalctl -u goldenauto-video -n 200`.
- Price: the dashboard's price (highest advertised), spoken and shown as "Just $14,688".

## Local setup (optional)
```
pip install anthropic requests
export ANTHROPIC_API_KEY=...  HEYGEN_API_KEY=...  HEYGEN_AVATAR_ID=...  HEYGEN_VOICE_ID=...
export SHOTSTACK_API_KEY=...  SHOTSTACK_ENV=stage     # stage = free watermarked tests; v1 for real
```
Avatar and voice IDs come from your HeyGen account (a custom avatar of your own salesperson works best).

## Run
1. Get inventory: open mygoldenauto.net in Chrome, paste `scrape_inventory.js` in the DevTools console → `inventory.json`.
   When the XML export arrives, run `python feed.py export.xml` and add any unmatched tag names to `FIELD_ALIASES`.
2. `python pipeline.py inventory.json --dry-run` → reads scripts in `out/*_script.json`, no render spend.
3. `python pipeline.py inventory.json --only A13806` → one car end to end; tune layout offsets in `render.py`.
4. `python pipeline.py inventory.json` → all new or re-priced cars. Sold cars drop out of `ads.csv`.

## Before going live
- **Price**: the site shows a fee-inclusive price ($27,026.25) while the schema/feed price is $26,888. The pipeline advertises the fee-inclusive one. Confirm with whoever handles compliance.
- End card shows VIN and stock # (California used-vehicle ads must identify the car by VIN or plate).
- Meta: ads mentioning financing may fall under the Financial Products & Services special ad category.
- Review the first batch of scripts by hand; `script_gen.py` forbids invented features but check anyway.
