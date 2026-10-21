# Paid ads (Run as ad)

Dealers request ads in the dashboard: **Library → Run as ad** on a finished video (Meta = Facebook & Instagram, and/or
TikTok; daily budget, days, start date, radius in miles around an address, ad text, headline, TikTok caption, link).
Each dealer's ad accounts and defaults are under **View details → Paid ads** (admins edit). Requests are stored in table
`ad_requests` (`node/src/lib/ads.js`). No third-party ad service is used.

## Meta (Facebook & Instagram): automatic, through Meta's Marketing API

The **ads worker** (`node/src/cli/ads-worker.js`, cron every minute, `node/src/lib/meta-ads.js`) does everything:

1. **Create, paused.** For each new Meta request it checks the dealer's ad account (active, billed in USD), uploads the
   finished video file from this server, waits for Meta to process it, then creates a campaign (Traffic), an ad set
   (daily budget, start and end time in the account's time zone, radius around the address, age 18+), a video creative
   (the dealer's Page and linked Instagram account, ad text, headline, Learn More → link) and the ad. **Every level is
   created PAUSED**, so nothing spends. Status: Requested → Creating → "Created, paused".
2. **Switch on.** Only when a user presses **Switch on** on the ad (and confirms the daily budget and end date) does the
   worker set the ad, ad set and campaign to Active. **Pause** pauses the campaign; Switch on resumes it.
3. **End.** The ad set carries the end date, so Meta stops delivery itself; after the end date the worker also pauses
   the campaign and marks the ad Ended.
4. **Results.** While an ad runs (and for 3 days after it ends) the worker reads spend, views and clicks hourly; they show
   on the ad in the Library and Activity.

Each id is saved the moment Meta returns it. A launch that fails (shown with Meta's message) can be **Retried**: it carries
on from the last saved id, so nothing is made twice. Because everything starts paused, a failed or abandoned launch
never spends; leftovers can be deleted in Ads Manager.

Requirements: the dealer is connected with **Connect Facebook & Instagram** and that login includes ad permissions and
the dealer's ad account (docs/META_SETUP.md, "Ads"). The Page used is the one named under Paid ads (else the chosen
Page). Log: `private/data/ads-worker.log`.

## TikTok: by hand

TikTok requests are launched by a person in TikTok Ads Manager (created paused, switched on after the user's go-ahead)
and recorded here:

```bash
cd /srv/golden-auto-staging/node && node src/cli/ad-requests.js pending      # TikTok requests to launch / ads to end
node src/cli/ad-requests.js record <id> tiktok status=launched_paused campaign_id=<id> ad_group_id=<id>
node src/cli/ad-requests.js record <id> tiktok status=active          # after the go-ahead
node src/cli/ad-requests.js record <id> tiktok status=ended            # after pausing it past its end date
node src/cli/ad-requests.js record <id> tiktok spend=<amount> impressions=<n> clicks=<n>
```

The request stores the radius in miles and km (`radius_km`) for TikTok's location tools.

## Notes

- Car ads are normal ads. Wording about financing, payments or credit puts a Meta ad in the "Credit" special category
  (restricted targeting); the dashboard refuses such wording, and campaigns are created with no special category.
- Other dealers: their ad account must be shared with the Golden AUto Meta Business portfolio (partner access) and
  included when the dealer connects Facebook.
