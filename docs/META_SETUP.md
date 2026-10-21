# Connecting Facebook and Instagram for posting and ads

The dashboard's **Library → Post** sends a finished Reels (9:16) video to a dealer's Facebook Page and Instagram
account, now or at a scheduled time. Each dealer connects once with **Connect Facebook & Instagram** (Facebook Login
for Business) under the dealer's details; the server keeps that dealer's token (table `client_secrets`, never sent to
the browser). Meta changes its screens often: the names below
were current in October 2026 (Graph API v26.0).

## 1. Instagram professional account, linked to the Page

1. In the Instagram app: **Settings → Account type and tools** → switch to a **Business** (or Creator) account.
2. Link it to the dealer's Facebook Page: in **Meta Business Suite** (business.facebook.com) → **Settings →
   Instagram accounts → Connect**, or on the Page: **Settings → Linked accounts → Instagram**.

## 2. The Meta app (done for Golden Auto)

The app **Golden Auto Video Publisher** (App ID `1828647338557647`, business portfolio "Golden AUto") is in development
mode with the use cases "Manage everything on your Page" and "Manage messaging & content on Instagram" and the
permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`,
`instagram_content_publish`, `business_management`. Its Facebook Login for Business configuration "Video Publisher"
(config id `1721634192854903`) gives a system-user token that never expires, with Pages and Instagram accounts as
assets. Client OAuth login, Web OAuth login, Enforce HTTPS and Strict mode are on.

**Valid OAuth Redirect URIs** must match the dashboard address exactly, port included (strict mode). In the app:
**Facebook Login for Business → Settings → Valid OAuth Redirect URIs**, add:

- staging: `https://staging.mygoldenauto.net:4343/api/node/facebook/callback`
- production (at release): `https://video.mygoldenauto.net:4343/api/node/facebook/callback`

(The saved `https://video.mygoldenauto.net/...` without `:4343` and the retired node.mygoldenauto.net address do not
match the dashboard.)

While the app is in development mode, only people with a role on the app (admin, developer, tester) can connect.
Other dealers need **Business verification** and **App Review** (advanced access for the permissions) before the app
goes Live.

## 3. Server settings (staging first)

The app secret is in **App settings → Basic → App secret**. Keep it secret: never paste it into chat, email or the
repository.

1. Edit the staging settings file on the server:

   ```bash
   nano /srv/golden-auto-staging/private/config.json
   ```

2. Add (keep it valid JSON: commas between entries):

   ```json
   "facebook": { "app_id": "1828647338557647", "app_secret": "<App secret>", "config_id": "1721634192854903", "graph_version": "v26.0" }
   ```

3. Restart the staging service so it reads the file again:

   ```bash
   sudo systemctl restart golden-auto-staging-node
   ```

## 4. Connect a dealer

1. In the dashboard choose the dealer (client) at the top, press **View details**, then **Connect Facebook &
   Instagram**.
2. Log in with Facebook and choose the dealer's Page and its Instagram account. Facebook returns you to the dashboard,
   which shows "Connected to <Page> and Instagram @<account>". If several Pages were shared, choose the one to post to.
3. **Library → Post** on a Reels 9:16 video now offers Facebook and Instagram. Post the first test as a scheduled post a
   little ahead, or post now and watch the status under "Posts of this video" (the worker runs every minute;
   Instagram usually needs a few minutes to process a Reel).

**Reconnect** replaces the stored connection; admins can **Disconnect** (the app can also be removed in the Page's
Facebook settings under Business integrations).

### Without the login button (fallback)

A Page token can also be put in the settings by hand: `"meta_accounts": { "golden-auto": { "page_id": "…",
"page_token": "…", "ig_user_id": "…" } }` (Graph API Explorer: `GET me/accounts` gives the Page id and token;
`GET <page id>?fields=instagram_business_account` the Instagram id). A dealer connected with the button uses the
connection instead.

## Ads (Run as ad → Meta)

Paid Meta ads are created by the ads worker straight through Meta's Marketing API with the same connection
(docs/ADS_LAUNCH.md). One-time setup:

1. In the app (developers.facebook.com → Golden Auto Video Publisher): **Use cases → Add use case → "Create & manage ads
   with Marketing API"**. This adds the permissions `ads_management` and `ads_read`.
2. **Facebook Login for Business → Configurations → "Video Publisher"**: add `ads_management` and `ads_read` to the
   permissions and **Ad accounts** to the assets (or create a new configuration and put its id in config
   `facebook.config_id`).
3. The dealer presses **Connect Facebook & Instagram** again and, on Facebook's screen, also ticks the dealer's ad
   account (Golden Auto: act_1331366881207657). The Page and Instagram account are chosen as before.
4. Add the ads worker to cron (docs/DEPLOY_UBUNTU.md) and check `private/data/ads-worker.log` after the first request.

While the app is in development mode this works for the app's own admins/developers/testers and ad accounts they
manage; ads for other businesses need **Advanced access** for `ads_management` (App Review and Business verification).
A failed launch shows Meta's message on the ad (for example a missing permission: reconnect, then press Retry).

Without the login button, a token with ad permissions can be put in config:
`"meta_accounts": { "golden-auto": { "ads_token": "…", "page_id": "…", "ig_user_id": "…" } }`.

## What the app does with it

- The social worker (`node/src/cli/social-worker.js`, cron every minute, log `private/data/social-worker.log`)
  uploads the video from this server to Meta and publishes it at the chosen time. Nothing needs a public video URL.
- Instagram's API cannot schedule, so the app keeps the schedule for both platforms and publishes them together.
- Meta's limits: 30 API-published Reels per Page and 100 posts per Instagram account in 24 hours.
- If a publish answer is lost, the post is marked "Check the page" and never posted again automatically.
- Errors such as an expired token show on the post ("Meta refused the request: …"); reconnect and press Retry.
