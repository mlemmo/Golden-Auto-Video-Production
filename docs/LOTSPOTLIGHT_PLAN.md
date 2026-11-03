# LotSpotlight — approved plan

Approved by Mark on 2026-11-03 (proposal by Sawyer); since then Sawyer decides. It replaces Milestones 2–4 of
[lotspotlight-architecture.md](lotspotlight-architecture.md); that spec still holds for everything this plan does not
change (portal ↔ worker job API, HMAC signing, roles, SiteGround limits). "LotSpotlight" and lotspotlight.com are
working names: a new business will run this project and its name is not decided yet.

## Where it runs (Sawyer, 2026-11-03)

The customer pages are a static site on SiteGround (the React build). The portal API runs on our Ubuntu server as its
own service, with MySQL on the server, next to the video studio; the studio reaches it on localhost. If the server is
down the pages still load but cannot sign in or order. Planned addresses (the domain follows the new business name):
customers lotspotlight.com, staging.lotspotlight.com; API api.lotspotlight.com, api-staging.lotspotlight.com; studio
admin.lotspotlight.com.

## The idea

The portal is the customer's storefront. Dealers pick cars from their website (or add them by hand), order videos,
pay up front, and approve the finished videos. eShield staff make the videos with the existing video studio on the
Ubuntu server (staging and production), not with a rebuilt pipeline inside the portal. The studio talks to the portal
API only through the signed worker API.

## Decisions

| Area | Decision |
| --- | --- |
| Payment | Stripe, pay per order, plus prepaid credits. Prices and margins still to be worked out. Subscriptions with a set number of videos may come later, so credits are a balance subscriptions can top up. |
| Car information | Picked from the dealer's website (read live) or added by hand; editable on the order form either way. |
| Where staff work | A staff area in the portal and an "Orders" window in the video app. |
| Customers' cars | Not stored: the dealer's website is read live when they open the Cars page (held in memory 15 minutes). A car is stored only when it is ordered, with the details and photos it was ordered with. |
| Posting | Customers post by hand for free, or pay extra for auto posting. |
| Meta app | A new Meta app under the new business, created once the business exists. The existing "Golden Auto Video Publisher" app is not used for customers. |
| Finished videos | Will move to a cloud storage service later; delivery is built so the storage place can change. |
| Video types at launch | AI spokesperson video (15 or 30 s) and photo slideshow (15, 30 or 60 s). "My footage" waits (customers would upload video files). |
| Photo uploads | Up to 30 photos of 10 MB each per car; the full files are deleted once the studio has copied them (thumbnails stay). |
| VIN | Required for cars added by form; the form fills year, make and model from the free NHTSA VIN lookup. |
| Who orders | Dealer owners and admins (approvers and viewers do not). |

## Milestones

1. **M1 Foundations** — done (Mark, 2026-10-31; Add dealer page 2026-11-03).
2. **M2 Cars and orders** — built 2026-11-03 on `siteground`, reworked the same day for the static site and live
   website reads (see portal/README.md). Done when a Golden Auto car added by hand and an eLease Returns car from its
   website are ordered, released by staff, shown in both staff views, and opened in the studio on staging.
3. **M3 Payments** — Stripe Checkout per order, a credits balance (top-ups, spending, refunds as credits), the Stripe
   webhook that marks orders paid. Built in Stripe's test mode until the new business has its account.
4. **M4 Delivery and approval** — the finished video goes from the video app to the customer's review page through a
   short-lived signed link; approve, reject with a reason, download.
5. **M5 Paid auto posting** — after approval, the video app posts to the dealer's Facebook and Instagram; needs the new
   business's Meta app (and Meta's App Review to post for other dealers).
6. **Later** — subscriptions.

## Open questions

1. Rejected videos: a free remake, a refund in credits, or a set number of free remakes per order?
2. Golden Auto: does it move to the portal as customer #1, or keep using the video studio directly?
3. Finished-video delivery until the cloud service: signed links from our server, or a storage bucket now?
4. The domain and DNS, once the new business has its name.
