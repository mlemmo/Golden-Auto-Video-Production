# Launching paid ads (Run as ad)

Dealers request ads in the dashboard: **Library → Run as ad** on a finished video (Meta = Facebook & Instagram, and/or
TikTok; daily budget, days, start date, radius around an address, ad text, TikTok caption, link). Each dealer's ad
accounts and defaults are under **View details → Paid ads** (admins edit). The dashboard records requests only
(table `ad_requests`, `node/src/lib/ads.js`); it never calls an ad platform or spends money.

The launch step is done by a Claude Code session with the **AdWhispr** connector, on the user's request ("launch the ad
requests"). Later a direct AdWhispr connection can do the same through `adPending` / `adRecord`.

## Rules

- Every ad is created **PAUSED**. Show the user each AdWhispr preview (budget, area, text, video) and create it only
  after they confirm. Switch an ad on (`resume_campaign`) only after a second, explicit go-ahead for that ad.
- Use only the dealer's own ad account from the request (`meta_account`, `tiktok_account`), and only the request's video
  (`video_url`, the dealer's own finished video).
- Never change a request's budget, dates, area or wording without the user.

## Steps (run in the site's folder; staging shown)

1. List what to do:

   ```bash
   cd /srv/golden-auto-staging/node && node src/cli/ad-requests.js pending
   ```

   `launch`: requests to create (one entry per platform); `end`: running ads past their end date.

2. **Meta** request → AdWhispr `launch_meta_ad`:
   - `accountId` = `meta_account`, `pageName` = `meta_page` (if set), `name` = "<vehicle> <stock> <start_date>",
     `objective` = `traffic`, `dailyBudgetUsd` = `daily_budget`
   - `cards` = `[{ videoUrl: video_url, headline }]`, `message` = `text`, `link` = `link`, `ctaType` = `LEARN_MORE`
   - `radiusAddress` = `radius_address`, `radiusKm` = `radius_km`
   - Call once for the preview, show it, then again with the `confirmToken` after the user confirms.
   - Record: `node src/cli/ad-requests.js record <id> meta status=launched_paused campaign_id=<id> ad_id=<id>`

3. **TikTok** request → AdWhispr `launch_tiktok_campaign`:
   - `accountId` = `tiktok_account`, `name` as above, `objective` = `traffic`, `dailyBudgetUsd` = `daily_budget` (≥ 20)
   - `videoUrl` = `video_url`, `adText` = `tiktok_text`, `landingPageUrl` = `link`
   - Location: resolve the dealer's area with `search_ad_targeting` (platform tiktok, kind locations); never invent ids.
   - Preview → confirm → create (paused). The dealer's TikTok account must be linked as an identity in TikTok Ads Manager.
   - Record: `… record <id> tiktok status=launched_paused campaign_id=<id> ad_group_id=<id>`

4. A launch that fails: `… record <id> <platform> status=failed error="<what the platform said>"`.

5. After the user says to switch an ad on: `resume_campaign`, then `… record <id> <platform> status=active`.

6. Ads past their end date (`end`): `pause_campaign`, then `… record <id> <platform> status=ended`. (Campaigns are
   created without an end date, so ending them is part of this step; check `pending` daily while ads run.)

7. Results: `get_account_performance` for the campaign, then
   `… record <id> <platform> spend=<amount> impressions=<n> clicks=<n>` (shown on the request in the Library).

## Notes

- Car ads are normal ads. Wording about financing, payments or credit puts a Meta ad in the "Credit" special category
  (restricted targeting); the dashboard refuses such wording.
- The video link is the dealer's finished video on this server (https, port 4343); AdWhispr uploads it into the ad
  account. If a platform cannot fetch it, record the error and tell the user.
- Other dealers: their ad accounts must be shared with the Golden AUto Meta Business portfolio / TikTok Business Center
  (partner access) and connected in AdWhispr (`connect_ad_account`) before their requests can launch.
