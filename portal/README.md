# LotSpotlight portal

The customer-facing site (app.lotspotlight.com, SiteGround): sign-in, dealers, roles, audit log, and the job API the
video worker on the Ubuntu server calls. The approved plan (customers order, pay and approve here; staff make the videos
with the existing video app) is [docs/LOTSPOTLIGHT_PLAN.md](../docs/LOTSPOTLIGHT_PLAN.md); it replaces Milestones 2–4 of
the original spec, [docs/lotspotlight-architecture.md](../docs/lotspotlight-architecture.md). "LotSpotlight" is a working
name until the new business has one. Milestones 1 (foundations) and 2 (cars and orders) are here now.

- `src/` — Express app (Node ≥ 22, MySQL 8). `src/lib/jobs.js` is the queue, `src/lib/hmac.js` the worker signatures,
  `src/lib/vehicles.js` cars, `src/lib/photos.js` uploaded photos, `src/lib/pulls.js` website pulls,
  `src/lib/orders.js` orders.
- `../shared/` — website fetching and listing-page readers used by both the portal and the video app. The portal
  imports them from the repository, so SiteGround needs the whole repository, with the app root set to `portal/`.
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

## Milestone 2: cars and orders (2026-11-03)

- **Cars** (`/api/dealers/:id/vehicles`): added by form (VIN required; "Look up" fills year, make, model, trim and
  drive from the free NHTSA VIN service), pulled from the dealer's website, or sent by a DMS sync. Fields a customer
  changes, and photos they reorder or delete, are kept when the website is pulled again. Viewers read; owners, admins
  and approvers change cars.
- **Photos**: website photos stay links to the dealer's own photo host. Uploads are shrunk and re-saved as JPEG in the
  browser (2400 px, plus a 480 px thumbnail), at most 30 per car and 10 MB each, stored in `UPLOAD_DIR`. When our server
  has copied an order's uploads, the full files are deleted here and the thumbnails stay.
- **Website pulls** (`/api/dealers/:id/pulls`): run on the portal, four car pages per request (SiteGround stops long
  work), kept going by the customer's open page. Only Dealer Car Search sites can be read today; for other sites and
  sites that block us the customer is told we will import their cars, and staff run the browser snapshot reader
  (`tools/inventory-snapshot.js`, new last step `step3Portal(<dealer id>)`). Cars no longer on the site are marked
  "not on your website anymore", never deleted.
- **Orders** (`/api/dealers/:id/orders`): owners and admins order an AI spokesperson video (15/30 s) or a photo
  slideshow (15/30/60 s) for a car with at least one photo; the car is frozen into the order. Status: awaiting
  payment → paid → in progress (→ ready for review → approved / rejected in Milestone 4), or cancelled. Customers cancel
  only before payment.
- **Staff** (`/api/staff/orders`): every dealer's orders; "Release as paid" stands in for Stripe until Milestone 3.
- **Video app** ("Orders" button for admins, `node/src/lib/orders.js`): lists paid orders through the signed worker
  API and "Open in studio" copies just that car and its photos into the dealer's client there (an existing client with
  the same name, else a new one), claims the order (in progress) and opens the car in step 1. It appears once
  `private/config.json` has `"portal": { "api": "https://…/api/worker", "worker_id": "…", "worker_secret": "…" }`.
- Tests: `test/cars.test.js` (needs `TEST_DATABASE_URL`), and `node/test/orders.test.js` in the video app.

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
