# Connecting Facebook and Instagram for posting

The dashboard's **Library → Post** sends a finished Reels (9:16) video to a dealer's Facebook Page and Instagram
account, now or at a scheduled time. The server needs, per dealer, a **Page access token**, the **Page id** and the
**Instagram account id**. This is a one-time setup for each dealer. Meta changes its screens often: the names below
were current in October 2026 (Graph API v26.0).

## 1. Instagram professional account, linked to the Page

1. In the Instagram app: **Settings → Account type and tools** → switch to a **Business** (or Creator) account.
2. Link it to the dealer's Facebook Page: in **Meta Business Suite** (business.facebook.com) → **Settings →
   Instagram accounts → Connect**, or on the Page: **Settings → Linked accounts → Instagram**.

## 2. A Meta developer app

1. Go to **developers.facebook.com → My Apps → Create app**, and choose the **Business** app type (or the use case
   for managing Pages and Instagram content). Connect it to the dealer's Business portfolio if asked.
2. Add **Facebook Login for Business** and **Instagram** (the "Instagram API with Facebook Login" setup).
3. The app needs these permissions:
   - Facebook: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   - Instagram: `instagram_basic`, `instagram_content_publish`
   - If the Page belongs to a Business portfolio and the token cannot see it, also `business_management`.
4. While the app is in **development mode**, it works for people who have a role on the app (you as the app admin)
   and Pages you manage. For other people's Pages, Meta requires **App Review** of these permissions and usually
   **Business verification**. For Golden Auto's own Page, posting as the app admin is enough.

## 3. Get the Page token and ids

1. Open the **Graph API Explorer** (developers.facebook.com/tools/explorer), choose your app, and under
   **User or Page** choose **Get User Access Token** with the permissions above. Approve the Page and the Instagram
   account in the pop-up.
2. Make the user token long-lived: open the **Access Token Debugger** (developers.facebook.com/tools/debug/accesstoken),
   paste the token and press **Extend Access Token**. Copy the new token into the Explorer.
3. In the Explorer, run `GET me/accounts`. Find the dealer's Page: its `id` is the **Page id** and its
   `access_token` is the **Page access token**. A Page token taken from a long-lived user token does not expire
   (until the password changes or the app loses access).
4. Run `GET <page id>?fields=instagram_business_account`. The returned `id` is the **Instagram account id**.
5. Check the Page token in the Access Token Debugger: it should list the permissions above and "Expires: Never".

## 4. Put them on the server (staging first)

Keep the token secret: never paste it into chat, email or the repository.

1. On the server, edit the staging settings file:

   ```bash
   nano /srv/golden-auto-staging/private/config.json
   ```

2. Add (keep the commas valid JSON; the client id for Golden Auto is `golden-auto`, other dealers use their client id
   from the dashboard):

   ```json
   "meta_accounts": {
     "golden-auto": { "page_id": "1234567890", "page_token": "EAAB…", "ig_user_id": "17841400000000000" }
   }
   ```

3. Restart the staging service so it reads the file again:

   ```bash
   sudo systemctl restart golden-auto-staging-node
   ```

4. In the dashboard: **Library → Post** on a Reels 9:16 video. The Facebook and Instagram boxes are enabled when the
   settings are right. Post the first test as a scheduled post a little ahead, or post now and watch the status under
   "Posts of this video" (the worker runs every minute; Instagram usually needs a few minutes to process a Reel).

Only Facebook: leave `ig_user_id` empty. Only Instagram: leave `page_id` empty (the Page token is still needed).

## What the app does with it

- The social worker (`node/src/cli/social-worker.js`, cron every minute, log `private/data/social-worker.log`)
  uploads the video from this server to Meta and publishes it at the chosen time. Nothing needs a public video URL.
- Instagram's API cannot schedule, so the app keeps the schedule for both platforms and publishes them together.
- Meta's limits: 30 API-published Reels per Page and 100 posts per Instagram account in 24 hours.
- If a publish answer is lost, the post is marked "Check the page" and never posted again automatically.
- Errors such as an expired token show on the post ("Meta refused the request: …"); fix the token and press Retry.
