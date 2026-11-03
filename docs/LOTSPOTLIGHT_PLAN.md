# LotSpotlight — approved plan

Approved by Mark on 2026-11-03 (proposal by Sawyer). It replaces Milestones 2–4 of
[lotspotlight-architecture.md](lotspotlight-architecture.md); that spec still holds for everything this plan does not
change (portal ↔ worker job API, HMAC signing, roles, SiteGround limits). "LotSpotlight" and lotspotlight.com are
working names: a new business will run this project and its name is not decided yet.

## The idea

The portal on SiteGround is the customer's storefront. Dealers put in their cars (by form, or pulled from their
website), order videos, pay up front, and approve the finished videos. eShield staff make the videos with the existing
video app on the Ubuntu server (staging and production), not with a rebuilt pipeline inside the portal. The two sides
talk only through the signed job API; video files never pass through the portal.

## Decisions

| Area | Decision |
| --- | --- |
| Payment | Stripe, pay per order, plus prepaid credits. Prices and margins still to be worked out. Subscriptions with a set number of videos may come later, so credits are a balance subscriptions can top up. |
| Car information | A form on the portal, or a pull from the dealer's website; editable either way. |
| Where staff work | A staff area in the portal and an "Orders" window in the video app. |
| Car pulling | Runs on the portal, which keeps every dealer's cars; the Ubuntu server receives only the car an order is for, with its photos. |
| Posting | Customers post by hand for free, or pay extra for auto posting. |
| Meta app | A new Meta app under the new business, created once the business exists. The existing "Golden Auto Video Publisher" app is not used for customers. |
| Finished videos | Will move to a cloud storage service later; delivery is built so the storage place can change. |
| Video types at launch | AI spokesperson video (15 or 30 s) and photo slideshow (15, 30 or 60 s). "My footage" waits (customers would upload video files). |
| Photo uploads | Up to 30 photos of 10 MB each per car, removed from SiteGround once copied to our server. |
| VIN | Required for cars added by form; the form fills year, make and model from the free NHTSA VIN lookup. |
| Who orders | Dealer owners and admins (approvers and viewers do not). |

## Milestones

1. **M1 Foundations** — done (Mark, 2026-10-31; Add dealer page 2026-11-03).
2. **M2 Cars and orders** — built 2026-11-03 on `siteground` (see portal/README.md). Done when a Golden Auto car added
   by form and an eLease Returns car pulled from its website are ordered, released by staff, shown in both staff
   views, and opened in the studio on staging.
3. **M3 Payments** — Stripe Checkout per order, a credits balance (top-ups, spending, refunds as credits), the Stripe
   webhook that marks orders paid. Built in Stripe's test mode until the new business has its account.
4. **M4 Delivery and approval** — the finished video goes from the video app to the customer's review page through a
   short-lived signed link; approve, reject with a reason, download.
5. **M5 Paid auto posting** — after approval, the video app posts to the dealer's Facebook and Instagram; needs the new
   business's Meta app (and Meta's App Review to post for other dealers).
6. **Later** — subscriptions.

## Open questions for Mark

1. Rejected videos: a free remake, a refund in credits, or a set number of free remakes per order?
2. Golden Auto: does it move to the portal as customer #1, or keep using the video app directly?
3. Video delivery until the cloud service: signed links from our server, or a storage bucket now?
4. Hosting: SiteGround plan, and where the portal's DNS lives (the domain follows the new business name).
