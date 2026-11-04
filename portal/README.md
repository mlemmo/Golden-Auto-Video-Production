# LotSpotlight portal

The customer site. Plan: [docs/LOTSPOTLIGHT_PLAN.md](../docs/LOTSPOTLIGHT_PLAN.md) (customers order, pay and approve
here; staff make the videos in the video studio). "LotSpotlight" is a working name until the new business has one.

**One backend, one database (Sawyer, 2026-11-03).** The portal's pages (`web/`, React, built into `public/`) are
static files. Everything they show comes from the API, which is part of the studio's own Node service
(`node/src/portal/`) and uses the studio's database (`agent.sqlite`):

- **Accounts** are the studio's accounts. Studio admins are eShield staff on the portal (every dealer, add dealers,
  release orders); studio users order (and edit Dealer details) for their clients; studio viewers look. Dealer
  customers are studio accounts with the role *Portal customer*, for their own clients only, with two separate
  permissions per dealer: **order videos** and **add people** (which also covers Dealer details); neither means view
  only. They sign in on the portal and are refused by the studio. The same password works on both sites;
  either site can change it.
- **Dealers** are the studio's clients: adding one on the portal adds it to the studio; Dealer details are the
  client's script details (name, city, website, phone) plus a time zone.
- **Cars** are read live from the dealer's website (held 15 minutes in memory, nothing saved; only Dealer Car Search
  sites today). A car is stored only when ordered (`portal_cars`), with the details and photos it was ordered with.
- **Uploads** (`portal_uploads`, files in `<data_dir>/portal-uploads`): shrunk and re-saved as JPEG in the browser,
  up to 10 MB; unused ones are deleted after a day.
- **Orders** (`portal_orders`): AI spokesperson (15/30 s) or photo slideshow (15/30/60 s); awaiting payment → paid
  (staff "Release as paid" until Stripe) → in progress → ready for review → approved / rejected, or cancelled. The
  studio's **Orders** window (admins) lists paid orders and "Open in studio" copies the car and its photos into the
  dealer's cars there.

API paths: `/api/auth/…`, `/api/dealers/…`, `/api/staff/…` (`node/src/portal/api.js`); tests: `node/test/portal.test.js`.

## Addresses

| | Production | Staging |
| --- | --- | --- |
| Portal pages | lotspotlight.com | staging.lotspotlight.com |
| Portal API (the studio's service, portal paths only) | api.lotspotlight.com | staging-api.lotspotlight.com |
| Video studio | studio.lotspotlight.com (and video.mygoldenauto.net) | staging-studio.lotspotlight.com (and staging.mygoldenauto.net) |

All on our server, HTTPS on port 4343 and, once the router forwards it, 443.

## Setting up a site

1. `sudo bash ubuntu/portal/setup-portal-root.sh staging --api staging-api.lotspotlight.com --pages
   staging.lotspotlight.com --studio staging-studio.lotspotlight.com` records `portal_api: { url, origins }` in
   `private/config.json`, builds the pages for that API, restarts the studio service, gets certificates through
   Cloudflare DNS (token per domain in `/root/.secrets/cloudflare-<domain>.ini`) and adds the Nginx sites. Safe to run
   again. It also removes the separate MySQL-based portal service an earlier version installed.
2. After that, `ubuntu/update.sh` rebuilds the pages on every deploy.
3. The pages and the API share the lotspotlight.com domain, so the sign-in cookie (SameSite=Lax) goes with the pages'
   requests; only the addresses in `portal_api.origins` may call the API from a browser.

## Working on the pages

`cd portal/web && npm ci && npm run dev`, with the studio running locally (`cd node && npm start`, port 4350): the dev
server forwards `/api` to it.
