# LotSpotlight portal

The customer site and its API. Plan: [docs/LOTSPOTLIGHT_PLAN.md](../docs/LOTSPOTLIGHT_PLAN.md) (customers order, pay
and approve here; staff make the videos with the existing video studio). It replaces Milestones 2–4 of the original
spec, [docs/lotspotlight-architecture.md](../docs/lotspotlight-architecture.md). "LotSpotlight" is a working name until
the new business has one. Milestones 1 (foundations) and 2 (cars and orders) are here now.

**Where it runs (Sawyer, 2026-11-03):** the customer pages (`web/`) are a static site on SiteGround; the API (`src/`)
runs on our Ubuntu server as its own service with MySQL there, next to the video studio. If the server is down the
pages still load but cannot sign in or order.

- `src/` — the API (Express, Node ≥ 22, MySQL 8). `src/lib/jobs.js` is the queue, `src/lib/hmac.js` the worker
  signatures, `src/lib/listing.js` the live website read, `src/lib/vehicles.js` cars with videos,
  `src/lib/photos.js` uploaded photos, `src/lib/orders.js` orders.
- `../shared/` — website fetching and listing-page readers, shared with the video studio.
- `migrations/` — SQL applied in order by `npm run migrate` (the server also applies them when it starts).
- `web/` — React front end (Vite), built into `public/` with `npm run build` (not committed).
- `test/` — `npm test`. Tests that need a database use `TEST_DATABASE_URL`, an empty database they may wipe;
  without it they are skipped.

The worker side lives with the video app: `node/src/lib/portal-client.js` (signing, lease → run → complete/fail,
heartbeats) and `node/src/cli/portal-worker.js` (the loop; settings PORTAL_API, WORKER_ID, WORKER_SECRET). It is not
started by any service yet.

## Run it locally

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `TEST_DATABASE_URL` and `WORKER_SHARED_SECRETS`.
2. `npm ci`, then `npm run build` (front end) and `npm start` → http://localhost:3000.
3. First account: `npm run create-user -- --email you@example.com --name "Your Name" --staff` (password asked twice, hidden).
4. Worker against it: set `PORTAL_API=http://localhost:3000/api/worker`, `WORKER_ID` and `WORKER_SECRET` (one pair from
   `WORKER_SHARED_SECRETS`), then `node ../node/src/cli/portal-worker.js`. "Send test job" (staff only) should show
   **done** within a few seconds.

## Milestone 2: cars and orders (2026-11-03, reworked the same day)

- **Cars are not stored until they are ordered.** The Cars page reads the dealer's website live
  (`GET /api/dealers/:id/website-cars`), holds the read in memory for 15 minutes (Refresh reads again) and saves
  nothing. Only Dealer Car Search sites can be read today (eLease Returns: 25 cars in about 3 seconds); other sites and
  sites that block us (Golden Auto) are told to add cars by hand or contact eShield. A bare address that fails is tried
  with `www.` (mygoldenauto.net without www redirects to itself), and a site that cannot be read says why.
- **Ordering** (owners and admins, `POST /api/dealers/:id/orders` with `{ car, photos, source, product, length_s,
  notes }`): the customer checks and edits the car's details (VIN lookup from the free NHTSA service for cars added by
  hand), picks photos (website photos as links, first 30, plus uploads) and the video: AI spokesperson (15/30 s) or
  photo slideshow (15/30/60 s). The car is then stored as one of their "cars with videos" and frozen into the order;
  ordering it again updates it.
- **Uploads** (`/api/dealers/:id/uploads`): shrunk and re-saved as JPEG in the browser (2400 px, plus a 480 px
  thumbnail), up to 10 MB each, in `UPLOAD_DIR`. Uploads no order used are deleted after a day; once the studio has
  copied an order's uploads the full files go and the thumbnails stay.
- **Order status**: awaiting payment → paid → in progress (→ ready for review → approved / rejected in Milestone 4), or
  cancelled. Customers cancel only before payment. **Staff** (`/api/staff/orders`) see every dealer's orders and
  "Release as paid" until Stripe (Milestone 3).
- **Dealer details** (owners, admins, staff; `PATCH /api/dealers/:id`): name, website, city, state, phone, time zone;
  only staff change the short name. The studio copies name, city, website and phone into its client when it lists or
  opens that dealer's orders.
- **Video studio** ("Orders" button for admins, `node/src/lib/orders.js`): lists paid orders through the signed worker
  API; "Open in studio" copies just that car and its photos into the dealer's client there, claims the order and opens
  the car in step 1. Shown once `private/config.json` has `"portal": { "api", "worker_id", "worker_secret" }`.

## Deploying

1. **API on our server** (once per site): `sudo bash ubuntu/portal/setup-portal-root.sh staging [api-host]
   [customer-site-origin]`. It installs MySQL if needed, makes the site's database and user, writes `portal/.env` with
   new secrets, starts `golden-auto-staging-portal` on 127.0.0.1:4362 (production: 4363) and prints the `"portal"`
   settings for the studio's config (the studio reaches it on localhost). With an api-host that has a certificate it
   also adds the Nginx site on port 4343. After that, `ubuntu/update.sh` updates and restarts it with each deploy.
2. **Customer pages on SiteGround**: `bash ubuntu/portal/build-static.sh https://<api-host>:4343` makes
   `portal/static-site.zip`; upload and extract it into the site's `public_html`.
3. The pages and the API must share one domain (e.g. `staging.lotspotlight.com` and `api-staging.lotspotlight.com`) so
   the sign-in cookie goes with the pages' requests; list the pages' address in `CORS_ORIGINS` in `portal/.env`.
- Tests: `npm test` with `TEST_DATABASE_URL` (on a PC, never on the server); `test/cars.test.js` covers this milestone.

## Status and handoff (2026-11-02)

- Branch `siteground` (replaces `nodejs`). Milestone 1 done: `npm test` → 22 passing against MySQL 8.4, and a live
  "Send test job" round trip through the screens worked on Mark's PC.
- Differences from the spec, on purpose: a `sessions` table (sign-in), `users.is_staff` (eShield staff), and
  `jobs.available_at` (retry backoff) plus a `ping` job type for the round-trip check.
- Spec §3/§10 say the worker is `node.mygoldenauto.net` on 4343; that site is retired. The live servers are
  video.mygoldenauto.net (Node on 4353) and staging.mygoldenauto.net (4352), both behind Nginx with HTTPS on :4343.
- Overlap to decide with Mark: the video app already has accounts, per-dealer clients, Facebook/Instagram posting and
  Meta ads (CLAUDE.md); the spec moves those to the portal over Milestones 3–4.
- Not done yet: password reset (needs a mail service), MFA, SiteGround deployment and DNS for app.lotspotlight.com,
  running `portal-worker.js` under systemd on the server.
- Open questions in spec §13 are still unanswered except §13.5: the front end is React (Mark, 2026-10-31).

## Rules

- Roles are checked on the server: staff (eShield) → every dealer; owner > admin > approver > viewer per dealer.
- Every change from the browser needs JSON and the session's `X-CSRF-Token`.
- Worker requests need a valid HMAC signature within 300 s; video files never pass through the portal.
- Never commit `.env` or secrets.
